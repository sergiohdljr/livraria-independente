import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "../db.js";
import { AppError } from "../shared/errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COOKIE = "session";

export type StoredItem = {
  bookId: string;
  quantity: number;
};

export function readSessionId(request: FastifyRequest): string | undefined {
  const value = request.cookies[COOKIE];
  return value && UUID.test(value) ? value : undefined;
}

export async function ensureSession(pool: Pool, request: FastifyRequest, reply: FastifyReply): Promise<string> {
  const existing = readSessionId(request);
  if (existing) {
    const found = await pool.query("SELECT id FROM cart.sessions WHERE id = $1", [existing]);
    if (found.rows[0]) return existing;
  }

  const sessionId = randomUUID();
  const cartId = randomUUID();
  await pool.query("INSERT INTO cart.sessions (id) VALUES ($1)", [sessionId]);
  await pool.query("INSERT INTO cart.carts (id, session_id) VALUES ($1, $2)", [cartId, sessionId]);
  reply.setCookie(COOKIE, sessionId, { path: "/", httpOnly: true, sameSite: "lax" });
  return sessionId;
}

export async function addItem(pool: Pool, sessionId: string, bookId: string, quantity: number): Promise<StoredItem[]> {
  await pool.query(
    `INSERT INTO cart.cart_items (cart_id, book_id, quantity)
     SELECT id, $2, $3 FROM cart.carts WHERE session_id = $1
     ON CONFLICT (cart_id, book_id)
     DO UPDATE SET quantity = cart.cart_items.quantity + EXCLUDED.quantity`,
    [sessionId, bookId, quantity],
  );
  return listItems(pool, sessionId);
}

export async function changeQuantity(pool: Pool, sessionId: string, bookId: string, quantity: number): Promise<StoredItem[]> {
  const result = await pool.query(
    `UPDATE cart.cart_items SET quantity = $3
     WHERE book_id = $2 AND cart_id = (SELECT id FROM cart.carts WHERE session_id = $1)`,
    [sessionId, bookId, quantity],
  );
  if (result.rowCount === 0) throw new AppError(404, "item_not_found");
  return listItems(pool, sessionId);
}

export async function removeItem(pool: Pool, sessionId: string, bookId: string): Promise<StoredItem[]> {
  const result = await pool.query(
    `DELETE FROM cart.cart_items
     WHERE book_id = $2 AND cart_id = (SELECT id FROM cart.carts WHERE session_id = $1)`,
    [sessionId, bookId],
  );
  if (result.rowCount === 0) throw new AppError(404, "item_not_found");
  return listItems(pool, sessionId);
}

export async function listItems(pool: Pool, sessionId: string): Promise<StoredItem[]> {
  const result = await pool.query<{ book_id: string; quantity: number }>(
    `SELECT i.book_id, i.quantity
     FROM cart.carts c
     JOIN cart.cart_items i ON i.cart_id = c.id
     WHERE c.session_id = $1
     ORDER BY i.book_id`,
    [sessionId],
  );
  return result.rows.map((row) => ({ bookId: row.book_id, quantity: row.quantity }));
}

export async function clearItems(pool: Pool, sessionId: string): Promise<void> {
  await pool.query(
    `DELETE FROM cart.cart_items WHERE cart_id = (SELECT id FROM cart.carts WHERE session_id = $1)`,
    [sessionId],
  );
}
