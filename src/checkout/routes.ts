import type { FastifyInstance } from "fastify";
import type { Pool } from "../db.js";
import type { EmailPort } from "../email/fake.js";
import type { PagamentoStatus, PaymentPort } from "../payment/fake.js";
import { AppError } from "../shared/errors.js";
import { resolverSessao } from "../cart/repository.js";
import { buscarPedido, executarCheckout } from "./service.js";

type CheckoutBody = {
  cep: string;
  endereco: string;
  email: string;
};

export async function registerCheckoutRoutes(
  app: FastifyInstance,
  deps: { pool: Pool; payment: PaymentPort; email: EmailPort },
): Promise<void> {
  app.post<{ Body: CheckoutBody }>("/checkout", {
    schema: {
      body: {
        type: "object",
        required: ["cep", "endereco", "email"],
        additionalProperties: false,
        properties: {
          cep: { type: "string", minLength: 8 },
          endereco: { type: "string", minLength: 1 },
          email: { type: "string", format: "email" },
        },
      },
    },
  }, async (request, reply) => {
    const sessao = await resolverSessao(deps.pool, request, reply);
    const simular = simularPagamento(request.headers["x-pagamento-simulado"]);
    const resultado = await executarCheckout(deps.pool, deps.payment, deps.email, {
      sessaoId: sessao.sessaoId,
      cep: request.body.cep,
      endereco: request.body.endereco,
      email: request.body.email,
      simular,
    });
    return reply.code(201).send(resultado);
  });

  app.get<{ Params: { id: string } }>("/pedidos/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
    },
  }, async (request, reply) => {
    const cookie = request.cookies["sessao"];
    if (!cookie) throw new AppError(404, "pedido_nao_encontrado");
    const pedido = await buscarPedido(deps.pool, cookie, request.params.id);
    return { pedido };
  });
}

function simularPagamento(header: string | string[] | undefined): PagamentoStatus | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === "aceito" || value === "recusado") return value;
  return undefined;
}
