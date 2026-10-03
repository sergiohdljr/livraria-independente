import type { Pool } from "../db.js";
import { AppError } from "../shared/errors.js";

export type CartItem = {
  bookId: string;
  title: string;
  quantity: number;
  currentPriceCents: number;
};

export type Cart = {
  items: CartItem[];
};

export async function addItem(
  pool: Pool,
  sessionId: string,
  bookId: string,
  quantity: number,
): Promise<Cart> {
  const book = await pool.query("SELECT id FROM books WHERE id = $1", [bookId]);
  if (!book.rows[0]) throw new AppError(404, "book_not_found");

  await pool.query(
    `INSERT INTO cart_items (cart_id, book_id, quantity)
     SELECT id, $2, $3 FROM carts WHERE session_id = $1
     ON CONFLICT (cart_id, book_id)
     DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity`,
    [sessionId, bookId, quantity],
  );
  return viewCart(pool, sessionId);
}

export async function changeQuantity(
  pool: Pool,
  sessionId: string,
  bookId: string,
  quantity: number,
): Promise<Cart> {
  const result = await pool.query(
    `UPDATE cart_items SET quantity = $3
     WHERE book_id = $2
       AND cart_id = (SELECT id FROM carts WHERE session_id = $1)`,
    [sessionId, bookId, quantity],
  );
  if (result.rowCount === 0) throw new AppError(404, "item_not_found");
  return viewCart(pool, sessionId);
}

export async function removeItem(pool: Pool, sessionId: string, bookId: string): Promise<Cart> {
  const result = await pool.query(
    `DELETE FROM cart_items
     WHERE book_id = $2
       AND cart_id = (SELECT id FROM carts WHERE session_id = $1)`,
    [sessionId, bookId],
  );
  if (result.rowCount === 0) throw new AppError(404, "item_not_found");
  return viewCart(pool, sessionId);
}

export async function viewCart(pool: Pool, sessionId: string): Promise<Cart> {
  const result = await pool.query<{
    book_id: string;
    title: string;
    quantity: number;
    price_cents: number;
  }>(
    `SELECT i.book_id, b.title, i.quantity, b.price_cents
     FROM carts c
     JOIN cart_items i ON i.cart_id = c.id
     JOIN books b ON b.id = i.book_id
     WHERE c.session_id = $1
     ORDER BY b.title, i.book_id`,
    [sessionId],
  );
  return {
    items: result.rows.map((row) => ({
      bookId: row.book_id,
      title: row.title,
      quantity: row.quantity,
      currentPriceCents: row.price_cents,
    })),
  };
}
