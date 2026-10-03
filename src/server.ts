import { buildApp } from "./app.js";
import { createPool, migrate } from "./db.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://movielogger:movielogger@localhost:5432/livraria_independente";
const adminApiKey = process.env.ADMIN_API_KEY ?? "dev-admin-key";
const port = Number(process.env.PORT ?? 3000);

const pool = createPool(databaseUrl);
await migrate(pool);

const app = await buildApp({ pool, adminApiKey, logger: true });

await app.listen({ port, host: "0.0.0.0" });
