# Checkout: Pagamento antes de comprometer Estoque/Pedido

A transação única descrita abaixo vale para o monólito do Incremento 0. No corte com schemas separados, ADR-0010 substitui essa transação pela sequência HTTP. A ordem e a limitação do fake permanecem.

No `POST /checkout`, a ordem é: validar carrinho, CEP/frete e disponibilidade → chamar o módulo `payment` (simulador) → só se `aceito`, em uma transação de banco criar Pedido + Itens (snapshot) + registro de Pagamento + debitar Estoque + esvaziar Carrinho → dispara confirmação por e-mail (porta fake). Se o Pagamento for `recusado`, o banco não muda. Compensação/saga (cobrar depois de gravar Pedido) fica para quando houver gateway real ou serviços separados. Limitação aceita do fake: se o payment “aceitar” e a transação DB falhar, não há estorno real — só log/erro.
