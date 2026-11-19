# 0015 — O chat e o tempo real

- **Status:** aceita; o tempo real ganhou destinatário na 0021 (v0.3)
- **Data:** 2026-10

## Contexto

A v0.2.3 traz o chat do grupo. Até aqui, nada no app é ao vivo: a v0.2.2 pergunta à API quem está na
sala a cada 5 s e, no app do dono, compara a lista de membros a cada 30 s (ADR 0012), à espera de uma
conexão longa. O chat precisa dela: uma mensagem nova tem de chegar na hora a todo mundo, a lista de quem
está online também, e quando a conexão cai (o Funnel do computador de casa, o Wi-Fi de alguém) nada pode
se perder.

A API é um processo só, no computador de casa, atrás do Tailscale Funnel, com SQLite (ADR 0010). O app
autentica com `Authorization: Bearer` e manda a versão no `X-App-Version` (ADR 0011), mas o `WebSocket`
do navegador não deixa pôr cabeçalhos no pedido de abertura. O grupo tem uns 10 membros.

## Decisão

**Envio e histórico pelo REST.** `POST /api/channels/{id}/messages` envia e
`GET /api/channels/{id}/messages` lê, com o `Bearer`, a `ClientPolicy`, os erros `{ kind, message }` e o
limite de envio de sempre. O WebSocket só leva o que vem do servidor para o app.

- O id da mensagem é um UUID v7, que já vem em ordem de tempo e serve de cursor (`before` e `after`).
- O app gera um `client_id` antes de enviar; o mesmo `client_id` devolve a mensagem que já existe, e o
  "Tentar de novo" nunca duplica.
- Texto puro, de 1 a 2.000 caracteres depois do `trim`, no máximo 5 quebras de linha seguidas. 5 mensagens
  a cada 5 s por pessoa; acima disso, 429.
- A mensagem leva o autor junto (`id`, `nick`, `display_name`, `removed`). Quem saiu do grupo mantém as
  mensagens, com "(saiu do grupo)" ao lado do nome.
- Todo membro ativo lê e escreve nos canais que existem; quem entra depois vê o histórico todo.

**Um WebSocket por app aberto, aberto com um ticket.** O app pede `POST /api/realtime/ticket` (que passa
pelo `Bearer` e pela `ClientPolicy`) e abre `GET /api/realtime?ticket=…`. O ticket vale 30 s e uma vez
só; o token nunca vai na URL, onde acabaria nos logs.

- O app manda `ping` (texto) a cada 25 s e a API responde `pong`; a API fecha a conexão depois de
  60 s sem nada do app, e o app reabre se o `pong` não vier. O ping sai do app porque o `WebSocket` do
  navegador não deixa o JavaScript ver o ping do protocolo: com ele saindo da API, o app não saberia
  que a conexão morreu.
- Na queda, o app tenta de novo em 1, 2, 4, 8, 16 e 30 s, com variação aleatória, sempre com um ticket
  novo. Na volta, busca o que perdeu com `?after=` e recarrega a sala e as pessoas.
- A distribuição é um `tokio::sync::broadcast` no `AppState`: um processo só, sem Redis.
- Códigos de fechamento: 4001 quando a pessoa é removida ou desvinculada (o app não tenta de novo
  sem sessão), 4000 quando a conexão fica para trás no `broadcast` (o app reconecta e busca o que
  perdeu) e 1011 quando a API não consegue montar o `ready`.

**Os eventos.** `ready` (ao abrir: quem é, quem está online e o último id de cada canal de texto),
`pong`, `message.created`, `presence.changed`, `voice.participants`, `member.joined`, `member.left`
(alguém removido sai da coluna de membros) e `channels.changed` (ADR 0016). `message.updated` e
`message.deleted` ficam reservados para a v0.7. Com o último id de cada canal, o app só chama o
`?after=` dos canais que andaram enquanto ele estava fora.

**Presença é ter pelo menos uma conexão aberta.** A API conta conexões por pessoa na memória e só avisa
"offline" depois de 10 s sem nenhuma, para uma reconexão não piscar na lista. Só online e offline; os
status são da v0.5.

**A sala de voz pelo webhook do LiveKit.** `POST /webhooks/livekit`, fora do `/api` e da `ClientPolicy`,
com a assinatura conferida. O webhook só diz que algo mudou: a API relê a sala pelo `RoomClient` (a mesma
leitura do `GET /api/voice/participants`) e manda a lista inteira no `voice.participants`; o
`room_finished` manda a lista vazia sem perguntar. As releituras de uma sala são numeradas, e uma
resposta que chega depois de uma mais nova é descartada.

**As consultas repetidas viram reserva.** O `refetchInterval` de 5 s e o de 30 s da v0.2.2 continuam no
código, mas só rodam enquanto o socket não está aberto.

## Alternativas consideradas

- **Enviar pelo WebSocket:** um canal só para tudo, mas cada envio precisaria de um id de pedido, de um
  timeout e de um formato de erro próprios, que o REST já tem. E a `ClientPolicy` e o limite de envio
  teriam de ser repetidos dentro do socket.
- **Token na URL do WebSocket** (`?token=`): mais simples, mas o token de sessão iria parar no log de
  acesso do Funnel e da API.
- **Token na primeira mensagem do socket:** não deixa o token na URL, mas o socket abre sem a
  `ClientPolicy` e fica aberto, sem dono, até a primeira mensagem chegar.
- **SSE:** só servidor para app, como aqui, mas o `EventSource` também não manda cabeçalho, e o WebSocket
  é o que o roadmap já previa.
- **Ids sequenciais (`INTEGER`):** ordenam igual, mas o resto do banco usa UUID em texto (ADR 0011), e o
  v7 não deixa adivinhar quantas mensagens existem.
- **Desligar as consultas repetidas de vez:** um webhook perdido ou um Funnel instável deixariam a lista da
  sala parada sem ninguém perceber.

## Consequências

- O app passa a ter uma conexão longa por janela aberta; a API, uma tarefa por conexão e um `broadcast`.
- Um evento perdido com o socket aberto (um webhook que não chegou) só se corrige no próximo evento da
  mesma sala. Aceito para um grupo pequeno.
- Com o computador de casa desligado, não há chat nem histórico (até a v0.2.4).
- Na VPS (v0.2.4), a API continua um processo só; se um dia forem dois, o `broadcast` precisa de um
  intermediário (Redis, ou o próprio LiveKit).
- Rever quando chegarem as mensagens privadas (v0.3), que pedem eventos só para os dois, ou se o número de
  conexões crescer muito além do grupo.
