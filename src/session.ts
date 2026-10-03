import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "./db.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COOKIE = "session";

export function readSessionId(request: FastifyRequest): string | undefined {
  const value = request.cookies[COOKIE];
  return value && UUID.test(value) ? value : undefined;
}

export async function ensureSession(
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string> {
  const existing = readSessionId(request);
  if (existing) {
    const found = await pool.query("SELECT id FROM sessions WHERE id = $1", [existing]);
    if (found.rows[0]) return existing;
  }

  const sessionId = randomUUID();
  const cartId = randomUUID();
  await pool.query("INSERT INTO sessions (id) VALUES ($1)", [sessionId]);
  await pool.query("INSERT INTO carts (id, session_id) VALUES ($1, $2)", [cartId, sessionId]);
  reply.setCookie(COOKIE, sessionId, { path: "/", httpOnly: true, sameSite: "lax" });
  return sessionId;
}
