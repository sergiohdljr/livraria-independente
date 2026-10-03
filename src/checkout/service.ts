import { randomUUID } from "node:crypto";
import type { Pool } from "../db.js";
import type { EmailPort } from "../email/fake.js";
import type { PagamentoStatus, PaymentPort } from "../payment/fake.js";
import { AppError } from "../shared/errors.js";

export type ItemPedido = {
  livroId: string;
  isbn: string;
  titulo: string;
  autor: string;
  quantidade: number;
  precoUnitarioCentavos: number;
};

export type Pedido = {
  id: string;
  status: "criado";
  cep: string;
  endereco: string;
  email: string;
  freteCentavos: number;
  totalCentavos: number;
  itens: ItemPedido[];
};

export type CheckoutInput = {
  sessaoId: string;
  cep: string;
  endereco: string;
  email: string;
  simular?: PagamentoStatus;
};

export type CheckoutOk = {
  pedido: Pedido;
  pagamento: { status: "aceito"; valorCentavos: number };
  confirmacaoEmail: "enviada";
};

type CartLine = {
  livro_id: string;
  quantidade: number;
  isbn: string;
  titulo: string;
  autor: string;
  preco_centavos: number;
  estoque: number;
};

export async function executarCheckout(
  pool: Pool,
  payment: PaymentPort,
  email: EmailPort,
  input: CheckoutInput,
): Promise<CheckoutOk> {
  const cepNumerico = normalizarCep(input.cep);
  const freteCentavos = await freteParaCep(pool, cepNumerico);

  const linhas = await carregarCarrinho(pool, input.sessaoId);
  if (linhas.length === 0) throw new AppError(422, "carrinho_vazio");

  for (const linha of linhas) {
    if (linha.quantidade > linha.estoque) throw new AppError(409, "estoque_insuficiente");
  }

  const subtotal = linhas.reduce((soma, linha) => soma + linha.quantidade * linha.preco_centavos, 0);
  const totalCentavos = subtotal + freteCentavos;

  const cobranca = await payment.cobrar({ valorCentavos: totalCentavos, simular: input.simular });
  if (cobranca.status === "recusado") throw new AppError(402, "pagamento_recusado");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query<CartLine>(
      `SELECT i.livro_id, i.quantidade, l.isbn, l.titulo, l.autor, l.preco_centavos, l.estoque
       FROM carrinhos c
       JOIN itens_carrinho i ON i.carrinho_id = c.id
       JOIN livros l ON l.id = i.livro_id
       WHERE c.sessao_id = $1
       ORDER BY i.livro_id
       FOR UPDATE OF l`,
      [input.sessaoId],
    );

    if (locked.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new AppError(422, "carrinho_vazio");
    }

    for (const linha of locked.rows) {
      if (linha.quantidade > linha.estoque) {
        await client.query("ROLLBACK");
        console.error(
          `pagamento aceito sem pedido sessao=${input.sessaoId} valor=${totalCentavos}`,
        );
        throw new AppError(409, "estoque_insuficiente");
      }
    }

    const pedidoId = randomUUID();
    const itens: ItemPedido[] = locked.rows.map((linha) => ({
      livroId: linha.livro_id,
      isbn: linha.isbn,
      titulo: linha.titulo,
      autor: linha.autor,
      quantidade: linha.quantidade,
      precoUnitarioCentavos: linha.preco_centavos,
    }));
    const subtotalTravado = itens.reduce(
      (soma, item) => soma + item.quantidade * item.precoUnitarioCentavos,
      0,
    );
    const totalTravado = subtotalTravado + freteCentavos;

    await client.query(
      `INSERT INTO pedidos (id, sessao_id, status, cep, endereco, email, frete_centavos, total_centavos)
       VALUES ($1, $2, 'criado', $3, $4, $5, $6, $7)`,
      [pedidoId, input.sessaoId, cepNumerico, input.endereco, input.email, freteCentavos, totalTravado],
    );

    for (const item of itens) {
      await client.query(
        `INSERT INTO itens_pedido
           (id, pedido_id, livro_id, isbn, titulo, autor, quantidade, preco_unitario_centavos)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          randomUUID(),
          pedidoId,
          item.livroId,
          item.isbn,
          item.titulo,
          item.autor,
          item.quantidade,
          item.precoUnitarioCentavos,
        ],
      );
      const debit = await client.query(
        `UPDATE livros SET estoque = estoque - $2 WHERE id = $1 AND estoque >= $2`,
        [item.livroId, item.quantidade],
      );
      if (debit.rowCount !== 1) {
        await client.query("ROLLBACK");
        console.error(
          `pagamento aceito sem pedido sessao=${input.sessaoId} valor=${totalCentavos}`,
        );
        throw new AppError(409, "estoque_insuficiente");
      }
    }

    await client.query(
      `INSERT INTO pagamentos (id, pedido_id, status, valor_centavos) VALUES ($1, $2, 'aceito', $3)`,
      [randomUUID(), pedidoId, totalTravado],
    );

    await client.query(
      `DELETE FROM itens_carrinho
       WHERE carrinho_id = (SELECT id FROM carrinhos WHERE sessao_id = $1)`,
      [input.sessaoId],
    );

    await client.query("COMMIT");

    const pedido: Pedido = {
      id: pedidoId,
      status: "criado",
      cep: cepNumerico,
      endereco: input.endereco,
      email: input.email,
      freteCentavos,
      totalCentavos: totalTravado,
      itens,
    };

    await email.enviarConfirmacaoPedido({
      para: input.email,
      pedidoId,
      totalCentavos: totalTravado,
    });

    return {
      pedido,
      pagamento: { status: "aceito", valorCentavos: totalTravado },
      confirmacaoEmail: "enviada",
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // transaction already finished
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function buscarPedido(pool: Pool, sessaoId: string, pedidoId: string): Promise<Pedido> {
  const pedido = await pool.query<{
    id: string;
    status: "criado";
    cep: string;
    endereco: string;
    email: string;
    frete_centavos: number;
    total_centavos: number;
  }>(
    `SELECT id, status, cep, endereco, email, frete_centavos, total_centavos
     FROM pedidos WHERE id = $1 AND sessao_id = $2`,
    [pedidoId, sessaoId],
  );
  const row = pedido.rows[0];
  if (!row) throw new AppError(404, "pedido_nao_encontrado");

  const itens = await pool.query<{
    livro_id: string;
    isbn: string;
    titulo: string;
    autor: string;
    quantidade: number;
    preco_unitario_centavos: number;
  }>(
    `SELECT livro_id, isbn, titulo, autor, quantidade, preco_unitario_centavos
     FROM itens_pedido WHERE pedido_id = $1 ORDER BY titulo, livro_id`,
    [pedidoId],
  );

  return {
    id: row.id,
    status: "criado",
    cep: row.cep,
    endereco: row.endereco,
    email: row.email,
    freteCentavos: row.frete_centavos,
    totalCentavos: row.total_centavos,
    itens: itens.rows.map((item) => ({
      livroId: item.livro_id,
      isbn: item.isbn,
      titulo: item.titulo,
      autor: item.autor,
      quantidade: item.quantidade,
      precoUnitarioCentavos: item.preco_unitario_centavos,
    })),
  };
}

async function carregarCarrinho(pool: Pool, sessaoId: string): Promise<CartLine[]> {
  const result = await pool.query<CartLine>(
    `SELECT i.livro_id, i.quantidade, l.isbn, l.titulo, l.autor, l.preco_centavos, l.estoque
     FROM carrinhos c
     JOIN itens_carrinho i ON i.carrinho_id = c.id
     JOIN livros l ON l.id = i.livro_id
     WHERE c.sessao_id = $1
     ORDER BY i.livro_id`,
    [sessaoId],
  );
  return result.rows;
}

function normalizarCep(cep: string): string {
  const digitos = cep.replace(/\D/g, "");
  if (digitos.length !== 8) throw new AppError(422, "cep_invalido");
  return digitos;
}

async function freteParaCep(pool: Pool, cep: string): Promise<number> {
  const numero = Number(cep);
  const result = await pool.query<{ valor_centavos: number }>(
    `SELECT valor_centavos FROM faixas_frete
     WHERE $1 BETWEEN cep_inicio AND cep_fim
     ORDER BY valor_centavos
     LIMIT 1`,
    [numero],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(422, "cep_sem_frete");
  return row.valor_centavos;
}
