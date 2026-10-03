import type { FastifyInstance } from "fastify";
import type { Pool } from "../db.js";
import { getBook, listBooks } from "./repository.js";

type ListQuery = {
  q?: string;
  available?: string;
};

export async function registerCatalogRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get<{ Querystring: ListQuery }>("/books", async (request) => {
    const books = await listBooks(pool, {
      query: request.query.q,
      available: parseAvailable(request.query.available),
    });
    return { books };
  });

  app.get<{ Params: { id: string } }>("/books/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
    },
  }, async (request) => {
    const book = await getBook(pool, request.params.id);
    return { book };
  });
}

function parseAvailable(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}
