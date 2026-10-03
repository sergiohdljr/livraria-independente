import { randomUUID } from "node:crypto";
import type { Pool } from "../db.js";
import type { EmailPort } from "../email/fake.js";
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

export type CheckoutResult = {
  order: Order;
  payment: { status: "accepted"; amountCents: number };
  emailConfirmation: "sent" | "failed";
};

type QuoteLine = {
  bookId: string;
  quantity: number;
  isbn: string;
  title: string;
  author: string;
  unitPriceCents: number;
  stock: number;
};

type Remote = {
  catalogBaseUrl: string;
  cartBaseUrl: string;
  paymentBaseUrl: string;
  internalApiKey: string;
};

export async function checkout(
  pool: Pool,
  email: EmailPort,
  remote: Remote,
  input: { sessionId: string; postalCode: string; address: string; email: string; simulate?: "accepted" | "declined" },
): Promise<CheckoutResult> {
  const postalCode = normalizePostalCode(input.postalCode);
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [input.sessionId]);

    const shippingCents = await shippingForPostalCode(client, postalCode);
    const lines = await quoteLines(remote, input.sessionId);
    if (lines.length === 0) throw new AppError(422, "empty_cart");

    const existing = await findMatchingOrder(client, input.sessionId, lines);
    if (existing) {
      const emailConfirmation = await finishCartAndEmail(remote, email, input.sessionId, existing);
      return {
        order: existing,
        payment: { status: "accepted", amountCents: existing.totalCents },
        emailConfirmation,
      };
    }

    if (lines.some((line) => line.quantity > line.stock)) throw new AppError(409, "insufficient_stock");

    const totalCents = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0) + shippingCents;
    const charge = await createCharge(remote, totalCents, input.simulate);
    if (charge.status === "declined") throw new AppError(402, "payment_declined");

    const stockLines = lines.map((line) => ({ bookId: line.bookId, quantity: line.quantity }));
    const debited = await postStock(remote, "debit", stockLines);
    if (!debited) {
      console.error(`payment accepted without order session=${input.sessionId} amount=${charge.amountCents}`);
      throw new AppError(409, "insufficient_stock");
    }

    let order: Order;
    try {
      order = await insertOrder(client, input, postalCode, shippingCents, totalCents, charge.id, lines);
    } catch (error) {
      console.error(`payment accepted without order session=${input.sessionId} amount=${charge.amountCents}`);
      let restored = false;
      try {
        restored = await postStock(remote, "restore", stockLines);
      } catch (restoreError) {
        console.error(`stock still debited without order session=${input.sessionId}`, restoreError);
      }
      if (!restored) throw new AppError(500, "internal_error");
      throw error;
    }

    const emailConfirmation = await finishCartAndEmail(remote, email, input.sessionId, order);
    return {
      order,
      payment: { status: "accepted", amountCents: charge.amountCents },
      emailConfirmation,
    };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [input.sessionId]);
    client.release();
  }
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
     FROM checkout.orders WHERE id = $1 AND session_id = $2`,
    [orderId, sessionId],
  );
  const row = found.rows[0];
  if (!row) throw new AppError(404, "order_not_found");
  const items = await loadItems(pool, orderId);
  return toOrder(row, items);
}

async function quoteLines(remote: Remote, sessionId: string): Promise<QuoteLine[]> {
  const cart = await fetch(`${remote.cartBaseUrl}/internal/carts/${sessionId}`, {
    headers: { "x-internal-key": remote.internalApiKey },
  });
  if (!cart.ok) throw new AppError(500, "internal_error");
  const body = await cart.json() as { items: Array<{ bookId: string; quantity: number }> };
  const lines: QuoteLine[] = [];
  for (const item of body.items) {
    const response = await fetch(`${remote.catalogBaseUrl}/books/${item.bookId}`);
    if (!response.ok) throw new AppError(500, "internal_error");
    const book = (await response.json() as { book: { isbn: string; title: string; author: string; priceCents: number; stock: number } }).book;
    lines.push({
      bookId: item.bookId,
      quantity: item.quantity,
      isbn: book.isbn,
      title: book.title,
      author: book.author,
      unitPriceCents: book.priceCents,
      stock: book.stock,
    });
  }
  return lines;
}

async function createCharge(remote: Remote, amountCents: number, simulate?: "accepted" | "declined") {
  const response = await fetch(`${remote.paymentBaseUrl}/internal/charges`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-key": remote.internalApiKey,
    },
    body: JSON.stringify({ amountCents, simulate }),
  });
  if (!response.ok) throw new AppError(500, "internal_error");
  return await response.json() as { id: string; status: "accepted" | "declined"; amountCents: number };
}

async function postStock(remote: Remote, action: "debit" | "restore", lines: Array<{ bookId: string; quantity: number }>): Promise<boolean> {
  const response = await fetch(`${remote.catalogBaseUrl}/internal/stock/${action}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-key": remote.internalApiKey,
    },
    body: JSON.stringify({ lines }),
  });
  return response.ok;
}

async function finishCartAndEmail(
  remote: Remote,
  email: EmailPort,
  sessionId: string,
  order: Order,
): Promise<"sent" | "failed"> {
  try {
    const cleared = await clearCart(remote, sessionId);
    if (!cleared) console.error(`cart not cleared session=${sessionId} order=${order.id}`);
  } catch (error) {
    console.error(`cart not cleared session=${sessionId} order=${order.id}`, error);
  }
  return confirmByEmail(email, order.email, order);
}

async function clearCart(remote: Remote, sessionId: string): Promise<boolean> {
  const response = await fetch(`${remote.cartBaseUrl}/internal/carts/${sessionId}`, {
    method: "DELETE",
    headers: { "x-internal-key": remote.internalApiKey },
  });
  return response.ok;
}

async function insertOrder(
  client: import("pg").PoolClient,
  input: { sessionId: string; address: string; email: string },
  postalCode: string,
  shippingCents: number,
  totalCents: number,
  paymentId: string,
  lines: QuoteLine[],
): Promise<Order> {
  const orderId = randomUUID();
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO checkout.orders
         (id, session_id, status, postal_code, address, email, shipping_cents, total_cents, payment_id)
       VALUES ($1, $2, 'created', $3, $4, $5, $6, $7, $8)`,
      [orderId, input.sessionId, postalCode, input.address, input.email, shippingCents, totalCents, paymentId],
    );
    const items: OrderItem[] = [];
    for (const line of lines) {
      items.push({
        bookId: line.bookId,
        isbn: line.isbn,
        title: line.title,
        author: line.author,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
      });
      await client.query(
        `INSERT INTO checkout.order_items
           (id, order_id, book_id, isbn, title, author, quantity, unit_price_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), orderId, line.bookId, line.isbn, line.title, line.author, line.quantity, line.unitPriceCents],
      );
    }
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
  }
}

async function findMatchingOrder(client: import("pg").PoolClient, sessionId: string, lines: QuoteLine[]): Promise<Order | undefined> {
  const orders = await client.query<{
    id: string;
    postal_code: string;
    address: string;
    email: string;
    shipping_cents: number;
    total_cents: number;
  }>(
    `SELECT id, postal_code, address, email, shipping_cents, total_cents
     FROM checkout.orders WHERE session_id = $1 ORDER BY id`,
    [sessionId],
  );
  const wanted = lines.map((line) => `${line.bookId}:${line.quantity}`).sort().join("|");
  for (const row of orders.rows) {
    const items = await loadItems(client, row.id);
    const have = items.map((item) => `${item.bookId}:${item.quantity}`).sort().join("|");
    if (have === wanted) return toOrder(row, items);
  }
  return undefined;
}

async function loadItems(db: Pool | import("pg").PoolClient, orderId: string): Promise<OrderItem[]> {
  const items = await db.query<{
    book_id: string;
    isbn: string;
    title: string;
    author: string;
    quantity: number;
    unit_price_cents: number;
  }>(
    `SELECT book_id, isbn, title, author, quantity, unit_price_cents
     FROM checkout.order_items WHERE order_id = $1 ORDER BY title, book_id`,
    [orderId],
  );
  return items.rows.map((item) => ({
    bookId: item.book_id,
    isbn: item.isbn,
    title: item.title,
    author: item.author,
    quantity: item.quantity,
    unitPriceCents: item.unit_price_cents,
  }));
}

function toOrder(row: {
  id: string;
  postal_code: string;
  address: string;
  email: string;
  shipping_cents: number;
  total_cents: number;
}, items: OrderItem[]): Order {
  return {
    id: row.id,
    status: "created",
    postalCode: row.postal_code,
    address: row.address,
    email: row.email,
    shippingCents: row.shipping_cents,
    totalCents: row.total_cents,
    items,
  };
}

async function shippingForPostalCode(client: import("pg").PoolClient, postalCode: string): Promise<number> {
  const result = await client.query<{ amount_cents: number }>(
    `SELECT amount_cents FROM checkout.shipping_rates
     WHERE $1 BETWEEN postal_code_start AND postal_code_end
     ORDER BY amount_cents LIMIT 1`,
    [Number(postalCode)],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(422, "shipping_unavailable");
  return row.amount_cents;
}

function normalizePostalCode(postalCode: string): string {
  const digits = postalCode.replace(/\D/g, "");
  if (digits.length !== 8) throw new AppError(422, "invalid_postal_code");
  return digits;
}

async function confirmByEmail(email: EmailPort, to: string, order: Order): Promise<"sent" | "failed"> {
  try {
    await email.sendOrderConfirmation({ to, orderId: order.id, totalCents: order.totalCents });
    return "sent";
  } catch (error) {
    console.error(`order confirmation failed order=${order.id}`, error);
    return "failed";
  }
}
