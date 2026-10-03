import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { cookieDe, comSessao, criarLivro, startApp } from "./helpers.js";

let app: FastifyInstance;
let pool: Pool;

beforeAll(async () => {
  ({ app, pool } = await startApp());
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

test("Comprador monta um Carrinho por Sessão sem reservar Estoque", async () => {
  const livro = await criarLivro(app, {
    isbn: "9780000000020",
    titulo: "Capitães da Areia",
    precoCentavos: 3000,
    estoque: 2,
  });

  const adicionado = await app.inject({
    method: "POST",
    url: "/carrinho/itens",
    payload: { livroId: livro.id, quantidade: 4 },
  });
  expect(adicionado.statusCode).toBe(201);
  const cookie = cookieDe(adicionado);
  expect(adicionado.json().itens).toEqual([
    {
      livroId: livro.id,
      titulo: "Capitães da Areia",
      quantidade: 4,
      precoAtualCentavos: 3000,
    },
  ]);

  const alterado = await app.inject(
    comSessao(cookie, {
      method: "PATCH",
      url: `/carrinho/itens/${livro.id}`,
      payload: { quantidade: 1 },
    }),
  );
  expect(alterado.statusCode).toBe(200);
  expect(alterado.json().itens[0].quantidade).toBe(1);

  const visto = await app.inject(comSessao(cookie, { method: "GET", url: "/carrinho" }));
  expect(visto.json().itens).toHaveLength(1);

  const removido = await app.inject(
    comSessao(cookie, { method: "DELETE", url: `/carrinho/itens/${livro.id}` }),
  );
  expect(removido.json().itens).toEqual([]);

  const detalhe = await app.inject({ method: "GET", url: `/livros/${livro.id}` });
  expect(detalhe.json().livro.estoque).toBe(2);
});

test("preço no Carrinho acompanha o catálogo e não reserva Estoque", async () => {
  const livro = await criarLivro(app, {
    isbn: "9780000000021",
    titulo: "Preço vivo",
    precoCentavos: 1000,
    estoque: 6,
  });
  const adicionado = await app.inject({
    method: "POST",
    url: "/carrinho/itens",
    payload: { livroId: livro.id, quantidade: 2 },
  });
  const cookie = cookieDe(adicionado);

  const reajuste = await app.inject({
    method: "PATCH",
    url: `/admin/livros/${livro.id}`,
    headers: { "x-api-key": "test-key" },
    payload: { precoCentavos: 1800 },
  });
  expect(reajuste.statusCode).toBe(200);

  const visto = await app.inject(comSessao(cookie, { method: "GET", url: "/carrinho" }));
  expect(visto.json().itens[0].precoAtualCentavos).toBe(1800);

  const detalhe = await app.inject({ method: "GET", url: `/livros/${livro.id}` });
  expect(detalhe.json().livro.estoque).toBe(6);
});
