import sensible from "@fastify/sensible";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
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
  logger?: boolean | object;
  payment?: PaymentPort;
  email?: EmailPort;
};

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: (options.logger ?? false) as boolean,
  });

  await app.register(sensible);
  await app.register(cookie);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ erro: error.erro });
    }
    if (isValidationError(error)) {
      return reply.code(400).send({ erro: "requisicao_invalida" });
    }
    request.log.error(error);
    return reply.code(500).send({ erro: "erro_interno" });
  });

  app.get("/health", async () => ({ status: "ok" }));

  const pool = options.pool;
  await registerCatalogRoutes(app, pool);
  await registerAdminRoutes(app, { pool, adminApiKey: options.adminApiKey });
  await registerCartRoutes(app, pool);
  await registerCheckoutRoutes(app, {
    pool,
    payment: options.payment ?? createFakePayment(),
    email: options.email ?? createFakeEmail(),
  });

  return app;
}

function isValidationError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "validation" in error && Boolean(error.validation);
}
