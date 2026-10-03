import { type AddressInfo } from "node:net";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { buildCartApp } from "./cart/app.js";
import { buildCatalogApp } from "./catalog/app.js";
import { registerCheckoutRoutes } from "./checkout/routes.js";
import { createPool, migrate, resetData, type Pool } from "./db.js";
import { createFakeEmail, type EmailPort } from "./email/fake.js";
import { proxy } from "./gateway/proxy.js";
import { registerErrorHandler } from "./http.js";
import { buildPaymentApp } from "./payment/app.js";

export type Cluster = {
  gateway: FastifyInstance;
  close: () => Promise<void>;
};

export async function startCluster(options: {
  databaseUrl: string;
  adminApiKey: string;
  internalApiKey: string;
  logger?: FastifyServerOptions["logger"];
  email?: EmailPort;
  reset?: boolean;
}): Promise<Cluster> {
  const catalogPool = createPool(options.databaseUrl);
  const cartPool = createPool(options.databaseUrl);
  const checkoutPool = createPool(options.databaseUrl);
  const paymentPool = createPool(options.databaseUrl);
  await migrate(catalogPool);
  if (options.reset) await resetData(catalogPool);

  const catalog = await buildCatalogApp({
    pool: catalogPool,
    adminApiKey: options.adminApiKey,
    internalApiKey: options.internalApiKey,
  });
  const payment = await buildPaymentApp({
    pool: paymentPool,
    internalApiKey: options.internalApiKey,
  });
  await catalog.listen({ port: 0, host: "127.0.0.1" });
  await payment.listen({ port: 0, host: "127.0.0.1" });
  const catalogBaseUrl = baseUrl(catalog);
  const paymentBaseUrl = baseUrl(payment);

  const cart = await buildCartApp({
    pool: cartPool,
    catalogBaseUrl,
    internalApiKey: options.internalApiKey,
  });
  await cart.listen({ port: 0, host: "127.0.0.1" });
  const cartBaseUrl = baseUrl(cart);

  const gateway = Fastify({ logger: options.logger ?? false });
  await gateway.register(cookie);
  registerErrorHandler(gateway);
  gateway.get("/health", async () => ({ status: "ok" }));

  const forwardCatalog = async (request: Parameters<typeof proxy>[0], reply: Parameters<typeof proxy>[1]) => {
    await proxy(request, reply, catalogBaseUrl);
  };
  const forwardCart = async (request: Parameters<typeof proxy>[0], reply: Parameters<typeof proxy>[1]) => {
    await proxy(request, reply, cartBaseUrl);
  };
  gateway.all("/books", forwardCatalog);
  gateway.all("/books/*", forwardCatalog);
  gateway.all("/admin/books", forwardCatalog);
  gateway.all("/admin/books/*", forwardCatalog);
  gateway.all("/cart", forwardCart);
  gateway.all("/cart/*", forwardCart);

  await registerCheckoutRoutes(gateway, {
    pool: checkoutPool,
    email: options.email ?? createFakeEmail(),
    catalogBaseUrl,
    cartBaseUrl,
    paymentBaseUrl,
    internalApiKey: options.internalApiKey,
  });

  return {
    gateway,
    async close() {
      await gateway.close();
      await cart.close();
      await catalog.close();
      await payment.close();
      await checkoutPool.end();
      await cartPool.end();
      await catalogPool.end();
      await paymentPool.end();
    },
  };
}

function baseUrl(app: FastifyInstance): string {
  const address = app.server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}
