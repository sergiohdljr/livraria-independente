import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { startCluster } from "../src/cluster.js";
import { databaseUrl } from "./helpers.js";

let app: FastifyInstance;
let close: () => Promise<void>;
const logLines: string[] = [];

beforeAll(async () => {
  const cluster = await startCluster({
    databaseUrl,
    adminApiKey: "test-key",
    internalApiKey: "test-internal-key",
    logger: {
      level: "info",
      stream: {
        write(message: string) {
          logLines.push(message);
        },
      },
    },
  });
  app = cluster.gateway;
  close = cluster.close;
});

afterAll(async () => {
  await close();
});

test("a request is logged and the API answers", async () => {
  const response = await app.inject({ method: "GET", url: "/health" });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ status: "ok" });
  expect(logLines.some((line) => line.includes("/health"))).toBe(true);
});
