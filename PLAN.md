# Plano — v0.5: salas e presença

As pendências estão no [`NOTES.md`](NOTES.md). O plano da fase anterior está arquivado em
[`docs/plans/v0.4-transmissoes-e-camera.md`](docs/plans/v0.4-transmissoes-e-camera.md).

A v0.5 tira a sala única do app: quem gerencia os canais cria salas de voz nas mesmas categorias dos canais de
texto, e qualquer pessoa troca de sala com um clique. Quem tem a permissão nova move os outros de sala, pelo cartão
ou arrastando na lista, e também os desconecta da voz. Cada canal de texto e cada sala de voz pode ser restrito a
uma lista de pessoas, e some para quem está fora dela. Em volta disso, a presença ganha o Ausente (manual e
automático), o "digitando…" e os sons da sala.

Sai numa versão só, a `0.5.0`, pelo beta antes do estável. O trabalho anda em duas partes, mas nenhuma é publicada
sozinha:

| Parte | O que é | Mexe em |
|---|---|---|
| 1 | Salas: criar, editar e arquivar sala de voz, o fim da sala fixa, trocar de sala, mover e desconectar alguém, e os canais e salas restritos | API, banco e app |
| 2 | Presença e sons: Ausente, "digitando…" e os sons da sala | API e app |

**Objetivo da fase:** o grupo se divide em mais de uma sala na mesma noite, cada um vê onde os outros estão e o que
estão fazendo, e ninguém precisa sair e entrar de novo para trocar de sala.

**Fora do escopo:** o "Reconectando" e o resto da confiabilidade (v0.6); anexos, imagens e o resto do chat
avançado (v0.7); a seção Moderação do cartão, com silenciar e deixar surdo para todos (v0.8, combinado em 19/11); status com texto
livre (fora, combinado em 19/11); chat de texto dentro da sala de voz (fora, combinado em 19/11); limite de pessoas
por sala (fora, combinado em 19/11); as pendências da v0.2.4, que continuam fora.

Base: a branch da v0.4 (PR #20, `f98f84a`), até a `0.4.0` chegar ao estável; depois, a `dev` com a `0.4.x`. Em cada
etapa, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` e `cargo test` (em `api/` e em
`desktop/src-tauri/`) e `pnpm lint`, `pnpm build` e `pnpm test` (em `desktop/`) devem passar.

## O que já existe

Levantado na branch da v0.4, para o plano não refazer:

- **O banco e a API já têm salas de voz.** A tabela `channels` guarda `kind` (`text` ou `voice`), a sala Sala é a
  linha `sala`, e o `POST /api/voice/token` e o `GET /api/voice/participants` já aceitam qualquer sala de voz
  aberta (ADR 0016). O que falta é o `POST /api/channels` aceitar `kind: voice`.
- **A lista de canais já mostra quem está em cada sala** (`RoomMembers` e `AvatarStrip` na `ChannelRow`), pelo
  evento `voice.participants`, que já vem com o `channel_id`.
- **O indicador de quem fala já existe**, nos blocos (`ParticipantTile`) e na lista da sala em que a pessoa está.
- **O app assume uma sala só:** a constante `SALA` (`features/voice/room/model/channel.ts`) é usada em 12 arquivos,
  e o diálogo de criar canal só cria canal de texto.

## Progresso

| Etapa | Parte | Descrição | Status |
|---|---|---|---|
| 0 | — | Decisões: ADRs 0026, 0027 e 0028, roadmap, BACKLOG | Concluída |
| 1 | 1 | API: criar, editar e arquivar sala de voz | Concluída |
| 2 | 1 | App: o fim da sala fixa | Concluída |
| 3 | 1 | App: criar, editar e arquivar sala de voz | Concluída |
| 4 | 1 | App: trocar de sala | Concluída |
| 5 | 1 | API: a permissão Mover membros, mover e desconectar | Concluída |
| 6 | 1 | App: Mover para e Desconectar no cartão | Concluída |
| 7 | 1 | App: arrastar uma pessoa para outra sala | Concluída |
| 8 | 1 | API: canais e salas restritos, a lista e a regra de acesso | Concluída |
| 9 | 1 | API: os eventos, as menções e as não lidas de um canal restrito | Concluída |
| 10 | 1 | App: canais e salas restritos | Concluída |
| 11 | 2 | API: o status Ausente | Concluída |
| 12 | 2 | App: Ausente manual e automático | Concluída |
| 13 | 2 | API e app: "digitando…" | Concluída |
| 14 | 2 | App: os sons da sala | Concluída |
| 15 | — | Teste com três computadores, sem publicar | Pendente |
| 16 | — | Lançamento da `0.5.0` | Pendente |

Dependências: a 1 e a 2 andam juntas, e a 3 e a 4 usam as duas. A 5 vai para a `dev` e para o servidor sozinha,
antes do lançamento: o app atual nunca chama as rotas novas. A 6 e a 7 usam a 4 (a pessoa movida troca de sala
pelo mesmo caminho) e a 5. A 8 usa a 1 e a 5 (mover para uma sala restrita), a 9 usa a 8, e a 10 usa a 3, a 8 e a 9. Na parte 2, a 11 vem antes da 12; a 13 e a 14 não dependem de nada da parte 1 e podem
andar em paralelo com ela.

Branch: `claude/project-thread-qf02oy`, saída da `dev`, num pull request só para a `dev`. As etapas 0 a 14 estão
nela; a 15 e a 16 são do Kid, com os três computadores.

### Como ficou (o que mudou do plano)

- **A Sala não pode ser arquivada** (decisão 3): continua protegida, como o `#geral`, e pode ser renomeada. Alguma sala
  de voz existe sempre, e o app antigo entra nela pelo id.
- **A lista de acesso** é a `channel_members` das conversas privadas, com a coluna `restricted` em `channels`
  (migração `0008`), e não uma `channel_access` nova. Ela vai junto do canal para quem o vê, não só para quem
  gerencia: o @ e o "Mover para" usam.
- **Sem cache da lista** (Etapa 9): quem recebe cada evento de canal é lido no banco na hora (`access::audience`). O
  `ServerEvent::of_channel` marca os eventos de canal sem `_` no `match`, e o `publish` para todos recusa um deles nos
  testes.
- **O cadeado** aparece para todos que veem o canal restrito, não só para quem gerencia.
- **O Ausente** precisou refazer a tabela `users` (migração `0009`), porque o `CHECK` do status não aceita valor novo.
  Numa ligação privada, como numa sala, ninguém fica ausente sozinho.
- **O `idle_seconds`** (`commands/presence.rs`) só compila e roda no Windows: conferir na Etapa 15. O app só é publicado na Etapa 16, que leva a
branch para a `dev` (beta) e depois para a `main`.

## Decisões

As decisões de arquitetura vão para as ADRs, que são a fonte:

- `0026-varias-salas-de-voz.md`: criar sala de voz, o fim da sala fixa, trocar de sala, mover e desconectar
  (atualiza a 0016 e a 0020).
- `0028-canais-restritos.md`: canais de texto e salas de voz restritos (decisões 14 a 18), que atualiza a 0021 (a
  regra de leitura ganha o terceiro caso) e a 0016.
- `0027-ausente-e-digitando.md`: o Ausente manual e automático, e o "digitando…" (atualiza a 0022, que tem os
  status).

Os sons da sala não pedem ADR: entram na seção de sons da 0022.

### Combinado (19/11)

- **A v0.5 sai numa versão só**, a `0.5.0`, com as salas, a presença e os sons juntos.
- **Entram** as seis frentes propostas: criar sala de voz, trocar de sala, mover alguém, Ausente, "digitando…" e os
  sons da sala.
- **Entram dois extras:** arrastar uma pessoa de uma sala para outra na lista de canais, e "Desconectar da voz" no
  cartão, com a mesma permissão de mover.
- **Entram os canais e salas restritos** (19/11): cada canal de texto e cada sala de voz pode ter as pessoas
  associadas, e quem está fora da lista nem vê nem interage. Silenciar e ensurdecer alguém para todos ficam na v0.8.
- **O dono tem todas as permissões** e pode fazer todas as ações, em tudo; quem tem "Gerenciar canais" também vê
  os canais restritos, para editar as listas.
- **Ficam de fora:** status com texto livre e chat de texto dentro da sala de voz.
- **Todas as sugestões do levantamento foram aceitas** (decisões 1 a 13 abaixo).
- **A VPS (Borkcloud) já hospeda tudo**, com franquia ilimitada. Várias salas não aumentam a saída: cada pessoa
  continua numa sala só.

### Decidido neste plano

**Salas (parte 1)**

1. **Quem cria sala de voz é quem tem "Gerenciar canais"**, a mesma permissão dos canais de texto. Criar, editar
   (nome) e arquivar sala de voz usam o mesmo menu do servidor, o mesmo menu do canal e o mesmo modo Organizar da
   v0.3. O nome da sala é livre, de 1 a 32 caracteres, como já valida o `validate_label`.
2. **Sem limite de pessoas por sala.**
3. **A sala Sala deixa de ser especial.** Ela continua no banco como a linha `sala` e pode ser renomeada, mas,
   como o `#geral`, não pode ser arquivada: alguma sala de voz existe sempre, e o app antigo entra nela pelo id. O app não guarda mais nenhuma sala fixa: a sala conectada é um id num store, e tudo
   que hoje lê o `SALA` (o painel de voz, o alto da sala, a volta da ligação, o aviso de atualização, a lista de
   pessoas) lê esse id. Arquivar a sala com gente dentro desconecta todo mundo dela, com o aviso "A sala foi
   arquivada".
4. **Trocar de sala é um clique.** Clicar em outra sala de voz, já conectado, sai da atual e entra na nova, sem
   pergunta. A câmera desliga e a transmissão acaba (as duas são da sala), e por isso, transmitindo ou com a câmera
   ligada, o clique pergunta antes: "Trocar de sala encerra a sua transmissão", igual ao aviso da ligação, com a
   mesma chave para não perguntar mais. Durante uma ligação, a pergunta da ligação continua valendo. O microfone
   e o surdo continuam como estavam.
5. **Quem move é quem tem "Mover membros"**, uma permissão nova, dada por pessoa no Painel, como as outras. O dono
   tem todas. "Desconectar da voz" usa a mesma permissão.
6. **Mover é a pessoa trocar de sala sozinha, por ordem da API.** O `POST /api/voice/move` confere a permissão, a
   sala de destino e que a pessoa está numa sala de voz (não numa ligação privada), e manda um evento
   `voice.moved` só para as conexões dela; o app dela troca de sala pelo mesmo caminho da decisão 4, sem perguntar.
   A transmissão e a câmera dela acabam. O `MoveParticipant` do LiveKit não é usado: o app precisa de um token novo
   de qualquer jeito, e a `:screen` do publicador nativo é outra conexão. Se o app não trocar em 10 segundos (app
   antigo, ou travado), a API tira a pessoa da sala antiga com o `remove_participant`.
7. **Desconectar tira a pessoa da voz.** O `POST /api/voice/disconnect` manda `voice.disconnected` para ela e tira
   as duas conexões (a da voz e a `:screen`) com o `remove_participant`. O app dela sai da sala com o aviso "Você
   foi desconectado da voz por fulano" e não tenta reconectar.
8. **Mover e desconectar aparecem no cartão** da pessoa, para quem tem a permissão, só quando ela está numa sala
   de voz: "Mover para" abre a lista das outras salas, e "Desconectar da voz" fica em vermelho, sem pergunta.
   Ninguém se move pelo cartão (a própria pessoa troca clicando na sala).
9. **Arrastar uma pessoa para outra sala**, na lista de canais, faz o mesmo que "Mover para". Só quem tem a
   permissão arrasta, só os avatares dentro das salas, e funciona fora do modo Organizar: é uma exceção à regra
   "arrastar só no modo Organizar" da ADR 0020, porque ali nada da lista muda de lugar. A sala embaixo do mouse
   fica em destaque, e soltar fora de uma sala não faz nada. No modo Organizar, os avatares não se arrastam.

**Presença e sons (parte 2)**

10. **O Ausente tem dois jeitos.** Manual, como um quarto status no menu do seu painel (Disponível, Ausente,
    Ocupado e Invisível), com a bolinha amarela da lua; e automático, quando a pessoa está Disponível e passa 10
    minutos sem tocar no teclado nem no mouse, no Windows inteiro, não só no Ashtar. O automático volta a
    Disponível no primeiro toque. Ocupado e Invisível não viram Ausente. Ausente não cala nada: avisos, sons,
    notificações e toque de ligação continuam (quem cala é o Ocupado).
11. **Numa sala de voz, ninguém fica ausente sozinho.** Quem joga de controle não toca no teclado nem no mouse e
    pareceria ausente no meio da conversa. O Ausente manual continua valendo dentro da sala. A inatividade vem do
    Windows (`GetLastInputInfo`, no Rust), lida a cada 30 segundos; o app só avisa a API quando o estado muda.
12. **"Digitando…" nos canais e nas conversas privadas.** Aparece embaixo da caixa de texto ("fulano está
    digitando…", "fulano e beltrano estão digitando…", "várias pessoas estão digitando…"), e, nas conversas
    privadas, também na lista de conversas, no lugar da última mensagem. Só vai para quem pode ler o canal ou a
    conversa. O Invisível não mostra que está digitando.
13. **Os sons da sala:** alguém entrou, alguém saiu, você mutou, desmutou, ficou surdo e voltou, e alguém começou
    ou parou de transmitir na sua sala. Cada um tem uma chave em Configurações › Notificações, ligada por padrão, e
    todos tocam também em Ocupado, porque a pessoa está na sala. Os sons de entrada e saída só tocam na sala em que
    a pessoa está, e não tocam para ela mesma entrando (o som de entrar é o próprio). São originais, gerados para o
    projeto, como os de mensagem e o toque de hoje (`assets/sounds/`).

**Mais da parte 1: canais e salas restritos**

14. **Qualquer canal de texto ou sala de voz pode ser restrito** a uma lista de pessoas. Sem restrição, é de todos,
    como hoje. Quem tem "Gerenciar canais" liga a restrição e escolhe as pessoas no diálogo de editar o canal ("Quem
    tem acesso"), e também ao criar.
15. **Para quem está fora da lista, o canal não existe.** Não aparece na lista de canais, nem as mensagens, as não
    lidas, as menções, o "digitando…", quem está na sala, o "começou a transmitir" e os sons dela. A API trata o id
    como um que não existe (o mesmo `NotFound` da conversa dos outros, ADR 0021). Uma categoria em que a pessoa não vê
    nenhum canal também some para ela.
16. **O dono e quem tem "Gerenciar canais" veem todos**, porque precisam para editar as listas. O diálogo diz isso
    ("quem gerencia os canais também tem acesso"), para ninguém achar que o canal é só das pessoas marcadas.
17. **A trava é da API.** A regra de leitura (`chat/access.rs`) ganha o terceiro caso, o canal restrito; o
    `POST /api/voice/token` passa pela mesma regra; e cada evento de um canal restrito só sai para as conexões de
    quem tem acesso, como as mensagens privadas. Assim vale também para um app antigo.
18. **Perder o acesso tira a pessoa na hora.** Tirar alguém da lista (ou restringir um canal sem ele): o canal some
    da lista dele; se ele estava com o canal aberto, volta para o primeiro canal; se estava na sala, é desconectado
    com o aviso "Você não tem mais acesso a esta sala". "Mover para" e o arrastar não oferecem uma sala restrita para
    quem está fora dela, e a menção a quem não tem acesso não notifica (a sugestão do @ só mostra quem tem).

---

## Etapa 0: ADRs, roadmap e BACKLOG

Só documentos. Fecha as decisões antes de qualquer código.

- ADR **0026** (decisões 1 a 9), que atualiza a 0016 ("só canais de texto são criados agora") e a 0020 (a exceção
  do arrastar).
- ADR **0027** (decisões 10 a 12), que atualiza a 0022 (os status) e recebe a decisão 13 na seção de sons.
- ADR **0028** (decisões 14 a 18), que atualiza a 0021 (a regra de leitura ganha o canal restrito) e a 0016.
- `docs/roadmap.md`: a v0.5 com uma versão só (`0.5.0`); sai o "speaking indicator", que já existe; entram mover
  e desconectar pelo cartão e arrastando, e os canais e salas restritos; saem o status com texto e o chat na sala de voz.
- `BACKLOG.md`: sai o "Mover para outra sala" da v0.5.
- `docs/roadmap.md`, na v0.8: "tirar da sala" sai da moderação (vem para a v0.5, como Desconectar da voz).
- O `PLAN.md` e o `NOTES.md` da v0.3 e o plano da v0.4 vão para `docs/plans/`, e a raiz recebe estes.

**Pronto quando:** as três ADRs estão em `docs/adr/`, a 0016, a 0020, a 0021 e a 0022 apontam para elas, e o roadmap tem a
v0.5 nova.

---

# Parte 1: salas

API, banco e app.

## Etapa 1: API, criar, editar e arquivar sala de voz

`api/src/routes/channels.rs` e `api/src/chat/channels.rs`.

- O `POST /api/channels` aceita `kind` (`text` por padrão, ou `voice`). A sala de voz não tem tópico; o nome passa
  pelo `validate_label`, como já faz o `update`.
- Arquivar uma sala de voz com gente dentro tira todo mundo com o `remove_participant` (as conexões de voz e as
  `:screen`), e manda `voice.disconnected` com o motivo `archived` (decisão 3). Desarquivar volta a sala vazia.
- O `channels.changed` já avisa a lista; nada muda nele.
- O OpenAPI e o cliente gerado (`lib/api/generated`) passam a ter o `kind` no corpo.
- Testes: criar sala de voz com e sem a permissão; nome vazio e com 33 caracteres; tópico numa sala de voz dá 400;
  arquivar uma sala com gente chama a remoção.

**Pronto quando:** dá para criar uma segunda sala de voz pela API, entrar nela com o `POST /api/voice/token` e
arquivá-la com alguém dentro.

## Etapa 2: app, o fim da sala fixa

`features/voice/room/` e quem lê o `SALA`.

- Sai o `SALA` de `model/channel.ts`. A sala conectada passa a ser o `channelId` do estado da chamada (que já
  existe para a ligação privada), e o nome vem da lista de canais.
- Os 12 arquivos que usam o `SALA` passam a ler a sala conectada: `ServerView`, `UpdateNotice`, `VoiceConnection`,
  `VoiceDock`, `ShareHost`, `RoomHeader`, `VoiceRoom`, `CallButton`, `ReturnToRoom` e `PeopleList`.
- A volta da ligação ("Voltar para a sala") lembra de qual sala a pessoa saiu, e não da Sala.
- A ADR 0014 previa `server/channels/` e `features/presence/` na v0.5: a lista de canais já está em
  `features/channels/`, e a presença entra em `features/presence/` na parte 2.

**Pronto quando:** nenhum `SALA` sobra fora dos testes; entrar na Sala funciona como antes; com uma segunda sala
criada pela API, dá para entrar nela pela lista.

## Etapa 3: app, criar, editar e arquivar sala de voz

`features/channels/components/ChannelDialogs.tsx` e o menu do servidor.

- O diálogo de criar canal ganha a escolha do tipo, Texto ou Voz, no topo, como no quadro "Criar canal" do canvas.
  Na voz, some o tópico e o nome não vira minúsculas.
- "Criar canal" no menu do servidor e o + da categoria abrem o mesmo diálogo, com Texto marcado.
- Editar e arquivar sala de voz já passam pelo menu do canal; conferir os textos ("Arquivar sala de voz").
- Criar a sala não entra nela (diferente do canal de texto, que abre): só aparece na lista.

**Pronto quando:** quem tem "Gerenciar canais" cria, renomeia, move de categoria e arquiva uma sala de voz pelo
app, e os outros veem na hora.

## Etapa 4: app, trocar de sala

`features/voice/room/` e `features/channels/`.

- Clicar em outra sala, já conectado, faz `leave` da atual e `join` da nova, com um token novo, sem passar pela
  tela vazia. O painel "Voz conectada" mostra a sala nova assim que o token chega.
- Transmitindo ou com a câmera ligada, o clique pergunta antes (decisão 4), com a chave "Não perguntar de novo",
  junto da chave da ligação em Configurações › Voz e vídeo.
- A transmissão acaba pelo caminho de sempre (o publicador nativo para a `:screen`); a câmera desliga.
- O que a pessoa assistia na sala antiga sai da lista do `watching`; a miniatura some.
- O microfone, o surdo e os volumes por pessoa continuam.
- A troca vira uma função só (`switchRoom(channelId, { reason })`), que a Etapa 6 reaproveita para o `voice.moved`.

**Pronto quando:** trocar de sala com o microfone ligado não deixa a pessoa nas duas salas ao mesmo tempo (conferir
no `voice.participants` das duas); trocar transmitindo pergunta e a transmissão acaba na sala antiga.

## Etapa 5: API, mover e desconectar

`api/src/identity/permissions.rs`, `api/src/routes/voice.rs` e `api/src/realtime/`.

- `Permission::MoveMembers` (`membros.mover`, "Mover membros"), dada por pessoa no Painel; o dono tem.
- `POST /api/voice/move` (`user_id`, `channel_id`): confere a permissão, a sala de destino aberta, e que a pessoa
  está numa sala de voz (a `list_room` das salas, ou o `voice.participants` guardado); 409 se ela está numa
  ligação ou em nenhuma sala, e 409 se já está na sala de destino. Manda `voice.moved` (`channel_id`, `by`) só
  para as conexões dela, e agenda a remoção da sala antiga em 10 segundos, cancelada se ela sair antes
  (decisão 6).
- `POST /api/voice/disconnect` (`user_id`): mesma permissão; manda `voice.disconnected` (`by`) e tira as conexões
  de voz e `:screen` com o `remove_participant` (decisão 7).
- Testes: sem permissão dá 403; mover quem está em ligação dá 409; o evento só vai para as conexões da pessoa; a
  remoção agendada acontece sem a saída e é cancelada com ela.

**Pronto quando:** as rotas estão na `dev` e no servidor, com os testes; mover alguém com um app de hoje (que não
conhece o `voice.moved`) tira a pessoa da sala em 10 segundos.

## Etapa 6: app, Mover para e Desconectar no cartão

`features/members/` (o cartão) e `features/voice/room/`.

- O cartão ganha "Mover para" (com a lista das outras salas) e "Desconectar da voz", só para quem tem a permissão e
  só quando a pessoa do cartão está numa sala de voz (decisão 8).
- O app de quem é movido ouve o `voice.moved` e chama o `switchRoom` da Etapa 4, sem perguntar, com o aviso "fulano
  moveu você para Squad".
- O `voice.disconnected` tira a pessoa da sala com o aviso (de quem desconectou, ou "A sala foi arquivada") e
  desliga a reconexão automática dessa vez.
- A permissão nova aparece no Painel, na lista de permissões por pessoa.

**Pronto quando:** mover alguém que está transmitindo leva a pessoa para a outra sala, sem a transmissão, e ela vê o
aviso; desconectar não reconecta sozinho.

## Etapa 7: app, arrastar uma pessoa para outra sala

`features/server/components/RoomMembers.tsx` e `ChannelRow.tsx`.

- Os avatares dentro das salas ficam arrastáveis para quem tem a permissão, fora do modo Organizar (decisão 9). A
  mesma biblioteca de arrastar do modo Organizar, com outro contexto, para os dois não se misturarem.
- A sala embaixo do mouse ganha o destaque; soltar chama o `POST /api/voice/move`. Soltar na própria sala ou fora
  de uma sala não faz nada.
- A própria pessoa não se arrasta (ela troca clicando).
- A ADR 0020 ganha a exceção.

**Pronto quando:** arrastar alguém de uma sala para outra move a pessoa; sem a permissão, os avatares não se
arrastam; no modo Organizar, também não.

## Etapa 8: API, canais e salas restritos, a lista e a regra de acesso

`api/src/chat/access.rs`, `api/src/chat/channels.rs`, `api/src/chat/layout.rs`, `api/src/routes/channels.rs`,
`api/src/routes/voice.rs` e o banco.

- Migração `0008`: a coluna `restricted` em `channels` e a tabela `channel_access` (`channel_id`, `user_id`).
- O `POST` e o `PATCH` do canal aceitam `restricted` e a lista (`member_ids`), com "Gerenciar canais".
- `access.rs`: uma função só, `can_access(user, channel)`, usada pelo `readable` (texto) e por uma `joinable` nova
  (voz): sem restrição, todos; restrito, a lista, o dono e quem gerencia (decisões 15 e 16).
- O `GET /api/channels` (o `layout.rs`) só devolve os canais que a pessoa acessa, e esconde a categoria vazia para
  ela; a lista de cada canal só vai para quem gerencia.
- O `POST /api/voice/token` e o `GET /api/voice/participants` passam pela `joinable` (404 como um id que não
  existe); o `POST /api/voice/move` dá 409 para quem não acessa a sala de destino.
- Tirar da lista com a pessoa na sala: `voice.disconnected` com o motivo `no_access` e `remove_participant`.
- Quem sai do grupo sai de todas as listas.
- Testes: quem está fora não vê o canal no `GET /api/channels`, não lê, não escreve e não entra na sala (404); o
  dono e quem gerencia veem; a categoria só com canais restritos some; tirar da lista desconecta da sala.

**Pronto quando:** com um canal e uma sala restritos, um cliente de teste fora da lista não acha nenhum dos dois por
nenhuma rota.

## Etapa 9: API, os eventos, as menções e as não lidas de um canal restrito

`api/src/realtime/`, `api/src/chat/mentions.rs` e `api/src/chat/read.rs`.

- O filtro na saída de cada conexão (o mesmo das mensagens privadas, ADR 0021) passa a usar a `can_access` para
  todo evento com `channel_id`: `message.created` e os outros do chat, `typing`, `voice.participants` e o estado de
  lido.
- O `channels.changed` continua indo para todos (cada um recarrega e recebe só o que acessa); mudar a lista de um
  canal manda ele também, para o canal aparecer ou sumir na hora.
- Menção a quem não acessa o canal não grava nem notifica; as não lidas e o "Marcar tudo como lido" só contam os
  canais que a pessoa acessa.
- O "começou a transmitir" de uma sala restrita só vai para quem acessa.
- A lista de acessos fica num cache em memória, atualizado no `PATCH`, para o filtro não ir ao banco a cada evento.
- Testes: quem está fora não recebe nenhum evento do canal, nem o `voice.participants` da sala; a menção a ele não
  conta; entrar na lista faz o canal aparecer sem reiniciar.

**Pronto quando:** com duas pessoas dentro e uma fora, conversar e falar no canal e na sala restritos não chega
nada, de nenhum tipo, à de fora.

## Etapa 10: app, canais e salas restritos

`features/channels/components/ChannelDialogs.tsx`, `features/server/` e `features/chat/`.

- O diálogo de criar e de editar canal (texto e voz) ganha "Restrito" (a chave) e "Quem tem acesso", com a lista de
  membros para marcar, uma busca e o aviso de que quem gerencia também tem acesso (decisão 16).
- Para quem gerencia, o canal restrito tem um cadeado na lista; para os outros, nada muda, porque eles só recebem os
  canais que acessam.
- Perder o acesso com o canal aberto volta para o primeiro canal, com o aviso "Você não tem mais acesso a este
  canal"; o `voice.disconnected` com `no_access` mostra o da sala (decisão 18).
- A sugestão do @ mostra só quem acessa o canal; "Mover para" e o arrastar não oferecem a sala para quem está fora.
- Os rascunhos e o último canal aberto de um canal que sumiu são esquecidos.

**Pronto quando:** restringir o #staff e a Squad para duas pessoas some com os dois para as outras na hora; tirar
alguém da lista com o canal aberto e com ele na sala tira ele dos dois.

---

# Parte 2: presença e sons

API e app.

## Etapa 11: API, o status Ausente

`api/src/identity/status.rs` e `api/src/realtime/`.

- `Status::Away` (manual) entra ao lado de Disponível, Ocupado e Invisível, e `Shown::Away` no que os outros veem.
  Migração no banco se o status for guardado com `CHECK`.
- O app manda pelo WebSocket `{"type": "idle", "idle": true|false}`; o hub guarda por conexão, e a pessoa aparece
  Ausente quando o status dela é Disponível e todas as conexões dela estão ociosas (decisão 10). Ocupado e
  Invisível não mudam.
- O `presence.changed` já leva o `Shown`; nada novo no evento.
- Testes no hub: Disponível ocioso aparece Ausente; Ocupado ocioso continua Ocupado; duas conexões, uma ociosa,
  continua Disponível; Ausente manual não volta sozinho.

**Pronto quando:** um cliente de teste ocioso aparece Ausente para os outros, e volta ao mandar `idle: false`.

## Etapa 12: app, Ausente manual e automático

`features/presence/` (nova, ADR 0014), `src-tauri/src/commands/` e o menu do painel.

- O comando `idle_seconds` no Rust, com o `GetLastInputInfo`; o app lê a cada 30 s e manda o `idle` só quando o
  estado muda, com o limite de 10 minutos (decisão 11).
- Numa sala de voz, o app manda sempre `idle: false`.
- O menu de status ganha Ausente, com a bolinha amarela da lua; a bolinha aparece em todo lugar em que a de status
  já aparece (lista de membros, cartão, conversas, painel).
- Ausente não entra em nenhuma regra de aviso: conferir que o `Busy` continua sendo o único que cala.

**Pronto quando:** dez minutos sem mexer, fora de uma sala, viram Ausente para os outros, e um toque no mouse volta;
numa sala, jogando de controle por meia hora, ninguém vê Ausente.

## Etapa 13: API e app, "digitando…"

`api/src/realtime/` e `features/chat/` e `features/dms/`.

- O app manda `{"type": "typing", "channel_id": ...}` (canal ou conversa) ao digitar, no máximo a cada 3 s, e para
  ao enviar ou apagar tudo. A API confere que a pessoa pode ler o canal (a permissão por canal da ADR 0021, ou ser
  das duas da conversa) e manda `typing` (`channel_id`, `user_id`) para as conexões de quem pode ler, menos a dela.
  O Invisível não manda nada (decisão 12).
- No app, um store guarda quem está digitando em cada canal, e cada entrada some em 6 s sem repetição, ou na hora em
  que chega uma mensagem da pessoa.
- A linha embaixo da caixa de texto, com os três textos da decisão 12, sem empurrar a caixa (o espaço fica
  reservado).
- Na lista de conversas, "digitando…" em itálico no lugar da última mensagem.
- Testes na API: quem não pode ler o canal não recebe; o Invisível não manda. No app: as entradas expiram, e a
  mensagem que chega apaga a entrada.

**Pronto quando:** com duas pessoas numa conversa e três num canal, o "digitando…" aparece para os outros em menos
de um segundo e some ao enviar.

## Etapa 14: app, os sons da sala

`features/notifications/model/sound.ts`, `assets/sounds/` e Configurações › Notificações.

- Os sons novos, gerados para o projeto (curtos, no mesmo estilo e volume dos de mensagem e do toque): entrar,
  sair, mutar, desmutar, surdo, sair do surdo, transmissão começou e transmissão acabou.
- Entrada e saída vêm do `voice.participants` da sala em que a pessoa está, comparando com a lista anterior; trocar
  de sala não toca a saída de todos da sala velha, só o som de entrar da nova.
- A transmissão que começa e acaba vem da trilha `:screen` da sala; não toca para a própria.
- Uma chave por som em Configurações › Notificações, ligadas por padrão, com o botão de testar; tocam também em
  Ocupado (decisão 13).
- Muita gente entrando junto (a sala abrindo) toca um som só.

**Pronto quando:** com três pessoas, cada evento toca o som certo uma vez, para quem está na sala, e desligar a chave
cala só aquele som.

---

## Etapa 15: teste com três computadores

Nada é publicado: os apps saem do build da `feature/0.5`, instalados à mão.

1. A API das Etapas 1, 5, 8, 9, 11 e 13 no servidor.
2. Roteiro: criar a sala Squad, entrar, trocar entre Sala e Squad com o microfone ligado, trocar transmitindo e com
   a câmera, mover alguém pelo cartão e arrastando (inclusive quem está transmitindo), desconectar alguém, arquivar
   uma sala com gente dentro, restringir um canal e uma sala e tirar da lista alguém
   que está com o canal aberto e na sala, ficar 10 minutos parado fora da sala e dentro dela, o Ausente manual, o "digitando…"
   num canal e numa conversa, e todos os sons, com e sem Ocupado.
3. Uma ligação privada com uma pessoa numa sala e outra em outra: "Sair e atender" e "Voltar para a sala" voltam
   para a sala certa.

**Pronto quando:** o roteiro passa.

## Etapa 16: lançamento da `0.5.0`

1. `0.5.0` no beta, com a seção `## 0.5.0` do `CHANGELOG.md`, que cobre a fase inteira.
2. Uma semana no beta antes do estável; problema vira `0.5.1`.
3. `MIN_CLIENT_VERSION` em `0.5.0` junto da publicação no estável: a `0.4.x` só conhece a Sala, não sabe trocar de
   sala nem ser movida (a remoção dos 10 segundos cobre o beta).
4. `README.md`, `ARCHITECTURE.md` e `docs/roadmap.md` em dia; as ADRs 0026 e 0027 passam a aceitas.

**Pronto quando:** a `0.5.0` está no estável e o grupo passa uma noite dividido em duas salas, trocando e sendo
movido, sem ninguém ficar preso em duas salas nem fora de todas.

---

**Critério de pronto da fase:** o "pronto quando" da Etapa 16, e todos os itens do `NOTES.md` resolvidos ou
conscientemente adiados.
