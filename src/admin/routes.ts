import type { FastifyInstance } from "fastify";
import type { Pool } from "../db.js";
import { createBook, updateBook, type BookPatch, type NewBook } from "../catalog/repository.js";

export async function registerAdminRoutes(
  app: FastifyInstance,
  options: { pool: Pool; adminApiKey: string },
): Promise<void> {
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/admin")) return;
    if (request.headers["x-api-key"] !== options.adminApiKey) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.post<{ Body: NewBook }>("/admin/books", {
    schema: {
      body: {
        type: "object",
        required: ["isbn", "title", "author", "priceCents", "stock"],
        additionalProperties: false,
        properties: {
          isbn: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
          author: { type: "string", minLength: 1 },
          priceCents: { type: "integer", minimum: 0 },
          stock: { type: "integer", minimum: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const book = await createBook(options.pool, request.body);
    return reply.code(201).send({ book });
  });

  app.patch<{ Params: { id: string }; Body: BookPatch }>("/admin/books/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
      body: {
        type: "object",
        additionalProperties: false,
        minProperties: 1,
        properties: {
          title: { type: "string", minLength: 1 },
          author: { type: "string", minLength: 1 },
          priceCents: { type: "integer", minimum: 0 },
          stock: { type: "integer", minimum: 0 },
        },
      },
    },
  }, async (request) => {
    const book = await updateBook(options.pool, request.params.id, request.body);
    return { book };
  });
}
