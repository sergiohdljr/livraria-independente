# Monólito modular primeiro; microsserviços só por incremento de estudo

A parte “um processo e um banco compartilhado” foi superada por ADR-0008 (um Postgres, um schema privado por serviço, HTTP entre processos). O restante deste ADR permanece: não separar database por serviço no dia 1, e não tratar Admin como serviço.

O diagrama conceitual sugere serviços Catálogo, Carrinho/Checkout e Admin separados. Como o objetivo é estudo iterativo de microsserviços, decidimos começar com **um processo e um banco**, módulos com fronteiras explícitas (`catalog`, `cart`, `checkout`, `admin`, `email`), e só extrair processos/filas/bancos quando o conceito correspondente entrar no aprendizado. Alternativas rejeitadas: serviços + DB compartilhado (monólito distribuído cedo demais) e serviços + DBs separados no dia 1 (custo de orquestração antes do domínio estabilizar).
