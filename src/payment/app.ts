import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { Pool } from "../db.js";
import { registerErrorHandler, requireInternalKey } from "../http.js";

export type PaymentStatus = "accepted" | "declined";

export async function buildPaymentApp(options: {
  pool: Pool;
  internalApiKey: string;
  logger?: FastifyServerOptions["logger"];
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  registerErrorHandler(app);

  app.post<{ Body: { amountCents: number; simulate?: PaymentStatus } }>("/internal/charges", {
    preHandler: requireInternalKey(options.internalApiKey),
    schema: {
      body: {
        type: "object",
        required: ["amountCents"],
        additionalProperties: false,
        properties: {
          amountCents: { type: "integer", minimum: 0 },
          simulate: { type: "string", enum: ["accepted", "declined"] },
        },
      },
    },
  }, async (request, reply) => {
    const status: PaymentStatus = request.body.simulate === "declined" ? "declined" : "accepted";
    const id = randomUUID();
    await options.pool.query(
      `INSERT INTO payment.payments (id, status, amount_cents) VALUES ($1, $2, $3)`,
      [id, status, request.body.amountCents],
    );
    return reply.code(201).send({ id, status, amountCents: request.body.amountCents });
  });

  return app;
}
