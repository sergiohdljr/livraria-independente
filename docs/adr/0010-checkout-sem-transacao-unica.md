# Checkout sem transação única entre serviços

Com schemas privados (ADR-0008), Checkout não debita Estoque na mesma transação em que grava o Pedido. A ordem passa a ser HTTP, no processo que é o gateway (ADR-0009):

1. Ler Carrinho, Livros e Frete. Carrinho vazio, CEP sem Frete ou Estoque insuficiente para aqui. Pagamento não é chamado. Antes do passo 2, Checkout trava a Sessão no schema `checkout`. Outro checkout da mesma Sessão espera. A trava acaba com a conexão; uma queda do processo não deixa a Sessão presa. Se, ao seguir, já existe Pedido para as mesmas linhas, vale o passo 5: sem novo Pagamento.
2. Chamar Pagamento. `recusado` para aqui: sem Pedido, Estoque intacto, Carrinho mantido.
3. `aceito`: pedir ao Catálogo o débito de todas as linhas numa transação local. Se o débito falha, não há Pedido. Loga-se Pagamento `aceito` sem Pedido. Sem estorno.
4. Débito feito: gravar o Pedido com o snapshot de preço e o id do Pagamento. Se a gravação falha, o Catálogo repõe o Estoque na mesma quantidade e o log é o mesmo. O Comprador não recebe id de Pedido. Se a reposição também falha, a resposta é erro, sem id de Pedido, com log de Estoque debitado sem Pedido. Sem nova tentativa em loop e sem estorno.
5. Pedido gravado: esvaziar o Carrinho. Se essa chamada falha, Pedido e débito permanecem. Devolve-se o Pedido e loga-se o Carrinho não esvaziado. Enquanto o Carrinho ainda tiver as mesmas linhas, outro `POST /checkout` dessa Sessão não chama Pagamento: devolve o Pedido e tenta esvaziar de novo. Linhas diferentes são um checkout novo.
6. Disparar a porta de e-mail depois da tentativa de esvaziar, também quando o Carrinho ficou cheio. Falha da porta não desfaz Pedido nem Estoque. O Comprador ainda recebe o Pedido.

O snapshot de preço é o da leitura do passo 1, o mesmo valor cobrado. Checkout não relê o preço antes de gravar o Pedido.

Débito, reposição, esvaziar Carrinho e cobrar escutam só em portas internas, com uma chave interna distinta da API key de Admin. O gateway público não as roteia.

Isso substitui, neste corte, a transação única de ADR-0007. Permanecem a ordem (Pagamento antes de comprometer Estoque e Pedido), o `recusado` sem escrita, e a limitação do fake: `aceito` sem Pedido não tem estorno.
