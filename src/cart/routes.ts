import type { FastifyInstance } from "fastify";
import type { Pool } from "../db.js";
import { adicionarItem, alterarQuantidade, removerItem, resolverSessao, verCarrinho } from "./repository.js";

export async function registerCartRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.post<{ Body: { livroId: string; quantidade: number } }>("/carrinho/itens", {
    schema: {
      body: {
        type: "object",
        required: ["livroId", "quantidade"],
        additionalProperties: false,
        properties: {
          livroId: { type: "string", format: "uuid" },
          quantidade: { type: "integer", minimum: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const sessao = await resolverSessao(pool, request, reply);
    await adicionarItem(pool, sessao.carrinhoId, request.body.livroId, request.body.quantidade);
    const itens = await verCarrinho(pool, sessao.carrinhoId);
    return reply.code(201).send({ itens });
  });

  app.patch<{ Params: { livroId: string }; Body: { quantidade: number } }>(
    "/carrinho/itens/:livroId",
    {
      schema: {
        params: {
          type: "object",
          required: ["livroId"],
          properties: { livroId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["quantidade"],
          additionalProperties: false,
          properties: { quantidade: { type: "integer", minimum: 1 } },
        },
      },
    },
    async (request, reply) => {
      const sessao = await resolverSessao(pool, request, reply);
      await alterarQuantidade(pool, sessao.carrinhoId, request.params.livroId, request.body.quantidade);
      const itens = await verCarrinho(pool, sessao.carrinhoId);
      return { itens };
    },
  );

  app.delete<{ Params: { livroId: string } }>("/carrinho/itens/:livroId", {
    schema: {
      params: {
        type: "object",
        required: ["livroId"],
        properties: { livroId: { type: "string", format: "uuid" } },
      },
    },
  }, async (request, reply) => {
    const sessao = await resolverSessao(pool, request, reply);
    await removerItem(pool, sessao.carrinhoId, request.params.livroId);
    const itens = await verCarrinho(pool, sessao.carrinhoId);
    return { itens };
  });

  app.get("/carrinho", async (request, reply) => {
    const sessao = await resolverSessao(pool, request, reply);
    const itens = await verCarrinho(pool, sessao.carrinhoId);
    return { itens };
  });
}
