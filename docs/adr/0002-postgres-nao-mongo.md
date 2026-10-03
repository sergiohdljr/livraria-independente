# Postgres como banco do monólito (não Mongo)

Reusamos o estilo de runtime do `marketplace-catalog` (TypeScript, Fastify, Vitest), mas a persistência é **Postgres**, não Mongo. Motivo: o NFR exige atualização de Estoque ao fechar Pedido com consistência forte (transação); relacional encaixa nisso e no caminho futuro de extrair serviços com o mesmo motor. SQLite foi rejeitado como store principal por afastar o estudo do alvo operacional descrito nos requisitos, embora possa aparecer só em testes se necessário.
