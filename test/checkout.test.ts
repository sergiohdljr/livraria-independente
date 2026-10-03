import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { adminApiKey, cookieDe, comSessao, criarLivro, startApp } from "./helpers.js";

let app: FastifyInstance;
let pool: Pool;

beforeAll(async () => {
  ({ app, pool } = await startApp());
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

const entrega = {
  cep: "01310-100",
  endereco: "Rua Augusta, 100",
  email: "comprador@example.com",
};

async function carrinhoCom(livroId: string, quantidade: number): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/carrinho/itens",
    payload: { livroId, quantidade },
  });
  expect(response.statusCode).toBe(201);
  return cookieDe(response);
}

test("checkout aceito cria Pedido, debita Estoque, esvazia Carrinho e confirma e-mail", async () => {
  const livro = await criarLivro(app, {
    isbn: "9780000000030",
    titulo: "Vidas Secas",
    autor: "Graciliano Ramos",
    precoCentavos: 2000,
    estoque: 4,
  });
  const cookie = await carrinhoCom(livro.id, 2);

  const checkout = await app.inject(
    comSessao(cookie, { method: "POST", url: "/checkout", payload: entrega }),
  );

  expect(checkout.statusCode).toBe(201);
  const body = checkout.json();
  expect(body.confirmacaoEmail).toBe("enviada");
  expect(body.pagamento).toEqual({ status: "aceito", valorCentavos: 4000 + 1500 });
  expect(body.pedido.status).toBe("criado");
  expect(body.pedido.freteCentavos).toBe(1500);
  expect(body.pedido.itens).toEqual([
    {
      livroId: livro.id,
      isbn: "9780000000030",
      titulo: "Vidas Secas",
      autor: "Graciliano Ramos",
      quantidade: 2,
      precoUnitarioCentavos: 2000,
    },
  ]);

  const carrinho = await app.inject(comSessao(cookie, { method: "GET", url: "/carrinho" }));
  expect(carrinho.json().itens).toEqual([]);

  const detalhe = await app.inject({ method: "GET", url: `/livros/${livro.id}` });
  expect(detalhe.json().livro.estoque).toBe(2);
});

test("Pagamento recusado não cria Pedido nem muda Estoque ou Carrinho", async () => {
  const livro = await criarLivro(app, { isbn: "9780000000031", titulo: "Recusa", estoque: 3, precoCentavos: 1000 });
  const cookie = await carrinhoCom(livro.id, 1);

  const checkout = await app.inject(
    comSessao(cookie, {
      method: "POST",
      url: "/checkout",
      headers: { "x-pagamento-simulado": "recusado" },
      payload: entrega,
    }),
  );

  expect(checkout.statusCode).toBe(402);
  expect(checkout.json()).toEqual({ erro: "pagamento_recusado" });

  const carrinho = await app.inject(comSessao(cookie, { method: "GET", url: "/carrinho" }));
  expect(carrinho.json().itens).toHaveLength(1);
  const detalhe = await app.inject({ method: "GET", url: `/livros/${livro.id}` });
  expect(detalhe.json().livro.estoque).toBe(3);
});

test("CEP fora das faixas de Frete é recusado e o Carrinho permanece", async () => {
  const livro = await criarLivro(app, { isbn: "9780000000032", titulo: "Frete", estoque: 2 });
  const cookie = await carrinhoCom(livro.id, 1);

  const checkout = await app.inject(
    comSessao(cookie, {
      method: "POST",
      url: "/checkout",
      payload: { ...entrega, cep: "99999-999" },
    }),
  );

  expect(checkout.statusCode).toBe(422);
  expect(checkout.json()).toEqual({ erro: "cep_sem_frete" });
  const detalhe = await app.inject({ method: "GET", url: `/livros/${livro.id}` });
  expect(detalhe.json().livro.estoque).toBe(2);
  const carrinho = await app.inject(comSessao(cookie, { method: "GET", url: "/carrinho" }));
  expect(carrinho.json().itens).toHaveLength(1);
});

test("Estoque insuficiente impede o checkout", async () => {
  const livro = await criarLivro(app, { isbn: "9780000000033", titulo: "Esgotado", estoque: 1 });
  const cookie = await carrinhoCom(livro.id, 2);

  const checkout = await app.inject(
    comSessao(cookie, { method: "POST", url: "/checkout", payload: entrega }),
  );

  expect(checkout.statusCode).toBe(409);
  expect(checkout.json()).toEqual({ erro: "estoque_insuficiente" });
  const detalhe = await app.inject({ method: "GET", url: `/livros/${livro.id}` });
  expect(detalhe.json().livro.estoque).toBe(1);
});

test("preço do Item de Pedido fica congelado se o catálogo mudar depois", async () => {
  const livro = await criarLivro(app, { isbn: "9780000000034", titulo: "Snapshot", precoCentavos: 1000, estoque: 2 });
  const cookie = await carrinhoCom(livro.id, 1);

  const checkout = await app.inject(
    comSessao(cookie, { method: "POST", url: "/checkout", payload: entrega }),
  );
  expect(checkout.statusCode).toBe(201);
  expect(checkout.json().pedido.itens[0].precoUnitarioCentavos).toBe(1000);
  expect(checkout.json().pedido.totalCentavos).toBe(1000 + 1500);

  const preco = await app.inject({
    method: "PATCH",
    url: `/admin/livros/${livro.id}`,
    headers: { "x-api-key": adminApiKey },
    payload: { precoCentavos: 9000 },
  });
  expect(preco.statusCode).toBe(200);

  const pedido = await app.inject(
    comSessao(cookie, { method: "GET", url: `/pedidos/${checkout.json().pedido.id}` }),
  );
  expect(pedido.json().pedido.itens[0].precoUnitarioCentavos).toBe(1000);

  const detalhe = await app.inject({ method: "GET", url: `/livros/${livro.id}` });
  expect(detalhe.json().livro.precoCentavos).toBe(9000);
});

test("checkouts concorrentes não vendem o mesmo Estoque duas vezes", async () => {
  const livro = await criarLivro(app, { isbn: "9780000000035", titulo: "Último", estoque: 1, precoCentavos: 500 });
  const cookieA = await carrinhoCom(livro.id, 1);
  const cookieB = await carrinhoCom(livro.id, 1);

  const [a, b] = await Promise.all([
    app.inject(comSessao(cookieA, { method: "POST", url: "/checkout", payload: { ...entrega, email: "a@example.com" } })),
    app.inject(comSessao(cookieB, { method: "POST", url: "/checkout", payload: { ...entrega, email: "b@example.com" } })),
  ]);

  const statuses = [a.statusCode, b.statusCode].sort();
  expect(statuses).toEqual([201, 409]);

  const detalhe = await app.inject({ method: "GET", url: `/livros/${livro.id}` });
  expect(detalhe.json().livro.estoque).toBe(0);
});
