import type { FastifyInstance } from "fastify";
import type { Pool } from "../db.js";
import type { EmailPort } from "../email/fake.js";
import type { PaymentPort, PaymentStatus } from "../payment/fake.js";
import { AppError } from "../shared/errors.js";
import { readSessionId } from "../session.js";
import { checkout, getOrder } from "./service.js";

type CheckoutBody = {
  postalCode: string;
  address: string;
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
        required: ["postalCode", "address", "email"],
        additionalProperties: false,
        properties: {
          postalCode: { type: "string", minLength: 8 },
          address: { type: "string", minLength: 1 },
          email: { type: "string", format: "email" },
        },
      },
    },
  }, async (request, reply) => {
    const sessionId = readSessionId(request);
    if (!sessionId) throw new AppError(422, "empty_cart");
    const result = await checkout(deps.pool, deps.payment, deps.email, {
      sessionId,
      postalCode: request.body.postalCode,
      address: request.body.address,
      email: request.body.email,
      simulate: simulatedPayment(request.headers["x-payment-simulation"]),
    });
    return reply.code(201).send(result);
  });

  app.get<{ Params: { id: string } }>("/orders/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
      },
    },
  }, async (request) => {
    const sessionId = readSessionId(request);
    if (!sessionId) throw new AppError(404, "order_not_found");
    const order = await getOrder(deps.pool, sessionId, request.params.id);
    return { order };
  });
}

function simulatedPayment(header: string | string[] | undefined): PaymentStatus | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === "accepted" || value === "declined") return value;
  return undefined;
}
