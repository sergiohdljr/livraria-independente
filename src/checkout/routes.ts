import type { FastifyInstance } from "fastify";
import type { Pool } from "../db.js";
import type { EmailPort } from "../email/fake.js";
import { AppError } from "../shared/errors.js";
import { checkout, getOrder } from "./service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CheckoutBody = {
  postalCode: string;
  address: string;
  email: string;
};

export async function registerCheckoutRoutes(
  app: FastifyInstance,
  deps: {
    pool: Pool;
    email: EmailPort;
    catalogBaseUrl: string;
    cartBaseUrl: string;
    paymentBaseUrl: string;
    internalApiKey: string;
  },
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
    const sessionId = readSessionId(request.cookies["session"]);
    if (!sessionId) throw new AppError(422, "empty_cart");
    const header = request.headers["x-payment-simulation"];
    const simulate = header === "accepted" || header === "declined" ? header : undefined;
    const result = await checkout(deps.pool, deps.email, deps, {
      sessionId,
      postalCode: request.body.postalCode,
      address: request.body.address,
      email: request.body.email,
      simulate,
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
    const sessionId = readSessionId(request.cookies["session"]);
    if (!sessionId) throw new AppError(404, "order_not_found");
    return { order: await getOrder(deps.pool, sessionId, request.params.id) };
  });
}

function readSessionId(value: string | undefined): string | undefined {
  return value && UUID.test(value) ? value : undefined;
}
