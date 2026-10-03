import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "../db.js";
import { ensureSession } from "../session.js";
import { addItem, changeQuantity, removeItem, viewCart } from "./repository.js";

export async function registerCartRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.post<{ Body: { bookId: string; quantity: number } }>("/cart/items", {
    schema: {
      body: {
        type: "object",
        required: ["bookId", "quantity"],
        additionalProperties: false,
        properties: {
          bookId: { type: "string", format: "uuid" },
          quantity: { type: "integer", minimum: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const sessionId = await ensureSession(pool, request, reply);
    const cart = await addItem(pool, sessionId, request.body.bookId, request.body.quantity);
    return reply.code(201).send(cart);
  });

  app.patch<{ Params: { bookId: string }; Body: { quantity: number } }>("/cart/items/:bookId", {
    schema: {
      params: {
        type: "object",
        required: ["bookId"],
        properties: { bookId: { type: "string", format: "uuid" } },
      },
      body: {
        type: "object",
        required: ["quantity"],
        additionalProperties: false,
        properties: { quantity: { type: "integer", minimum: 1 } },
      },
    },
  }, async (request, reply) => replyWithCart(pool, request, reply, (sessionId) =>
    changeQuantity(pool, sessionId, request.params.bookId, request.body.quantity),
  ));

  app.delete<{ Params: { bookId: string } }>("/cart/items/:bookId", {
    schema: {
      params: {
        type: "object",
        required: ["bookId"],
        properties: { bookId: { type: "string", format: "uuid" } },
      },
    },
  }, async (request, reply) => replyWithCart(pool, request, reply, (sessionId) =>
    removeItem(pool, sessionId, request.params.bookId),
  ));

  app.get("/cart", async (request, reply) => replyWithCart(pool, request, reply, (sessionId) =>
    viewCart(pool, sessionId),
  ));
}

async function replyWithCart(
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
  load: (sessionId: string) => Promise<{ items: unknown[] }>,
) {
  const sessionId = await ensureSession(pool, request, reply);
  return load(sessionId);
}
