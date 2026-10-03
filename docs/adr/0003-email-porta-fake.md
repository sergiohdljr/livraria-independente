# E-mail atrás de porta; fila só num incremento futuro

A confirmação de Pedido por e-mail entra cedo como **porta de aplicação** com adaptador fake (log/console), não como fila + worker no primeiro corte. O diagrama conceitual prevê fila; ela fica como incremento explícito de messaging quando formos extrair o módulo de e-mail. SMTP real também fica para depois.
