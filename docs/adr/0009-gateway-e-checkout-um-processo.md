# O gateway público é o processo de Checkout

O único host que o Comprador e o Admin chamam é o processo de Checkout. Ele possui o schema `checkout`, o Pedido, o Frete, o CEP e a porta de e-mail. Encaminha `/books` e `/admin/books` para Catálogo e `/cart` para Carrinho, e é o único chamador de Pagamento. Catálogo, Carrinho e Pagamento continuam processos separados, cada um no seu schema (ADR-0008).

Alternativa rejeitada: um proxy sem domínio mais um processo de Checkout atrás dele. Isso atrasava o gateway para o fim de ADR-0006 e punha a criação do Pedido num processo que o Comprador não alcançava direto. Consequência: não existe um quinto processo só para rotear.
