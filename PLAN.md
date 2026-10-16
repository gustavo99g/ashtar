# Plano — v0.2.1: identidade na API

Primeira metade da entrega conjunta v0.2.1 + v0.2.2 (`docs/roadmap.md`): **só a API**. Banco, membros,
dispositivo, sessão, convites com histórico, a permissão do beta e o `admin` pela linha de comando. A
segunda metade (UI nova, v0.2.2) é quem passa a usar as rotas. O plano da fase anterior está arquivado em
[`docs/plans/v0.2.0-base-de-entrega.md`](docs/plans/v0.2.0-base-de-entrega.md).

**Objetivo desta fase:** a API sabe quem é cada membro, qual computador é o dele e quem pode o quê, e o dono
administra tudo pelo `admin`, **sem que o app instalado perceba nada**. A rota `/api/voice/join` de hoje
continua igual.

**Fora do escopo (vai com a parte visual, v0.2.2):** o cálculo da chave do dispositivo no desktop, as telas
de convite e de nick, o app chamando as rotas novas, o fim do código de acesso provisório e a subida do
`MIN_CLIENT_VERSION`. A correção do eco (`BACKLOG.md`, "Correções fora de ordem") também não está aqui.

**Esta parte não gera versão do app:** a API roda no computador de casa e não passa pelo auto-update. O
`desktop/package.json` continua em `0.2.0`, então o merge na `dev` não publica nada no beta.

Base: branch `dev`, commit `da8039c` (a `0.2.0` publicada no beta). Em cada etapa, `cargo fmt --check`,
`cargo clippy --all-targets -- -D warnings` e `cargo test` (em `api/`) devem passar.

## Progresso

| Etapa | Descrição | Status |
|---|---|---|
| 0 | Decisões (ADRs 0010 e 0011) | Concluída |
| 1 | Banco: `lib.rs`, SQLite com migrações, `DATABASE_URL` | Concluída |
| 2 | Regras: membros, permissões, dispositivo, sessão e convites, sem HTTP | Concluída |
| 3 | Rotas novas, limite de tentativas e testes de integração | Concluída |
| 4 | O binário `admin` | Pendente |
| 5 | Operação: backup agendado, teste de restauração e documentação | Pendente |

Branches sugeridos: `entrega/identidade-api` a partir da `dev`, um pull request por etapa para dentro dela
e, no fim, um para a `dev`. O CI da API roda em todo push que mexe em `api/**`.

---

## Decisões

As decisões de arquitetura estão nas ADRs, que são a fonte: [`0010-banco-sqlite.md`](docs/adr/0010-banco-sqlite.md)
(banco) e [`0011-identidade-sessao-convites.md`](docs/adr/0011-identidade-sessao-convites.md) (dispositivo,
sessão, convites, permissões e limite de tentativas). Abaixo, o que foi combinado para esta fase e o que este
plano decidiu além disso.

### Combinado

- Só a API agora; a rota atual continua; a parte visual aponta para as rotas novas depois.
- **Dono** (o "usuário supremo") é uma marca no usuário e pode tudo. Só muda pelo `admin`.
- **Membros** sem cargos por enquanto. Toda checagem passa por uma função só, `permissions::can`; quando os
  cargos vierem, muda o miolo dela e o resto continua igual.
- **Só o dono cria convites**, por enquanto.
- **Beta** como permissão numa tabela (`user_permissions`), ligada e desligada pelo `admin`. O dono está
  sempre no beta. A mesma tabela vira a das permissões diretas quando os cargos chegarem.
- **Um dispositivo por usuário** (índice único no banco; uma migração tira quando quiser liberar mais).
- **Convites** com validade e limite de usos, o que vier primeiro. Para mandar no grupo, algo como 5 minutos
  e 8 usos; o padrão é 7 dias e 1 uso, para mandar no privado. Revogáveis a qualquer momento (quem já entrou
  continua). O código aparece uma vez só. O convite e os seus usos são o histórico: quem criou, quem entrou
  com ele, quando. A recuperação é sempre de uso único.
- **Remover membro:** marca como removido, derruba o computador e a sessão, libera o nick. O histórico fica.
- **Sessão** sem expiração; cai quando o computador é trocado, desvinculado ou o membro é removido.
- **Nick** de 2 a 32 caracteres, único sem diferenciar maiúscula de minúscula.
- **Segredos só como hash**, **ids UUID**, **`/api/me`**, **`admin` como segundo binário na mesma crate**.

### Decidido neste plano

1. **Sem a rota para o token aleatório do dispositivo.** O roadmap dizia que a API geraria um token aleatório
   para quando o hardware não serve. Gerar no próprio desktop (32 bytes do sistema) dá o mesmo resultado, e
   para a API as duas chaves são iguais: um texto que ela guarda como hash. A regra de quando usar o
   aleatório fica no desktop, com a parte visual.
2. **Consultas do sqlx sem as macros `query!`.** As macros checam o SQL na compilação, mas exigem um banco ou
   a pasta `.sqlx` (`cargo sqlx prepare`) no CI. Com `sqlx::query`/`query_as`, o CI não muda nada, e todo SQL
   roda nos testes de integração mesmo assim.
3. **Limite de tentativas global, não por IP:** atrás do Tailscale Funnel todas as chamadas chegam do mesmo
   endereço local. 20 convites errados a cada 10 minutos, somando todo mundo. O login fica fora do limite
   (ADR 0011): a chave do dispositivo não se adivinha, e contar o login travaria os convites de todos.
4. **Até 50 usos por convite.** Mais que isso é um convite aberto demais para o tamanho do grupo.
5. **A recuperação também serve para o dono vincular o primeiro computador.** O `admin dono` cria o dono sem
   computador; quando a parte visual chegar, você gera uma recuperação para você mesmo.
6. **Nomes no código em inglês, mensagens em português**, como no resto do repositório. Os comandos do
   `admin` ficam em português, porque é você quem digita.
7. **A pasta `api/src/services/` sai:** as regras moram em `identity/`.

---

## Etapa 0: decisões — concluída

As duas ADRs, commitadas em `32316b4`: [`0010`](docs/adr/0010-banco-sqlite.md) e
[`0011`](docs/adr/0011-identidade-sessao-convites.md).

## Etapa 1: banco — concluída

- Transformar a API numa biblioteca (`lib.rs`) mais os binários (`main.rs` e, na Etapa 4, `admin`).
- SQLite pelo `sqlx`, em modo WAL e com `busy_timeout` de 5 s; migrações em `api/migrations/`, embutidas com
  `sqlx::migrate!` e executadas ao abrir o banco; caminho por `DATABASE_URL` (e no `.env.example`).
- Primeira migração com o esquema das ADRs: usuários, dispositivos, sessões, convites, usos de convite e
  `user_permissions`. Segredos só como SHA-256; ids UUID; índice único de um dispositivo por usuário; nick
  único sem diferenciar maiúscula.
- Remover `api/src/services/`.

**Pronto quando:** a API sobe e cria o arquivo do banco com as migrações aplicadas; abrir de novo não refaz
nada; `cargo test` roda as migrações num banco em memória; a rota `/api/voice/join` responde como antes.

## Etapa 2: regras — concluída

Módulo `identity/`, **sem HTTP**, testado direto sobre o banco em memória.

- **Membros:** criar, validar o nick (2 a 32 caracteres, único sem diferenciar maiúscula), remover (marca
  como removido, derruba computador e sessão, libera o nick, mantém o histórico).
- **Permissões:** `permissions::can` (hoje só o dono administra), o dono sempre no beta e a tabela
  `user_permissions` com `atualizacoes.beta`.
- **Dispositivo:** a chave recebida (texto de 32 a 128 caracteres) guardada só como SHA-256; um por membro.
- **Sessão:** token aleatório de 32 bytes, guardado só como SHA-256, uma por dispositivo; consultada no banco
  a cada chamada.
- **Convites:** código de 12 caracteres no alfabeto Crockford, mostrado uma vez e guardado só como hash;
  tipos "novo" e "recuperação"; validade e limite de usos de 1 a 50; revogação; usos em `invite_uses`, que
  nunca são apagados.

**Pronto quando:** testes cobrindo os casos de borda das ADRs: nick repetido com outra caixa, convite
vencido, esgotado e revogado, recuperação de uso único, segundo dispositivo recusado, membro removido sem
sessão e sem nick preso.

## Etapa 3: rotas — concluída

- Rotas novas sobre as regras da Etapa 2: login com a chave (`POST /api/auth/login`), uso de convite (novo e
  de recuperação, `POST /api/auth/redeem`), `GET /api/me` (permissões e canal de atualização) e
  `POST /api/voice/token` (identidade e nome vêm do banco). Autenticação por `Authorization: Bearer <token>`.
  **Criar, listar e revogar convites ficam só no `admin` (Etapa 4):** o dono administra pela linha de comando,
  não por rota.
- Limite de tentativas: até 20 convites errados a cada 10 minutos, somando todo mundo. O login não entra na
  conta e não é bloqueado pelo limite.
- Testes de integração da API (convites, dispositivo, sessão, permissões e o limite), rodando no CI. Ficam
  num arquivo só, `api/tests/identity.rs`: as rotas pelo HTTP (`oneshot`, sem subir servidor) e o módulo
  `regras`, direto sobre o banco, inclusive a concorrência em arquivo.
- A rota `/api/voice/join` e o middleware de `client_policy` continuam como estão. As rotas novas também
  passam pelo `client_policy`: com `ACCESS_CODE` ligado, exigem o `X-Access-Code`.

Além do previsto, saiu com esta etapa:

- **`ApiJson`:** corpo inválido responde no formato `{ kind, message }` (422, `invalid_request`), não em texto
  puro. Só nas rotas novas; a rota antiga continua igual.
- **`Authorization: Bearer`** sem diferenciar maiúscula de minúscula (RFC 9110).
- **`channel_id` validado** em `/api/voice/token`: de 1 a 64 caracteres, letras ASCII, números, `_` e `-`.
- **Erros da API** mapeados por tipo para status e `kind` (`error.rs`), e violações de índice único tratadas
  como erro de regra, não como erro 500.

**Pronto quando:** do convite ao login e a `/api/me` funciona pelo HTTP nos testes; a 21ª tentativa errada
em 10 minutos é recusada (e o login de quem já é membro continua funcionando); e o app instalado continua entrando pela rota antiga sem mudar nada.

## Etapa 4: `admin` — pendente

Segundo binário na mesma crate (`api/src/bin/admin.rs`), com os comandos em português, abrindo o banco (e as
migrações) como a API, com a API no ar (WAL).

- Criar o dono (sem computador), marcar e desmarcar o beta de um membro, gerar convite (novo e de
  recuperação), revogar, listar membros e convites, remover membro e desvincular dispositivo, ver as
  permissões de um membro e `backup` (cópia consistente com `VACUUM INTO`, com data no nome e retenção).

**O `admin` é temporário.** A ideia é mover a administração para a UI já na v0.2.2, com rotas de administração
na API sobre as mesmas funções de `identity/` (que já recebem o `actor` e passam por `permissions::can`). Por
isso o binário fica enxuto, sem testes próprios, sem confirmação nos comandos e sem comandos além dos acima: o
que vale está na biblioteca, que tem os testes. Provavelmente sobrevivem como linha de comando só o `dono`
(cria o dono antes de existir qualquer sessão) e o `backup` (é o que o Agendador do Windows chama).

**Pronto quando:** do zero, `admin dono` + um convite de grupo + um convite de recuperação para o dono
fazem o fluxo inteiro sem escrever SQL, com a API ligada.

## Etapa 5: operação — pendente

- Backup agendado no Windows com `VACUUM INTO`, copiado para fora do computador (ADR 0010).
- Teste de restauração: apagar o banco, restaurar a cópia e conferir membros, convites e permissões.
- Documentação: `DATABASE_URL`, `admin` e o backup no `README.md`/`ARCHITECTURE.md`.

**Pronto quando:** o backup roda sozinho, uma restauração de teste foi feita e conferida, e o `README.md`
explica como subir a API com o banco.

---

**Critério de pronto da fase:** os critérios do roadmap para a v0.2.1 que dependem só da API (banco, convite,
dispositivo, permissões, rate limiting e testes de integração), a rota antiga intacta, e todos os itens do
`NOTES.md` resolvidos ou conscientemente adiados.
