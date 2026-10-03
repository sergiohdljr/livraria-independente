import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { Pool } from "../db.js";
import { registerErrorHandler, requireInternalKey } from "../http.js";
import { registerAdminRoutes } from "../admin/routes.js";
import { registerCatalogRoutes } from "./routes.js";
import { debitStock, restoreStock, type StockLine } from "./repository.js";

export async function buildCatalogApp(options: {
  pool: Pool;
  adminApiKey: string;
  internalApiKey: string;
  logger?: FastifyServerOptions["logger"];
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  registerErrorHandler(app);
  await registerCatalogRoutes(app, options.pool);
  await registerAdminRoutes(app, { pool: options.pool, adminApiKey: options.adminApiKey });

  const guard = requireInternalKey(options.internalApiKey);
  const bodySchema = {
    type: "object",
    required: ["lines"],
    additionalProperties: false,
    properties: {
      lines: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["bookId", "quantity"],
          additionalProperties: false,
          properties: {
            bookId: { type: "string", format: "uuid" },
            quantity: { type: "integer", minimum: 1 },
          },
        },
      },
    },
  };

  app.post<{ Body: { lines: StockLine[] } }>("/internal/stock/debit", { schema: { body: bodySchema }, preHandler: guard }, async (request) => {
    await debitStock(options.pool, request.body.lines);
    return { status: "debited" };
  });

  app.post<{ Body: { lines: StockLine[] } }>("/internal/stock/restore", { schema: { body: bodySchema }, preHandler: guard }, async (request) => {
    await restoreStock(options.pool, request.body.lines);
    return { status: "restored" };
  });

  return app;
}
