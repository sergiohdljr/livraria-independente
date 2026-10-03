# Catálogo e Checkout da Livraria Independente

Contexto de venda online de uma livraria de bairro: catálogo de livros, carrinho, pedido e administração básica de estoque.

## Language

**Livro**:
Unidade de venda (SKU) identificada por ISBN, com título, autor, preço e quantidade em estoque.
_Avoid_: Produto, Exemplar, Item de catálogo

**Estoque**:
Quantidade disponível de um Livro para venda.
_Avoid_: Inventário, disponibilidade (como entidade separada)

**Comprador**:
Pessoa que navega o catálogo e fecha pedido sem conta cadastrada; identificada na sessão e pelos dados informados no checkout.
_Avoid_: Cliente, Usuário, Account

**Admin**:
Pessoa autenticada que cria/edita Livros e ajusta Estoque.
_Avoid_: Operador, Backoffice user

**Carrinho**:
Coleção persistida de intenções de compra de um Comprador anônimo, identificada por sessão; não reserva Estoque.
_Avoid_: Pedido pendente, Wishlist, Basket

**Sessão**:
Identificador anônimo que amarra o Comprador ao seu Carrinho entre requisições.
_Avoid_: Conta, Login, User id

**Pedido**:
Registro imutável da compra concluída no checkout, com dados do Comprador, itens com preço congelado, frete e total; nasce como `criado` quando o Estoque é debitado.
_Avoid_: Compra, Transação, Order pending, Carrinho finalizado

**Item de Pedido**:
Linha imutável de um Pedido: Livro (referência), quantidade e preço unitário no momento do checkout.
_Avoid_: Item de Carrinho, Linha de fatura

**Item de Carrinho**:
Linha mutável de um Carrinho: Livro e quantidade desejada; não garante Estoque nem preço final.
_Avoid_: Item de Pedido, Reserva

**Frete**:
Valor de envio derivado de faixas de CEP configuradas internamente.
_Avoid_: Shipping service, Correios (como integração)

**CEP**:
Código postal do endereço de entrega; válido para checkout só se pertencer a uma faixa com Frete definido.
_Avoid_: Endereço completo (o CEP é o critério de frete; o endereço textual é dado do Pedido)

**Pagamento**:
Cobrança simulada do valor total do Pedido, sem escolha de meio pelo Comprador nesta fase; persiste status `aceito` ou `recusado` e o valor tentado.
_Avoid_: Gateway, Transação financeira, Invoice, Meio de pagamento (como escolha do Comprador no Incremento 0)
