import { randomUUID } from "node:crypto";
import type { Db, Pool } from "../db.js";
import type { EmailPort } from "../email/fake.js";
import type { PaymentPort, PaymentStatus } from "../payment/fake.js";
import { AppError } from "../shared/errors.js";

export type OrderItem = {
  bookId: string;
  isbn: string;
  title: string;
  author: string;
  quantity: number;
  unitPriceCents: number;
};

export type Order = {
  id: string;
  status: "created";
  postalCode: string;
  address: string;
  email: string;
  shippingCents: number;
  totalCents: number;
  items: OrderItem[];
};

export type CheckoutInput = {
  sessionId: string;
  postalCode: string;
  address: string;
  email: string;
  simulate?: PaymentStatus;
};

export type CheckoutResult = {
  order: Order;
  payment: { status: "accepted"; amountCents: number };
  emailConfirmation: "sent" | "failed";
};

type CartLine = {
  book_id: string;
  quantity: number;
  isbn: string;
  title: string;
  author: string;
  price_cents: number;
  stock: number;
};

export async function checkout(
  pool: Pool,
  payment: PaymentPort,
  email: EmailPort,
  input: CheckoutInput,
): Promise<CheckoutResult> {
  const postalCode = normalizePostalCode(input.postalCode);
  const shippingCents = await shippingForPostalCode(pool, postalCode);
  const lines = await loadCartLines(pool, input.sessionId, false);
  if (lines.length === 0) throw new AppError(422, "empty_cart");

  for (const line of lines) {
    if (line.quantity > line.stock) throw new AppError(409, "insufficient_stock");
  }

  const quotedTotal = lineTotal(lines) + shippingCents;
  const charge = await payment.charge({ amountCents: quotedTotal, simulate: input.simulate });
  if (charge.status === "declined") throw new AppError(402, "payment_declined");

  const order = await persistOrder(pool, input, postalCode, shippingCents, charge.amountCents);
  const emailConfirmation = await confirmByEmail(email, input.email, order);

  return {
    order,
    payment: { status: "accepted", amountCents: charge.amountCents },
    emailConfirmation,
  };
}

export async function getOrder(pool: Pool, sessionId: string, orderId: string): Promise<Order> {
  const found = await pool.query<{
    id: string;
    postal_code: string;
    address: string;
    email: string;
    shipping_cents: number;
    total_cents: number;
  }>(
    `SELECT id, postal_code, address, email, shipping_cents, total_cents
     FROM orders WHERE id = $1 AND session_id = $2`,
    [orderId, sessionId],
  );
  const row = found.rows[0];
  if (!row) throw new AppError(404, "order_not_found");

  const items = await pool.query<{
    book_id: string;
    isbn: string;
    title: string;
    author: string;
    quantity: number;
    unit_price_cents: number;
  }>(
    `SELECT book_id, isbn, title, author, quantity, unit_price_cents
     FROM order_items WHERE order_id = $1 ORDER BY title, book_id`,
    [orderId],
  );

  return {
    id: row.id,
    status: "created",
    postalCode: row.postal_code,
    address: row.address,
    email: row.email,
    shippingCents: row.shipping_cents,
    totalCents: row.total_cents,
    items: items.rows.map(toOrderItem),
  };
}

async function persistOrder(
  pool: Pool,
  input: CheckoutInput,
  postalCode: string,
  shippingCents: number,
  chargedCents: number,
): Promise<Order> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await loadCartLines(client, input.sessionId, true);
    if (locked.length === 0) throw new AppError(422, "empty_cart");

    for (const line of locked) {
      if (line.quantity > line.stock) rejectPaidCheckout(input.sessionId, chargedCents, "insufficient_stock");
    }

    const totalCents = lineTotal(locked) + shippingCents;
    if (totalCents !== chargedCents) rejectPaidCheckout(input.sessionId, chargedCents, "checkout_conflict");

    const orderId = randomUUID();
    const items = locked.map(toOrderItem);
    await client.query(
      `INSERT INTO orders (id, session_id, status, postal_code, address, email, shipping_cents, total_cents)
       VALUES ($1, $2, 'created', $3, $4, $5, $6, $7)`,
      [orderId, input.sessionId, postalCode, input.address, input.email, shippingCents, totalCents],
    );

    for (const item of items) {
      await client.query(
        `INSERT INTO order_items
           (id, order_id, book_id, isbn, title, author, quantity, unit_price_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), orderId, item.bookId, item.isbn, item.title, item.author, item.quantity, item.unitPriceCents],
      );
      const debit = await client.query(
        `UPDATE books SET stock = stock - $2 WHERE id = $1 AND stock >= $2`,
        [item.bookId, item.quantity],
      );
      if (debit.rowCount !== 1) rejectPaidCheckout(input.sessionId, chargedCents, "insufficient_stock");
    }

    await client.query(
      `INSERT INTO payments (id, order_id, status, amount_cents) VALUES ($1, $2, 'accepted', $3)`,
      [randomUUID(), orderId, totalCents],
    );
    await client.query(
      `DELETE FROM cart_items WHERE cart_id = (SELECT id FROM carts WHERE session_id = $1)`,
      [input.sessionId],
    );
    await client.query("COMMIT");

    return {
      id: orderId,
      status: "created",
      postalCode,
      address: input.address,
      email: input.email,
      shippingCents,
      totalCents,
      items,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function confirmByEmail(
  email: EmailPort,
  to: string,
  order: Order,
): Promise<"sent" | "failed"> {
  try {
    await email.sendOrderConfirmation({ to, orderId: order.id, totalCents: order.totalCents });
    return "sent";
  } catch (error) {
    console.error(`order confirmation failed order=${order.id}`, error);
    return "failed";
  }
}

const CART_LINES_SQL = `
  SELECT i.book_id, i.quantity, b.isbn, b.title, b.author, b.price_cents, b.stock
  FROM carts c
  JOIN cart_items i ON i.cart_id = c.id
  JOIN books b ON b.id = i.book_id
  WHERE c.session_id = $1
  ORDER BY i.book_id
`;

async function loadCartLines(db: Db, sessionId: string, lock: boolean): Promise<CartLine[]> {
  const sql = lock ? `${CART_LINES_SQL} FOR UPDATE OF b` : CART_LINES_SQL;
  const result = await db.query<CartLine>(sql, [sessionId]);
  return result.rows;
}

function rejectPaidCheckout(sessionId: string, chargedCents: number, code: "insufficient_stock" | "checkout_conflict"): never {
  console.error(`payment accepted without order session=${sessionId} amount=${chargedCents}`);
  throw new AppError(409, code);
}

function lineTotal(lines: Array<{ quantity: number; price_cents: number }>): number {
  return lines.reduce((sum, line) => sum + line.quantity * line.price_cents, 0);
}

function toOrderItem(line: {
  book_id: string;
  isbn: string;
  title: string;
  author: string;
  quantity: number;
  price_cents?: number;
  unit_price_cents?: number;
}): OrderItem {
  return {
    bookId: line.book_id,
    isbn: line.isbn,
    title: line.title,
    author: line.author,
    quantity: line.quantity,
    unitPriceCents: line.unit_price_cents ?? line.price_cents ?? 0,
  };
}

function normalizePostalCode(postalCode: string): string {
  const digits = postalCode.replace(/\D/g, "");
  if (digits.length !== 8) throw new AppError(422, "invalid_postal_code");
  return digits;
}

async function shippingForPostalCode(pool: Pool, postalCode: string): Promise<number> {
  const result = await pool.query<{ amount_cents: number }>(
    `SELECT amount_cents FROM shipping_rates
     WHERE $1 BETWEEN postal_code_start AND postal_code_end
     ORDER BY amount_cents
     LIMIT 1`,
    [Number(postalCode)],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(422, "shipping_unavailable");
  return row.amount_cents;
}
