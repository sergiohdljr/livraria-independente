import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { adminApiKey, criarLivro, startApp } from "./helpers.js";

let app: FastifyInstance;
let pool: Pool;

beforeAll(async () => {
  ({ app, pool } = await startApp());
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

test("Admin com API key cria um Livro e o Comprador lista e abre o detalhe", async () => {
  const criado = await criarLivro(app, {
    isbn: "9780000000001",
    titulo: "Dom Casmurro",
    autor: "Machado de Assis",
    precoCentavos: 4500,
    estoque: 3,
  });

  const lista = await app.inject({ method: "GET", url: "/livros" });
  expect(lista.statusCode).toBe(200);
  expect(lista.json().livros).toContainEqual({
    id: criado.id,
    isbn: "9780000000001",
    titulo: "Dom Casmurro",
    autor: "Machado de Assis",
    precoCentavos: 4500,
    estoque: 3,
  });

  const detalhe = await app.inject({ method: "GET", url: `/livros/${criado.id}` });
  expect(detalhe.statusCode).toBe(200);
  expect(detalhe.json().livro.estoque).toBe(3);
});

test("escrita de Livro sem API key é recusada", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/admin/livros",
    payload: {
      isbn: "9780000000002",
      titulo: "Sem chave",
      autor: "Ninguém",
      precoCentavos: 1000,
      estoque: 1,
    },
  });

  expect(response.statusCode).toBe(401);
  expect(response.json()).toEqual({ erro: "nao_autorizado" });
  expect(adminApiKey).not.toBe("");
});

test("Admin atualiza metadados, preço e Estoque", async () => {
  const livro = await criarLivro(app, { isbn: "9780000000003", titulo: "Antigo", estoque: 2 });

  const atualizado = await app.inject({
    method: "PATCH",
    url: `/admin/livros/${livro.id}`,
    headers: { "x-api-key": adminApiKey },
    payload: { titulo: "Novo título", precoCentavos: 2200, estoque: 9 },
  });

  expect(atualizado.statusCode).toBe(200);
  expect(atualizado.json().livro).toMatchObject({
    titulo: "Novo título",
    precoCentavos: 2200,
    estoque: 9,
  });

  const semChave = await app.inject({
    method: "PATCH",
    url: `/admin/livros/${livro.id}`,
    payload: { estoque: 0 },
  });
  expect(semChave.statusCode).toBe(401);

  const detalhe = await app.inject({ method: "GET", url: `/livros/${livro.id}` });
  expect(detalhe.json().livro.estoque).toBe(9);
});

test("Comprador busca por texto e filtra por disponibilidade", async () => {
  await criarLivro(app, { isbn: "9780000000010", titulo: "A Hora da Estrela", autor: "Lispector", estoque: 0 });
  await criarLivro(app, { isbn: "9780000000011", titulo: "Estrela da manhã", autor: "Bandeira", estoque: 4 });
  await criarLivro(app, { isbn: "9780000000012", titulo: "Grande Sertão", autor: "Rosa", estoque: 1 });

  const busca = await app.inject({ method: "GET", url: "/livros?q=estrela" });
  expect(busca.statusCode).toBe(200);
  const titulos = busca.json().livros.map((livro: { titulo: string }) => livro.titulo);
  expect(titulos).toEqual(["A Hora da Estrela", "Estrela da manhã"]);

  const disponiveis = await app.inject({ method: "GET", url: "/livros?q=estrela&disponivel=true" });
  expect(disponiveis.json().livros.map((livro: { titulo: string }) => livro.titulo)).toEqual([
    "Estrela da manhã",
  ]);
});
