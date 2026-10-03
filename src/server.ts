import { startCluster } from "./cluster.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://movielogger:movielogger@localhost:5432/livraria_independente";
const adminApiKey = process.env.ADMIN_API_KEY ?? "dev-admin-key";
const internalApiKey = process.env.INTERNAL_API_KEY ?? "dev-internal-key";
const port = Number(process.env.PORT ?? 3000);

const cluster = await startCluster({ databaseUrl, adminApiKey, internalApiKey, logger: true });
await cluster.gateway.listen({ port, host: "0.0.0.0" });
