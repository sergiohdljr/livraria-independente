import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { Pool } from "../db.js";
import { registerErrorHandler, requireInternalKey } from "../http.js";
import { AppError } from "../shared/errors.js";
import { addItem, changeQuantity, clearItems, ensureSession, listItems, removeItem, type StoredItem } from "./repository.js";

export type BookSnapshot = {
  id: string;
  title: string;
  priceCents: number;
};

export async function buildCartApp(options: {
  pool: Pool;
  catalogBaseUrl: string;
  internalApiKey: string;
  logger?: FastifyServerOptions["logger"];
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cookie);
  registerErrorHandler(app);

  async function present(items: StoredItem[]) {
    const presented = [];
    for (const item of items) {
      const book = await fetchBook(options.catalogBaseUrl, item.bookId);
      presented.push({
        bookId: item.bookId,
        title: book.title,
        quantity: item.quantity,
        currentPriceCents: book.priceCents,
      });
    }
    presented.sort((a, b) => a.title.localeCompare(b.title) || a.bookId.localeCompare(b.bookId));
    return { items: presented };
  }

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
    await fetchBook(options.catalogBaseUrl, request.body.bookId);
    const sessionId = await ensureSession(options.pool, request, reply);
    const items = await addItem(options.pool, sessionId, request.body.bookId, request.body.quantity);
    return reply.code(201).send(await present(items));
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
  }, async (request, reply) => {
    const sessionId = await ensureSession(options.pool, request, reply);
    const items = await changeQuantity(options.pool, sessionId, request.params.bookId, request.body.quantity);
    return present(items);
  });

  app.delete<{ Params: { bookId: string } }>("/cart/items/:bookId", {
    schema: {
      params: {
        type: "object",
        required: ["bookId"],
        properties: { bookId: { type: "string", format: "uuid" } },
      },
    },
  }, async (request, reply) => {
    const sessionId = await ensureSession(options.pool, request, reply);
    const items = await removeItem(options.pool, sessionId, request.params.bookId);
    return present(items);
  });

  app.get("/cart", async (request, reply) => {
    const sessionId = await ensureSession(options.pool, request, reply);
    return present(await listItems(options.pool, sessionId));
  });

  const guard = requireInternalKey(options.internalApiKey);
  app.get<{ Params: { sessionId: string } }>("/internal/carts/:sessionId", { preHandler: guard }, async (request) => {
    return { items: await listItems(options.pool, request.params.sessionId) };
  });
  app.delete<{ Params: { sessionId: string } }>("/internal/carts/:sessionId", { preHandler: guard }, async (request) => {
    await clearItems(options.pool, request.params.sessionId);
    return { status: "cleared" };
  });

  return app;
}

async function fetchBook(catalogBaseUrl: string, bookId: string): Promise<BookSnapshot> {
  const response = await fetch(`${catalogBaseUrl}/books/${bookId}`);
  if (response.status === 404) throw new AppError(404, "book_not_found");
  if (!response.ok) throw new AppError(500, "internal_error");
  const body = await response.json() as { book: BookSnapshot };
  return body.book;
}
