import sensible from "@fastify/sensible";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { Pool } from "./db.js";
import { registerAdminRoutes } from "./admin/routes.js";
import { registerCartRoutes } from "./cart/routes.js";
import { registerCatalogRoutes } from "./catalog/routes.js";
import { registerCheckoutRoutes } from "./checkout/routes.js";
import { createFakeEmail, type EmailPort } from "./email/fake.js";
import { createFakePayment, type PaymentPort } from "./payment/fake.js";
import { AppError } from "./shared/errors.js";

export type BuildAppOptions = {
  pool: Pool;
  adminApiKey: string;
  logger?: FastifyServerOptions["logger"];
  payment?: PaymentPort;
  email?: EmailPort;
};

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(sensible);
  await app.register(cookie);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: error.code });
    }
    if (isValidationError(error)) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    request.log.error(error);
    return reply.code(500).send({ error: "internal_error" });
  });

  app.get("/health", async () => ({ status: "ok" }));

  await registerCatalogRoutes(app, options.pool);
  await registerAdminRoutes(app, { pool: options.pool, adminApiKey: options.adminApiKey });
  await registerCartRoutes(app, options.pool);
  await registerCheckoutRoutes(app, {
    pool: options.pool,
    payment: options.payment ?? createFakePayment(),
    email: options.email ?? createFakeEmail(),
  });

  return app;
}

function isValidationError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "validation" in error && Boolean(error.validation);
}
