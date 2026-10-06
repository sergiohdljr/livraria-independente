# Postgres local via Compose

O app esperava um Postgres já instalado na máquina, papel `movielogger` em `localhost:5432`, e os databases criados à mão. O runtime local passa a ser um Compose só desta livraria, projeto `livraria-independente`: `postgres:16` e o gateway em modo dev (`node:22`, `tsx --watch` na porta 3000).

O database segue `livraria_independente`, com os schemas `catalog`, `cart`, `checkout` e `payment`. O mesmo container cria `livraria_independente_test` quando o volume está vazio. O papel é `livraria`. Na rede do Compose a URL é `postgres:5432`; no host a porta publicada é 5433, para conviver com outro Postgres em 5432. `npm test` continua no host, em `localhost:5433/livraria_independente_test`. O fallback do código e o `.env.example` usam essa URL do host. O serviço `app` recebe a URL da rede pelo Compose. Sem dotenv.

Ficam de fora a imagem de produção e um papel por schema. O código usa um `DATABASE_URL` só; os papéis do ADR-0008 não entram neste corte. Dados do Postgres sobrevivem a `docker compose down` (volume nomeado); zerar é `docker compose down -v`. `node_modules` do container é outro volume: troca de lockfile pede build de novo e recriar esse volume.

Alternativas rejeitadas: criar o database no Postgres compartilhado do `movielogger`; subir só o banco e deixar o Node no host; nomear o database `livraria-independente` (hífen exige aspas e quebra a URL que o código já usa).
