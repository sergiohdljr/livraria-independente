import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { buildApp } from "../src/app.js";
import { createPool, migrate } from "../src/db.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://movielogger:movielogger@localhost:5432/livraria_independente_test";

let pool: Pool;
let app: FastifyInstance;
const logLines: string[] = [];

beforeAll(async () => {
  pool = createPool(databaseUrl);
  await migrate(pool);
  app = await buildApp({
    pool,
    adminApiKey: "test-key",
    logger: {
      level: "info",
      stream: {
        write(message: string) {
          logLines.push(message);
        },
      },
    },
  });
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

test("a request is logged and the API answers", async () => {
  const response = await app.inject({ method: "GET", url: "/health" });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ status: "ok" });
  expect(logLines.some((line) => line.includes("/health"))).toBe(true);
});
