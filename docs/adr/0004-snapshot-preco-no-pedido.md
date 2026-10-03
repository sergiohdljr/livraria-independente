# Preço e título congelados no Pedido no checkout

O Pedido grava snapshot de preço (e identificação textual do Livro) no momento do checkout. O Carrinho não congela preço de forma vinculante e não reserva Estoque; o catálogo pode mudar enquanto o item está no Carrinho. Alternativa rejeitada: usar sempre o preço atual sem snapshot (quebra histórico) ou congelar preço ao adicionar ao Carrinho (acopla demais um carrinho que já é só intenção).
