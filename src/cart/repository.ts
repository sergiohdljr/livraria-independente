import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "../db.js";
import { AppError } from "../shared/errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SessaoCarrinho = {
  sessaoId: string;
  carrinhoId: string;
};

export type ItemCarrinho = {
  livroId: string;
  titulo: string;
  quantidade: number;
  precoAtualCentavos: number;
};

export async function resolverSessao(
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<SessaoCarrinho> {
  const cookie = request.cookies["sessao"];
  if (cookie && UUID.test(cookie)) {
    const existing = await pool.query<{ carrinho_id: string }>(
      `SELECT c.id AS carrinho_id
       FROM sessoes s
       JOIN carrinhos c ON c.sessao_id = s.id
       WHERE s.id = $1`,
      [cookie],
    );
    const row = existing.rows[0];
    if (row) return { sessaoId: cookie, carrinhoId: row.carrinho_id };
  }

  const sessaoId = randomUUID();
  const carrinhoId = randomUUID();
  await pool.query("INSERT INTO sessoes (id) VALUES ($1)", [sessaoId]);
  await pool.query("INSERT INTO carrinhos (id, sessao_id) VALUES ($1, $2)", [carrinhoId, sessaoId]);
  reply.setCookie("sessao", sessaoId, { path: "/", httpOnly: true, sameSite: "lax" });
  return { sessaoId, carrinhoId };
}

export async function adicionarItem(
  pool: Pool,
  carrinhoId: string,
  livroId: string,
  quantidade: number,
): Promise<void> {
  const livro = await pool.query("SELECT id FROM livros WHERE id = $1", [livroId]);
  if (!livro.rows[0]) throw new AppError(404, "livro_nao_encontrado");

  await pool.query(
    `INSERT INTO itens_carrinho (carrinho_id, livro_id, quantidade)
     VALUES ($1, $2, $3)
     ON CONFLICT (carrinho_id, livro_id)
     DO UPDATE SET quantidade = itens_carrinho.quantidade + EXCLUDED.quantidade`,
    [carrinhoId, livroId, quantidade],
  );
}

export async function alterarQuantidade(
  pool: Pool,
  carrinhoId: string,
  livroId: string,
  quantidade: number,
): Promise<void> {
  const result = await pool.query(
    `UPDATE itens_carrinho SET quantidade = $3
     WHERE carrinho_id = $1 AND livro_id = $2`,
    [carrinhoId, livroId, quantidade],
  );
  if (result.rowCount === 0) throw new AppError(404, "item_nao_encontrado");
}

export async function removerItem(pool: Pool, carrinhoId: string, livroId: string): Promise<void> {
  const result = await pool.query(
    `DELETE FROM itens_carrinho WHERE carrinho_id = $1 AND livro_id = $2`,
    [carrinhoId, livroId],
  );
  if (result.rowCount === 0) throw new AppError(404, "item_nao_encontrado");
}

export async function verCarrinho(pool: Pool, carrinhoId: string): Promise<ItemCarrinho[]> {
  const result = await pool.query<{
    livro_id: string;
    titulo: string;
    quantidade: number;
    preco_centavos: number;
  }>(
    `SELECT i.livro_id, l.titulo, i.quantidade, l.preco_centavos
     FROM itens_carrinho i
     JOIN livros l ON l.id = i.livro_id
     WHERE i.carrinho_id = $1
     ORDER BY l.titulo, i.livro_id`,
    [carrinhoId],
  );
  return result.rows.map((row) => ({
    livroId: row.livro_id,
    titulo: row.titulo,
    quantidade: row.quantidade,
    precoAtualCentavos: row.preco_centavos,
  }));
}
