# Módulo de Pagamento fake desde o Incremento 0

Existe um módulo `payment` separado no monólito desde o início, com adaptador simulado (sem gateway real). Motivo: isolar a porta de cobrança para o checkout orquestrar Pedido + Estoque + Pagamento sem embutir flag solta no Pedido, e facilitar um incremento futuro de gateway/saga. Rejeitado: só `pagamento_simulado` no Pedido (acopla e esconde o conceito) e sandbox de gateway real cedo demais.
