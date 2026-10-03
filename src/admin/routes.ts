import type { FastifyInstance } from "fastify";
import type { Pool } from "../db.js";
import { AppError } from "../shared/errors.js";
import { atualizarLivro, criarLivro } from "../catalog/repository.js";

type CriarBody = {
  isbn: string;
  titulo: string;
  autor: string;
  precoCentavos: number;
  estoque: number;
};

type AtualizarBody = {
  titulo?: string;
  autor?: string;
  precoCentavos?: number;
  estoque?: number;
};

export async function registerAdminRoutes(
  app: FastifyInstance,
  options: { pool: Pool; adminApiKey: string },
): Promise<void> {
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/admin")) return;
    const key = request.headers["x-api-key"];
    if (key !== options.adminApiKey) {
      return reply.code(401).send({ erro: "nao_autorizado" });
    }
  });

  app.post<{ Body: CriarBody }>("/admin/livros", {
    schema: {
      body: {
        type: "object",
        required: ["isbn", "titulo", "autor", "precoCentavos", "estoque"],
        additionalProperties: false,
        properties: {
          isbn: { type: "string", minLength: 1 },
          titulo: { type: "string", minLength: 1 },
          autor: { type: "string", minLength: 1 },
          precoCentavos: { type: "integer", minimum: 0 },
          estoque: { type: "integer", minimum: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const livro = await criarLivro(options.pool, request.body);
    return reply.code(201).send({ livro });
  });

  app.patch<{ Params: { id: string }; Body: AtualizarBody }>("/admin/livros/:id", {
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
          titulo: { type: "string", minLength: 1 },
          autor: { type: "string", minLength: 1 },
          precoCentavos: { type: "integer", minimum: 0 },
          estoque: { type: "integer", minimum: 0 },
        },
      },
    },
  }, async (request, reply) => {
    if (!request.body || Object.keys(request.body).length === 0) {
      throw new AppError(400, "requisicao_invalida");
    }
    const livro = await atualizarLivro(options.pool, request.params.id, request.body);
    return reply.send({ livro });
  });
}
