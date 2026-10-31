# 0014 — Organização das features do front

- **Status:** aceita
- **Data:** 2026-10

## Contexto

A ADR 0012 pôs o front em pastas por domínio (`features/*`), cada uma com um `index.ts` como única porta
de entrada. Ela não disse o que existe dentro de uma feature. Com a v0.2.2 pronta, cada feature escolheu o
seu jeito: arquivos soltos na raiz (`ping.ts`, `voiceState.ts`, `nickRules.ts`, `inviteLink.ts`), stores com
nome de utilitário (`devices.ts` é um store e não dá para saber pelo nome) e a `voice` com 38 arquivos fora
dos testes, de assuntos que mudam por motivos diferentes (a conexão, os dispositivos, a sala por dentro, o
pé da coluna). O chat da v0.2.3 e as próximas versões vão acrescentar features e telas, e só uma pessoa
programa: o padrão precisa estar escrito para a próxima feature já nascer certa.

Isto é uma **convenção**, e não uma regra cobrada pelo ESLint. As fronteiras entre features continuam como
na ADR 0012 (o `eslint-plugin-boundaries`); o que há por dentro de uma feature fica no combinado e na
revisão.

## Decisão

**A forma de uma feature.** Toda feature tem as mesmas gavetas, e o tipo do arquivo diz em qual ele mora.
Uma gaveta só existe quando tem o que guardar: uma feature sem store não tem `stores/`.

```
features/<nome>/
  index.ts        a única porta de entrada
  components/     .tsx que desenham; sem regra de negócio solta
  hooks/          useAlgo() que não são do cache da API
  queries.ts      chaves e hooks do TanStack Query; único dono do cache do domínio
  realtime.ts     (v0.2.3) eventos do WebSocket que atualizam o mesmo cache
  stores/         stores zustand, um arquivo por store
  model/          funções puras e tipos: sem React, sem zustand, sem fetch
  tests/          os testes
```

- **`model/`**, e não `lib/`, para não confundir com o `src/lib`. É onde vai o que hoje está solto na raiz.
- **`queries.ts` e `realtime.ts`** são arquivos únicos. Se um crescer, vira uma pasta (`queries/`) com um
  `index.ts`.
- **Providers e "vigias"** (`VoiceProvider`, `SessionWatcher`, `LinkWatcher`) ficam em `components/`, porque
  são componentes.
- **O nome do arquivo diz o tipo:** `useX.ts` em `hooks/`, `xStore.ts` em `stores/`, `PascalCase.tsx` em
  `components/`. Um arquivo sem JSX não leva `x` (`members.tsx` vira `members.ts`).
- **Os testes** ficam numa pasta `tests/` por feature (ou por subdomínio), como já são.

**O que cada gaveta evita**, como combinado (sem ESLint):

- `model/` não importa React, zustand, TanStack Query nem `@/lib/api`: fica testável sem montar nada.
- `components/` não chama a API; o dado entra pelos hooks do `queries.ts`. Tipos e `isApiError` do
  `@/lib/api` são livres.
- `stores/` e `hooks/` não importam `components/`.
- Só o `queries.ts` e o `realtime.ts` de uma feature mexem no cache do domínio dela. Fora disso, só o
  `App.tsx` conhece o `queryClient`.

**Quando uma feature vira subdomínios.** Uma feature se divide quando junta assuntos que mudam por motivos
diferentes. Sinais práticos: mais de uns 15 arquivos fora dos testes, ou duas telas que não compartilham
nada além do provider. Cada subdomínio é uma pasta com as mesmas gavetas (só as que precisa), e para fora
nada muda: as outras features continuam importando do `index.ts` da feature. Por dentro, um subdomínio usa
o outro por caminho relativo.

Hoje só a `voice` passa do limite (38). A `entry` (17) e a `screen-share` (14) tratam de um assunto só, e as
gavetas bastam.

**A `voice` em cinco subdomínios, e a `server` fora dela.**

```
features/voice/
  index.ts
  room/       a conexão: VoiceProvider, useVoice, o que assina, o deafen dos outros
  devices/    microfone e saída: escolha, lista, troca na sala, a tela de Voz e vídeo
  members/    quem está na sala, pela API e pelo LiveKit
  call/       a sala por dentro: Grade, Foco, barra, avisos da transmissão
  dock/       o pé da coluna: Voz conectada, cartão de quem usa, ping
features/server/    (nova) a coluna e a tela do servidor
```

| Arquivo hoje | Vai para |
| --- | --- |
| `VoiceProvider.tsx`, `RoomAudio.tsx`, `ShareRaceGuard.tsx` | `room/components/` |
| `useVoice.ts` | `room/hooks/` |
| `subscriptions.ts`, `voiceState.ts`, `channel.ts` (`SALA`) | `room/model/` |
| `devices.ts` (store) | `devices/stores/deviceChoiceStore.ts` |
| `roomDevices.ts` | `devices/model/` |
| `useAudioDevices.ts` | `devices/hooks/` |
| `VoiceSettings.tsx` | `devices/components/` |
| `queries.ts` | `members/queries.ts` |
| `members.tsx` | `members/model/members.ts` |
| `useLiveMembers.ts` | `members/hooks/` |
| `PersonCard`, `ParticipantTile` | `members/components/` |
| `roomView.ts`, `shareVolume.ts` (stores) | `call/stores/roomViewStore.ts`, `shareVolumeStore.ts` |
| `VoiceRoom`, `RoomGrid`, `RoomHeader`, `ScreenStage`, `ShareTile`, `CallControls`, botões, `ShareButton`, `ShareNotices`, `NoticeIcon`, `LiveBadge` | `call/components/` |
| `ping.ts`, `usePing.ts` | `dock/model/`, `dock/hooks/` |
| `VoiceDock`, `VoiceConnection`, `UserPanel` | `dock/components/` |
| `ChannelNav`, `ServerView`, `Starfield` | `features/server/components/` |

A `server` importa da `voice` pelo `index.ts` (o `useVoice`, a lista de membros e o `VoiceDock`). O
`AppShell` e o `ServerRoute` passam a importar de `@/features/server`. O `useInCall` da `updater` vai para a
`voice`, porque só lê o estado da chamada. O `SALA` fica em `room/model/` até a v0.5, quando a sala vira
dado da API e sai para a `server`.

**As outras features** mudam pouco: o que está solto na raiz vai para a sua gaveta.

```
entry/        components/ (telas, LinkWatcher, RequireNoAccount)  hooks/ (useUpdateNow)
              stores/ (pendingLinkStore)  model/ (inviteLink, validUntil, destination)
identity/     components/ (Avatar, PersonName, ProfileSettings, SessionWatcher)  queries.ts
              stores/ (sessionStore)  model/ (nickRules, nickColor, participant)
invites/      components/ (QuickInvite, InviteTicket, InviteStatusPill)  queries.ts
              stores/ (quickInviteStore)  model/ (format)
updater/      components/ (AppSettings, UpdateNotice, WhatsNewDialog)  hooks/ (useUpdateChannelSync)
              stores/ (updaterStore)
settings/     hooks/ (useApplyTheme)  stores/ (settingsStore)
screen-share/ components/ (SourcePicker, SourcePickerHost)  hooks/ (useScreenShares, ...)
              stores/ (pickerStore)  model/ (controller, monitorLayout, presets, notices, shareInfo)
              ipc/ (IpcScreenShare, ScreenShareAudio, o worklet)
```

- A `ipc/` da `screen-share` continua: é uma implementação do `ScreenShareController`, e o publicador
  nativo (v0.2.5) entra como uma pasta irmã, `native/`.
- O `nickRules` passa para `identity/model/`: é regra da identidade, e o nome visível segue as regras do
  nick, menos ser único. O comentário no topo diz que ser único é regra só da API.

**Futuras features** seguem a mesma forma, uma pasta nova ou um subdomínio:

- **v0.2.3:** `features/chat/` (com `queries.ts`, `realtime.ts`, `model/`), e `lib/realtime/` só para a
  conexão, sem conhecer nenhum domínio. A supressão de ruído entra em `voice/devices/`.
- **v0.3:** `features/direct/` (conversas privadas); o chat passa a receber um id de conversa, e o
  `voice/room/` é revisto, porque hoje supõe uma sala só.
- **v0.4:** várias transmissões em `voice/call/` e na `screen-share`; o `shareWinner` sai do `model/`.
- **v0.5:** `server/channels/`, e a presença em `features/presence/`.
- **Painel de controle (Etapa 7):** `features/admin/`, que usa `invites` e `identity` pelos `index.ts`.
  Convites e Membros têm filtros, menu e permissões, tudo restrito ao dono, e mudam por motivos
  diferentes dos de `invites/` e `identity/`.

**Outras mudanças do mesmo pacote**, todas mecânicas:

- **Rotas finas.** `InviteRoute` (173 linhas) e `RecoveryRoute` (126) levam o formulário para
  `entry/components/` e ficam só montando a tela.
- **`lib/tauri/commands.ts` (305 linhas)** vira uma pasta `commands/` com um arquivo por assunto (captura,
  atualização, janela, identidade) e um `index.ts`.
- **Persistência num padrão só:** os stores usam o `persist` do zustand com o prefixo `ashtar-`. O
  `updater/store.ts`, que usa `localStorage` direto, passa para o mesmo padrão.
- **Duas saídas das regras da 0012 que ficam como estão:** o `SessionWatcher` limpa o cache por uma função
  do `identity/queries.ts` (`clearIdentityCache()`), e o `VoiceProvider` chama `createVoiceToken` por
  `voice/room/queries.ts`, sem cache, porque o token não deve ser guardado.

**Fora deste pacote:** passar o estado da voz (conexão, mute, deafen) do contexto para um store zustand. Isso
muda o que re-renderiza, e é uma entrega com testes próprios, quando a segunda sala (v0.3) pedir.

**Quando fazer:** depois da Etapa 7, um pull request por passo, cada um com `pnpm lint`, `pnpm build` e
`pnpm test` passando e o `tsc` a cada movimento (mover arquivo quebra os caminhos de `@/features/...` e os
`vi.mock`):

1. Gavetas em todas as features, com o `nickRules` em `identity/model/` e o `clearIdentityCache()`.
2. A `features/server` e o `useInCall` na `voice`.
3. As rotas finas e o `commands.ts` dividido (independentes do passo 2).
4. A `voice` em subdomínios, um pull request cada: `devices`, `members`, `dock`, `call` e, por último,
   `room`.

## Alternativas consideradas

- **Cobrar as gavetas no ESLint:** o `model/` sem React, o `components/` sem a API e o cache com dono único
  dariam falha no CI. Descartado por agora: é regra demais para uma pessoa só, e o que importa é o padrão
  estar escrito e seguido. Se uma feature escapar do padrão mais de uma vez, a regra volta a ser considerada.
- **`logic/` ou `utils/` no lugar de `model/`:** `utils/` vira gaveta de tudo, e `logic/` não diz que são
  funções puras e tipos do domínio.
- **Testes ao lado do arquivo (`ping.test.ts` junto de `ping.ts`):** facilitaria mover junto, mas mistura os
  testes com os componentes e muda o padrão de uns 50 arquivos. Ficam em `tests/`.
- **Cada tela do painel na feature do assunto** (Convites em `invites/`, Membros em `identity/`): espalha
  as telas restritas ao dono. Fica `features/admin/`.
- **Uma pasta `providers/` para o `VoiceProvider` e os "vigias":** são componentes, e uma gaveta a mais
  para quatro arquivos não compensa. Entra se a quantidade crescer.
- **Dividir também a `entry` e a `screen-share`:** cada uma trata de um assunto só.

## Consequências

- Uma feature nova nasce com as gavetas que precisa, e o arquivo se acha pelo tipo e pelo nome.
- A `voice` deixa de ser a pasta onde tudo cabe; cada subdomínio muda por um motivo.
- Nada disso é cobrado pelas ferramentas: o padrão depende de ser seguido e de aparecer na revisão.
- Mover os arquivos custa um pull request por passo e a atenção aos caminhos dos testes e dos mocks.
- Rever se uma feature escapar do padrão mais de uma vez (a regra do ESLint volta), se a `entry` ou a
  `screen-share` passarem de uns 20 arquivos, ou quando o chat da v0.2.3 chegar.
