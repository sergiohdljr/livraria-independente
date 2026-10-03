import type { FastifyInstance } from "fastify";
import type { Pool } from "../db.js";
import { buscarLivro, listarLivros } from "./repository.js";

type ListQuery = {
  q?: string;
  disponivel?: string;
};

export async function registerCatalogRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get<{ Querystring: ListQuery }>("/livros", async (request) => {
    const disponivel = parseDisponivel(request.query.disponivel);
    const livros = await listarLivros(pool, { q: request.query.q, disponivel });
    return { livros };
  });

  app.get<{ Params: { id: string } }>("/livros/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
    },
  }, async (request) => {
    const livro = await buscarLivro(pool, request.params.id);
    return { livro };
  });
}

function parseDisponivel(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}
