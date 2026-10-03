import type { FastifyInstance, InjectOptions } from "fastify";
import { startCluster } from "../src/cluster.js";

export const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://movielogger:movielogger@localhost:5432/livraria_independente_test";

export const adminApiKey = "test-key";

export type Book = {
  id: string;
  isbn: string;
  title: string;
  author: string;
  priceCents: number;
  stock: number;
};

export async function startApp(): Promise<{ app: FastifyInstance; close: () => Promise<void> }> {
  const cluster = await startCluster({
    databaseUrl,
    adminApiKey,
    internalApiKey: "test-internal-key",
    reset: true,
  });
  return { app: cluster.gateway, close: cluster.close };
}

export async function createBook(
  app: FastifyInstance,
  input: Partial<Book> & Pick<Book, "isbn" | "title">,
): Promise<Book> {
  const response = await app.inject({
    method: "POST",
    url: "/admin/books",
    headers: { "x-api-key": adminApiKey },
    payload: {
      isbn: input.isbn,
      title: input.title,
      author: input.author ?? "Author",
      priceCents: input.priceCents ?? 1000,
      stock: input.stock ?? 5,
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(`createBook failed: ${response.statusCode} ${response.body}`);
  }
  return response.json().book as Book;
}

export function sessionCookie(response: { headers: { "set-cookie"?: string | string[] | number } }): string {
  const raw = response.headers["set-cookie"];
  const header = Array.isArray(raw) ? raw[0] : raw;
  const match = String(header).match(/session=([^;]+)/);
  if (!match?.[1]) throw new Error(`session cookie missing: ${String(header)}`);
  return `session=${match[1]}`;
}

export function withSession(cookie: string, options: InjectOptions): InjectOptions {
  return { ...options, headers: { ...options.headers, cookie } };
}
