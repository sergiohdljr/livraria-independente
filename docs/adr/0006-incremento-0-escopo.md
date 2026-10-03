# Incremento 0: API monólito modular sem cache/fila/UI

O corte descrito abaixo segue como Incremento 0. ADR-0008 e ADR-0009 superam, no corte seguinte, “sem processos separados” e “API Gateway por último”: o gateway público é o próprio processo de Checkout.

O primeiro corte é API-only com módulos `catalog`, `cart`, `checkout`, `payment`, `admin` (superfície HTTP), `shared`: listagem/detalhe/busca/filtros, admin CRUD/estoque (API key), carrinho persistido por sessão, checkout com transação de estoque + Pedido + Pagamento simulado, e-mail via porta fake, Postgres, logs de request. Ficam de fora de propósito: Redis/cache, fila de e-mail, API Gateway, UI, e processos separados. Ordem de estudo seguinte: observabilidade → cache → fila de e-mail → extrair Catálogo → extrair Checkout → API Gateway.
