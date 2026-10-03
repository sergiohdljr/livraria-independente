import type { FastifyInstance, InjectOptions } from "fastify";
import type { Pool } from "pg";
import { buildApp } from "../src/app.js";
import { createPool, migrate, resetData } from "../src/db.js";

export const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://movielogger:movielogger@localhost:5432/livraria_independente_test";

export const adminApiKey = "test-key";

export type Livro = {
  id: string;
  isbn: string;
  titulo: string;
  autor: string;
  precoCentavos: number;
  estoque: number;
};

export async function startApp(): Promise<{ app: FastifyInstance; pool: Pool }> {
  const pool = createPool(databaseUrl);
  await migrate(pool);
  await resetData(pool);
  const app = await buildApp({ pool, adminApiKey, logger: false });
  return { app, pool };
}

export async function criarLivro(
  app: FastifyInstance,
  input: Partial<Livro> & Pick<Livro, "isbn" | "titulo">,
): Promise<Livro> {
  const response = await app.inject({
    method: "POST",
    url: "/admin/livros",
    headers: { "x-api-key": adminApiKey },
    payload: {
      isbn: input.isbn,
      titulo: input.titulo,
      autor: input.autor ?? "Autor",
      precoCentavos: input.precoCentavos ?? 1000,
      estoque: input.estoque ?? 5,
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(`criarLivro failed: ${response.statusCode} ${response.body}`);
  }
  return response.json().livro as Livro;
}

export function cookieDe(response: { headers: { "set-cookie"?: string | string[] | number } }): string {
  const raw = response.headers["set-cookie"];
  const header = Array.isArray(raw) ? raw[0] : raw;
  const match = String(header).match(/sessao=([^;]+)/);
  if (!match?.[1]) throw new Error(`cookie de sessão ausente: ${String(header)}`);
  return `sessao=${match[1]}`;
}

export function comSessao(cookie: string, options: InjectOptions): InjectOptions {
  return { ...options, headers: { ...options.headers, cookie } };
}
