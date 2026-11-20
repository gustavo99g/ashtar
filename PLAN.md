# Plano — v0.6: confiabilidade e configurações

> As pendências estão em [`NOTES.md`](NOTES.md). O plano da v0.5 está em
> [`docs/plans/v0.5-salas-e-presenca.md`](docs/plans/v0.5-salas-e-presenca.md).

A v0.6 deixa o Ashtar ajustável e confiável para o uso de todo dia. A aba Voz e vídeo ganha o que ficou guardado
desde a v0.2.2 (volumes, teste de microfone, detecção de voz com sensibilidade, eco e ganho, os padrões da
transmissão), e uma aba nova, Atalhos, traz o pressionar para falar e os atalhos globais, que funcionam com um jogo
em foco. Em volta disso, o app passa a se recuperar sozinho de uma queda curta (voz, transmissão nativa e
servidor), avisa quando o microfone some, mostra a qualidade da conexão de cada pessoa na sala, testa o caminho até o servidor, avisa quem fala
mutado e manda os logs para o dono com um clique. O dono ganha também o estado do servidor no Painel.

Sai numa versão só, a `0.6.0`, pelo beta antes do estável. O trabalho anda em duas partes, mas nenhuma é publicada
sozinha:

| Parte | O que é | Mexe em |
|---|---|---|
| 1 | Configurações: a aba Voz e vídeo completa, o gancho de teclado e mouse, a aba Atalhos, o pressionar para falar com o som dele e o aviso de mutado | App e Rust |
| 2 | Confiabilidade: reconexão da voz e da transmissão, dispositivos, "Sem conexão com o servidor", qualidade da conexão e Testar conexão, "Enviar logs" e o estado do servidor no Painel | App, Rust e API |

**Objetivo da fase:** uma noite inteira de jogo sem ninguém precisar sair e entrar de novo na sala: o pressionar
para falar funciona com o jogo em foco, uma queda curta de rede volta sozinha, e quando algo der errado o dono
recebe os logs sem ninguém procurar pasta.

**Fora do escopo:** o overlay em jogos e o atalho dele (sem versão); o perfil (nick e foto) e o chat avançado
(v0.7); a moderação do cartão (v0.8); as pendências da v0.2.4, que continuam fora.

Base: a `dev` com a `0.5.0`. Em cada etapa, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` e
`cargo test` (em `api/` e em `desktop/src-tauri/`) e `pnpm lint`, `pnpm build` e `pnpm test` (em `desktop/`) devem
passar.

## O que já existe

Levantado na `dev` (`196cb41`), para o plano não refazer:

- **A tela de configurações já existe**, com Perfil, Voz e vídeo, Notificações e Aplicativo, e o Painel de controle
  do dono. Voz e vídeo tem os dispositivos (Entrada e Saída), a câmera, a supressão de ruído (liga e desliga o
  RNNoise) e o aviso antes de ligar. Falta o resto do quadro "Configurações — voz e vídeo".
- **O dispositivo que some já cai no padrão do Windows** (`effectiveDevice` no `VoiceProvider`), e volta quando
  reaparece, mas sem aviso nenhum.
- **A API já tem tempo limite do lado do app** (10 s no `lib/api/client.ts`, o erro `timeout`), e o estado "sem
  conexão" existe como componente (`components/ui/states.tsx`), usado só em algumas telas.
- **O WebSocket já reconecta sozinho** (`lib/realtime/connection.ts`, com `reconnecting` e `ended`), mas a interface
  não mostra nada enquanto isso.
- **A voz já mostra "Sem conexão com a sala"** quando a sala cai, mas só sai dali clicando de novo. As quedas curtas
  o próprio `livekit-client` resolve (`Reconnecting`), e o painel mostra "Conectando…" no lugar de "Reconectando…".
- **A transmissão nativa avisa quando cai** (`on_lost` no `media/publisher.rs`), e hoje isso encerra a transmissão.
- **O ping da chamada já é medido** (`features/voice/dock/model/ping.ts`, do `getStats`) e aparece no painel de voz.
- **A sessão inválida já leva à tela "Este computador saiu do grupo"** (`unknown_device`, v0.2.2). Só conferir.
- **A pasta de logs** já aparece em Aplicativo, com "Abrir pasta"; o Rust guarda 7 dias (`logging.rs`).

## Progresso

| Etapa | Parte | Descrição | Status |
|---|---|---|---|
| 0 | — | Decisões: ADRs 0029 e 0030, roadmap, BACKLOG, canvas | Feita |
| 1 | 1 | App: a cadeia do microfone (volume de entrada, portão e RNNoise) | Feita |
| 2 | 1 | App: a aba Voz e vídeo completa | Feita |
| 3 | 1 | Rust: o gancho de teclado e mouse | Feita |
| 4 | 1 | App: a aba Atalhos, o pressionar para falar e o aviso de mutado | Pendente |
| 5 | 2 | App: a voz volta sozinha | Pendente |
| 6 | 2 | Rust e app: a transmissão nativa volta sozinha | Pendente |
| 7 | 2 | App: microfone e saída desconectados | Pendente |
| 8 | 2 | API e app: "Sem conexão com o servidor" | Pendente |
| 9 | 2 | API e app: a qualidade da conexão e o Testar conexão | Pendente |
| 10 | 2 | API, Rust e app: "Enviar logs" e o estado do servidor | Pendente |
| 11 | — | Teste com três computadores, sem publicar | Pendente |
| 12 | — | Lançamento da `0.6.0` | Pendente |

Dependências: a 2 usa a 1; a 4 usa a 1 (o portão abre e fecha pelo atalho) e a 3. A parte 2 não depende da parte
1 e pode andar em paralelo. A 6 usa a 5 (a transmissão volta depois da voz). A API da 10 pode ir para o servidor antes do
lançamento: o app atual nunca chama a rota nova.

Branch: `claude/project-thread-oj6xia`, com um pull request para a `dev` que recebe as etapas em commits separados. O
app só é publicado na Etapa 12, que leva a `dev` para o beta e depois para a `main`.

## Decisões

As decisões de arquitetura vão para as ADRs, que são a fonte:

- `0029-configuracoes-de-voz-e-atalhos.md`: a cadeia do microfone, a detecção de voz, o pressionar para falar e o
  gancho de teclado e mouse, o aviso de mutado, o som do pressionar para falar e o volume dos sons (decisões 1 a 8, 18, 19 e 22).
- `0030-reconexao-e-estados.md`: a reconexão da voz e da transmissão, os dispositivos, a faixa do servidor, a
  qualidade da conexão, o Testar conexão, os logs e o estado do servidor (decisões 9 a 17, 20 e 21).

### Combinado (20/11)

- **A v0.6 sai numa versão só**, a `0.6.0`.
- **Entram as duas partes propostas**, com todas as sugestões aceitas: pressionar para falar pelo teclado e pelos
  botões laterais do mouse; a detecção de voz com a sensibilidade automática e manual; os logs guardados na API e
  vistos pelo dono no Painel; a qualidade da conexão como um ícone que só aparece quando está ruim, com os números
  no cartão; os itens abertos do `NOTES.md` da v0.5 conferidos no teste da beta `0.5.0`, e o que sobrar adiado para
  cá.
- **Os atalhos de ligação** (Atender e Recusar ou desligar), que estão no quadro "Configurações — atalhos", entram
  junto, porque usam o mesmo gancho. O atalho do overlay fica fora.
- **As telas que faltam no canvas** (aviso de dispositivo, faixa do servidor, qualidade da conexão, "Enviar logs" e
  a lista do Painel) são desenhadas na Etapa 0, no estilo dos quadros vizinhos.
- **Entram mais quatro (20/11):** o aviso de "você está mutado", o som do pressionar para falar, o Testar conexão e
  o estado do servidor no Painel. A mensagem não enviada guardada ao fechar o app ficou de fora.
- **Entra o volume dos sons do Ashtar (20/11).** Voltar para a sala ao reabrir e oferecer os logs depois de um
  travamento ficaram de fora.

### Decidido neste plano

**Configurações e atalhos (parte 1)**

1. **O microfone passa por uma cadeia só**, num `AudioContext`: o volume de entrada (um ganho de 0 a 200%), o
   RNNoise (se ligado) e o portão da detecção de voz, nessa ordem. É o mesmo processador do LiveKit que hoje põe o
   RNNoise na trilha (`setProcessor`), e fica ligado sempre que qualquer etapa dele vale alguma coisa. O nível que o
   medidor e a sensibilidade mostram é o da saída do ganho, antes do portão.
2. **A detecção de voz é um portão, não um mute.** Abaixo da sensibilidade, o portão manda silêncio na trilha, que
   continua publicada e sem o ícone de microfone cortado para os outros. Abre em 10 ms e fecha 300 ms depois de a voz
   cair, para não comer o fim das palavras. A sensibilidade automática segue o ruído de fundo (o piso medido nos
   últimos segundos, mais uma margem); a manual é uma régua em dB, de -100 a 0, com a marca dourada do quadro.
3. **O pressionar para falar é o mesmo portão**, aberto pelo atalho em vez da voz, com os mesmos 300 ms para fechar
   depois de soltar. Os dois modos são exclusivos, como no quadro: escolher um atalho de pressionar para falar não
   troca o modo sozinho, mas o modo Pressionar para falar sem atalho mostra o aviso para definir um. Com o portão
   aberto pelo atalho, o seu avatar ganha o anel de quem fala, como hoje.
4. **Mutado ganha do portão.** Mutar e ensurdecer continuam desligando o microfone como hoje (`setMicrophoneEnabled`);
   o portão só vale com o microfone ligado.
5. **Os atalhos globais vêm de um gancho do Windows, no Rust** (`WH_KEYBOARD_LL` e `WH_MOUSE_LL`, numa thread
   própria com o laço de mensagens). O gancho só olha, nunca segura a tecla: o jogo continua recebendo tudo. O
   `RegisterHotKey` (e o plugin de atalhos do Tauri) segura a tecla, e por isso não serve (BACKLOG da v0.2.2).
6. **Atalhos de agora:** Desativar microfone, Desativar áudio, Pressionar para falar, Atender ligação e Recusar ou
   desligar, como no quadro. Os padrões são os do quadro (`Ctrl+Shift+M`, `Ctrl+Shift+D`, nenhum, `Ctrl+Shift+A` e
   `Ctrl+Shift+E`). Uma combinação é até três modificadores e uma tecla, ou um botão do mouse (os laterais, `X1` e
   `X2`, e o do meio), sozinho ou com modificadores. O clique esquerdo e o direito não podem.
7. **Gravar um atalho** é como no quadro "Configurações — atalhos (gravando)": Trocar põe a linha gravando, a próxima
   combinação apertada vira o atalho, Esc ou Cancelar desiste. Enquanto grava, os atalhos não disparam. A mesma
   combinação em duas linhas não pode: a nova mostra quem já usa ("Já é o atalho de Desativar microfone").
8. **Os atalhos e o modo de entrada ficam no computador**, no `settingsStore` (como os dispositivos), e o app manda a
   lista para o Rust ao abrir e a cada mudança. O Rust só avisa "apertou" e "soltou" com o nome do atalho; quem decide
   o que fazer é o app.

**Confiabilidade (parte 2)**

9. **A voz volta sozinha.** Quando o `livekit-client` desiste (o `Disconnected` que não foi pedido, nem a sala
   arquivada, nem a pessoa tirada ou movida), o app pede um token novo e entra de novo na mesma sala, com espera de
   1, 2, 5, 10, 20 e 30 segundos, e depois a cada 30 até 5 minutos. Durante isso o painel mostra "Reconectando…" (o
   quadro "Estados e avisos"), com o desligar ao lado. Depois de 5 minutos, fica o "Sem conexão com a sala" de hoje,
   com Tentar de novo. O mute e o surdo voltam como estavam; a câmera não volta (decisão da v0.4: nunca liga
   sozinha).
10. **O Windows acordando conta como queda.** Ao voltar da suspensão, o app reconecta a voz na hora, sem esperar o
    LiveKit perceber.
11. **A transmissão nativa volta sozinha.** Quando a `:screen` cai e a voz continua, o Rust entra de novo com um
    token novo, sem parar a captura nem o encoder, e quem assiste vê "Conexão perdida — reconectando" no lugar da
    imagem por alguns segundos. Quem transmite vê o aviso "Conexão perdida" do quadro. Se a voz também caiu, a
    transmissão espera a voz voltar e entra em seguida. Se não voltar em 2 minutos, acaba como hoje.
12. **Microfone desconectado:** o app troca para o padrão do Windows na hora, sem sair da sala, e mostra o aviso
    "Seu microfone foi desconectado — usando o padrão do Windows". Quando o escolhido volta, troca de volta e o aviso
    some. Sem nenhum microfone, entra mutado, com o aviso "Nenhum microfone encontrado". A saída segue a mesma regra,
    com o aviso dela.
13. **"Sem conexão com o servidor"** é uma faixa no alto da janela, embaixo da barra de título, que aparece quando o
    WebSocket fica mais de 5 segundos sem conectar (quedas menores não piscam nada). Mostra a próxima tentativa
    ("Tentando de novo em 8 s") e Tentar agora. Quando volta, a faixa some e o app recarrega o que pode ter mudado
    (canais, membros, não lidas e as mensagens do canal aberto). A voz não depende da faixa: com a API fora e o
    LiveKit no ar, a sala continua.
14. **A API ganha tempo limite** de 30 segundos por pedido (o `TimeoutLayer` do `tower-http`), com o erro `timeout`
    no mesmo formato dos outros. As rotas de upload (logs) ficam com 120.
15. **A qualidade da conexão aparece só quando está ruim.** Um ícone de sinal no bloco da pessoa, em laranja
    (Instável) ou vermelho (Ruim), lido do `ConnectionQuality` que o LiveKit já calcula para cada um; com a conexão
    boa, nada. No cartão da pessoa (na sala), a seção Conexão mostra o ping e a perda de pacotes dela. Os números vêm
    da própria pessoa: cada app manda os seus a cada 5 segundos por uma mensagem de dados da sala (como o surdo). O
    app antigo não manda, e o cartão mostra só o ícone.
16. **"Enviar logs"** em Configurações › Aplicativo junta os logs dos últimos 2 dias num `.zip` (no Rust), com a
    versão do app e do Windows, e manda para a API (`POST /api/logs`, até 10 MB). Um campo opcional deixa a pessoa
    dizer o que aconteceu. A API grava o arquivo no disco, ao lado do banco, e guarda os últimos 30 dias. Os logs não
    têm mensagens, mas têm nicks e ids; o texto do botão diz que só o dono vê.
17. **O dono vê os logs no Painel**, numa tela nova, Logs: quem mandou, quando, a versão, o que a pessoa escreveu, e
    Baixar. Só o dono (a permissão é dele, não vira permissão por pessoa). Quando chega um, o dono recebe o aviso no
    canto, como o de quem entrou no grupo.

**Os extras de 20/11**

18. **"Você está mutado"** aparece no painel de voz por 3 segundos quando a pessoa fala com o microfone mutado (não
    surda). O nível vem de um clone da trilha do microfone, que continua aberto enquanto ela está mutada (o mute do
    LiveKit desliga a trilha publicada, e o clone não). Não repete enquanto ela continua falando, e não aparece no
    pressionar para falar com o atalho solto. Uma chave em Voz e vídeo, ligada por padrão.
19. **O som do pressionar para falar:** um clique curto ao abrir e outro ao fechar o portão pelo atalho, original
    como os outros sons. Uma chave em Notificações, desligada por padrão. Só quem aperta ouve.
20. **Testar conexão**, em Voz e vídeo: usa o `ConnectionCheck` do `livekit-client` numa sala só da pessoa
    (`teste:{user_id}`, com um token de 1 minuto do `POST /api/voice/test-token`) e mostra o ping até o servidor, se
    a voz vai pelo caminho direto (UDP) ou pelo reserva (TCP, mais lento), e se dá para publicar. Leva uns 10
    segundos; numa sala, o teste lê os números da conexão que já existe, sem abrir outra.
21. **O estado do servidor**, numa tela Servidor do Painel de controle, só para o dono: a API (versão e há quanto
    tempo está no ar), o LiveKit (responde ou não, e em quanto tempo), o disco livre na pasta de dados e o último
    backup (o arquivo mais novo de `data/backups/`). Atualiza ao abrir e com um botão; sem aviso nem histórico.
22. **O volume dos sons do Ashtar** é uma régua no alto de Configurações › Notificações, de 0 a 100% (padrão 100%),
    que vale para todos os sons do app: mensagem, menção, toque da ligação, os sons da sala e o do pressionar para
    falar. Fica separada da voz e do volume de saída, que continuam sem mexer nos sons. O botão de ouvir de cada som
    usa a régua.

---

## Etapa 0: ADRs, roadmap, BACKLOG e canvas

Só documentos e desenho.

- O `PLAN.md` e o `NOTES.md` da v0.5 vão para `docs/plans/`, e a raiz recebe estes. Os `[ ]` da v0.5 que o teste da
  beta `0.5.0` não resolver ficam marcados como adiados lá, e os que pedem código entram no `NOTES.md` da v0.6.
- ADR **0029** (decisões 1 a 8, 18 e 19) e ADR **0030** (decisões 9 a 17, 20 e 21). A 0030 atualiza a 0016 (a sala) e a 0017 (o
  publicador nativo, que passa a reconectar).
- `docs/roadmap.md`: a v0.6 com a versão única, os atalhos de ligação, a lista do que já existia e o "Enviar logs"
  com o Painel.
- `BACKLOG.md`: saem os dois itens da v0.6 (a aba Voz e vídeo e o "Reconectando"), e o "Abrir pasta de logs" da
  v0.2.2, que já existe.
- Canvas: os quadros "Aviso — dispositivo desconectado", "Faixa — sem conexão com o servidor", "Voz — qualidade da
  conexão" (o bloco e o cartão), "Configurações — aplicativo (enviar logs)" e "Painel de controle — logs"; depois,
  "Voz — você está mutado", "Configurações — testar conexão" e "Painel de controle — servidor".

**Pronto quando:** as duas ADRs estão em `docs/adr/`, a 0016 e a 0017 apontam para elas, o roadmap tem a v0.6 nova e
os cinco quadros estão no canvas.

---

# Parte 1: configurações e atalhos

## Etapa 1: app, a cadeia do microfone

`features/voice/noise/` vira `features/voice/input/`.

- O processador de hoje (`rnnoise.ts`, `createProcessor`) vira a cadeia da decisão 1: `GainNode` do volume de
  entrada, o RNNoise opcional e o portão, num `AudioWorklet` só para o portão (mede o nível em blocos de 10 ms e
  aplica o ganho com rampa curta, sem clique).
- Um store `inputStore` com o volume de entrada, o modo (`voice` ou `ptt`), a sensibilidade (`auto` ou um número em
  dB), o eco e o ganho automático. O `noiseStore` entra nele, migrando o valor guardado.
- O nível medido sai da cadeia para a interface (`useInputLevel`), a 20 por segundo, sem passar por estado do React a
  cada bloco.
- O `switchNoiseSuppression` vira `applyInputChain`: põe, troca ou tira o processador quando qualquer opção muda,
  também no meio da chamada. Eco e ganho automático mudam as restrições da captura (`restartTrack`).
- O portão expõe `setHeld(boolean)` para o pressionar para falar (Etapa 4).
- Testes: o portão abre acima e fecha 300 ms abaixo; a sensibilidade automática segue o piso; a migração do
  `noiseStore`.

**Pronto quando:** com o volume de entrada em 50% a voz chega mais baixa para os outros; com a sensibilidade manual
alta, falar baixo não passa e o ícone de microfone dos outros não muda.

## Etapa 2: app, a aba Voz e vídeo completa

`features/voice/devices/components/VoiceSettings.tsx`, seguindo o quadro "Configurações — voz e vídeo".

- **Dispositivos:** a régua de volume embaixo de Entrada e de Saída. O volume de saída multiplica todas as vozes e
  transmissões (o `RoomAudio` e o `boost.ts`), por cima do volume de cada pessoa.
- **Testar microfone:** abre o microfone escolhido pela mesma cadeia e devolve o som na saída escolhida, com o
  medidor de 20 barras do quadro. Parar de testar fecha tudo. Numa sala, o teste não toca o próprio som (eco para os
  outros): só o medidor, lido da trilha publicada.
- **Modo de entrada:** os dois cartões, Detecção de voz e Pressionar para falar, o atalho com Gravar atalho (a mesma
  gravação da Etapa 4) e o bloco da sensibilidade, com a chave do automático e a régua com a marca dourada, que
  passa a ser arrastável com o automático desligado.
- **Processamento de voz:** Supressão de ruído (a de hoje), Cancelamento de eco e Controle automático de ganho.
- **Compartilhamento de tela:** Qualidade padrão (os presets do publicador nativo: Movimento e Nitidez) e Áudio
  padrão; o seletor de fontes passa a abrir com esses valores. A nota de conteúdo protegido fica.
- As seções de hoje (Câmera e Ligações) continuam, depois de Processamento.
- Testes: o volume de saída por cima do volume da pessoa; o teste para ao sair da tela.

**Pronto quando:** o quadro confere, e cada opção vale no meio de uma chamada, sem sair da sala.

## Etapa 3: Rust, o gancho de teclado e mouse

`desktop/src-tauri/src/shortcuts/` (novo).

- Uma thread com `SetWindowsHookExW(WH_KEYBOARD_LL)` e `WH_MOUSE_LL` e o laço `GetMessageW`. Cada evento atualiza o
  conjunto de teclas apertadas e compara com a lista de atalhos; o callback devolve sempre `CallNextHookEx` (decisão
  5) e faz o mínimo (o Windows desliga um gancho que demora mais de ~300 ms): manda o evento por um canal para outra
  thread, que fala com o Tauri.
- Comandos: `shortcuts_set(lista)` e `shortcuts_record(bool)` (no modo gravar, manda cada combinação apertada para o
  app e não dispara nenhum atalho). Eventos para o app: `shortcut` com `{ id, pressed }` e `shortcut-recorded` com a
  combinação.
- As teclas guardadas pelo código virtual (`VK_*`), com o nome mostrado vindo do `GetKeyNameTextW` (o teclado ABNT2
  mostra o nome certo).
- Repetição do teclado (a tecla segurada manda vários `WM_KEYDOWN`) conta uma vez. Soltar qualquer tecla da
  combinação solta o atalho.
- Testes do casamento das combinações (sem o Windows): modificadores em qualquer ordem, a repetição, o botão do
  mouse com e sem modificador.

**Pronto quando:** com o Ashtar minimizado e um jogo em foco, o app recebe "apertou" e "soltou" do atalho, e o jogo
continua recebendo a tecla.

## Etapa 4: app, a aba Atalhos, o pressionar para falar e o aviso de mutado

`features/settings/` ganha a tela Atalhos, seguindo os quadros "Configurações — atalhos" e "(gravando)".

- A aba Atalhos no menu, em Ajustes, depois de Voz e vídeo. As seções Voz (Desativar microfone, Desativar áudio,
  Pressionar para falar) e Ligações (Atender ligação, Recusar ou desligar). Sem a seção Overlay.
- Cada linha: as teclas, Trocar (ou Definir, quando não tem) e o X para tirar. Restaurar padrões no alto.
- `useGlobalShortcuts`, montado uma vez no `AppShell`: manda a lista para o Rust e liga cada atalho à ação (o
  `toggleMute`, o `toggleDeafen`, o `setHeld` do portão, o atender e o recusar da ligação que está tocando).
- O modo Pressionar para falar: o portão fica fechado até o atalho, e o painel de voz mostra a tecla embaixo do nome
  da sala ("Pressionar para falar: V").
- O som do pressionar para falar (decisão 19), com a chave em Notificações, e a régua do volume dos sons (decisão
  22), aplicada no `playRoomSound` e nos sons de mensagem, menção e toque.
- O aviso "Você está mutado" (decisão 18): o clone da trilha, o detector com o mesmo limiar do portão, o aviso no
  painel de voz e a chave em Voz e vídeo.
- Testes: duas linhas com a mesma combinação; gravar e cancelar; o atalho de atender sem ligação tocando não faz
  nada; o aviso de mutado não repete falando sem parar, e não aparece surdo.

**Pronto quando:** dá para jogar com o pressionar para falar no botão lateral do mouse, e mutar pelo teclado, sem
tirar o foco do jogo.

---

# Parte 2: confiabilidade

## Etapa 5: app, a voz volta sozinha

`features/voice/room/components/VoiceProvider.tsx`.

- O `Disconnected` que não foi pedido (decisão 9) não limpa a sala: muda o estado para `reconnecting` e agenda a
  próxima tentativa, pelo mesmo caminho do "tentar de novo" (`attempt` no `VoiceTarget`).
- O `VoiceConnection` mostra "Reconectando…" (o quadro) para o `reconnecting` do LiveKit e para as tentativas do app,
  e não mais "Conectando…".
- O Rust avisa o app quando o Windows volta da suspensão (`WM_POWERBROADCAST`, `PBT_APMRESUMEAUTOMATIC`), e o app
  força uma tentativa na hora (decisão 10).
- A transmissão que o app assiste volta a ser assinada sozinha, e a miniatura continua.
- Testes: a sequência de esperas; o `Disconnected` pedido, o arquivado e o movido não tentam de novo; o mute e o
  surdo voltam.

**Pronto quando:** tirar o cabo de rede por 20 segundos e devolver traz a pessoa de volta para a sala, com o mesmo
mute, sem clicar em nada.

## Etapa 6: Rust e app, a transmissão nativa volta sozinha

`media/publisher.rs`, `media/share.rs` e `features/screen-share/`.

- O `on_lost` deixa de encerrar a transmissão: o `Publisher` guarda a captura e o encoder, pede um token novo da
  `:screen` ao app (um evento, que o app responde com o comando de sempre) e entra de novo, republicando as trilhas
  (decisão 11).
- O app mostra o aviso "Conexão perdida" do quadro para quem transmite, e quem assiste vê "Reconectando a
  transmissão…" no bloco.
- Depois de 2 minutos sem voltar, acaba como hoje, com o aviso "A transmissão caiu".
- Testes: o `share_e2e.rs` ganha o caso de derrubar a `:screen` e ver a trilha voltar.

**Pronto quando:** derrubar a conexão de quem transmite por 10 segundos e devolver traz a transmissão de volta para
quem assistia, sem ninguém clicar.

## Etapa 7: app, microfone e saída desconectados

`features/voice/devices/` e `features/voice/room/`.

- Quando o dispositivo efetivo muda porque o escolhido sumiu (decisão 12), o aviso do quadro "Aviso — dispositivo
  desconectado" aparece no canto, e some quando ele volta ou com o X.
- A troca no meio da chamada usa o `switchActiveDevice` do LiveKit, e a cadeia do microfone é refeita na trilha nova.
- Sem nenhum microfone: entra mutado com o aviso; quando um aparece, o aviso oferece Ativar microfone.
- Testes: sumir e voltar; trocar pela tela de configurações na chamada.

**Pronto quando:** tirar o fone USB no meio da sala passa a voz para o microfone do notebook com o aviso, e devolver
o fone volta para ele.

## Etapa 8: API e app, "Sem conexão com o servidor"

`api/src/lib.rs` e `desktop/src/app/`.

- API: o `TimeoutLayer` (decisão 14), com o erro `timeout` no formato de sempre e um teste.
- App: a faixa do quadro "Faixa — sem conexão com o servidor" no `AppShell`, lendo o `useRealtimeStatus`; o
  `connection.ts` expõe quando é a próxima tentativa e um `retryNow()`.
- Ao voltar, o `RealtimeBridge` invalida as consultas de canais, membros, não lidas e do canal aberto.
- Mandar mensagem com a faixa aparecendo usa o estado de envio de hoje, com o "Tentar de novo".
- Conferir que a sessão inválida leva à tela "Este computador saiu do grupo", e que um 401 qualquer refaz o login
  antes de desistir.

**Pronto quando:** derrubar a API por 30 segundos mostra a faixa, a sala de voz continua, e quando a API volta a
faixa some e as mensagens mandadas por outros nesse tempo aparecem.

## Etapa 9: API e app, a qualidade da conexão e o Testar conexão

`features/voice/room/` e o cartão do usuário.

- O ícone do quadro "Voz — qualidade da conexão" no `ParticipantTile`, lendo o `ConnectionQualityChanged` (decisão
  15). Também na linha da pessoa na lista da sala, ao lado do nome.
- A mensagem de dados `voice.stats` (`{ ping, loss }`) a cada 5 segundos, no mesmo tópico do surdo, só para a sala.
  O ping vem do `ping.ts`; a perda, do `getStats` da trilha do microfone.
- A seção Conexão no cartão da pessoa na sala: ping, perda e o texto (Boa, Instável, Ruim).
- API: `POST /api/voice/test-token`, um token de 1 minuto para a sala `teste:{user_id}`, que só a própria pessoa
  acessa e que o webhook ignora (ninguém vê a pessoa "entrar" nela).
- App: Testar conexão em Voz e vídeo, seguindo o quadro "Configurações — testar conexão" (decisão 20).

**Pronto quando:** limitar a rede de um computador (perda de 10% no `clumsy`) faz o ícone aparecer para os outros, e o
cartão dele mostra a perda; com o UDP bloqueado no firewall, o Testar conexão diz que a voz vai pelo caminho reserva.

## Etapa 10: API, Rust e app, "Enviar logs" e o estado do servidor

`api/src/routes/logs.rs` (novo), `desktop/src-tauri/src/logging.rs` e `features/updater/components/AppSettings.tsx`.

- API: `POST /api/logs` (corpo `.zip` com o texto e a versão nos cabeçalhos, até 10 MB, um a cada 5 minutos por
  pessoa), `GET /api/logs` e `GET /api/logs/{id}`, as duas só para o dono. Os arquivos ficam em
  `data/logs/`, com uma linha na tabela `log_reports`; a limpeza dos 30 dias roda junto do backup. O evento
  `logs.received` para o dono.
- Rust: o comando `logs_bundle`, que junta os arquivos dos últimos 2 dias e um `info.txt` (versão do app, do Windows,
  da GPU) num `.zip` na memória.
- App: o botão "Enviar logs" em Aplicativo, ao lado de "Abrir pasta", com o campo "O que aconteceu?" e a confirmação
  ("Logs enviados. O dono vai ver."). A tela Logs no Painel de controle, e o aviso no canto para o dono.
- O estado do servidor (decisão 21): `GET /api/admin/status` só para o dono, e a tela Servidor no Painel, seguindo o
  quadro "Painel de controle — servidor". O `compose.yaml` da VPS monta a pasta `data/backups/` na API só para
  leitura, se ainda não monta.
- Testes: o limite de tamanho e de frequência; quem não é dono recebe 404 na lista e no estado; a limpeza; o estado
  com o LiveKit fora.

**Pronto quando:** um membro manda os logs pelo app e o dono baixa o `.zip` pelo Painel; o Painel mostra o último
backup e o disco livre da VPS.

---

## Etapa 11: teste com três computadores

Sem publicar. Os cenários:

- uma hora de jogo com o pressionar para falar no botão do mouse e o mute pelo teclado, com o jogo em tela cheia;
- a detecção de voz com o automático, com ventilador e teclado de fundo;
- tirar o cabo de rede de quem transmite por 20 segundos; suspender o computador de quem está na sala e voltar;
- tirar e devolver o fone USB no meio da sala;
- derrubar a API por um minuto, com a sala aberta;
- falar mutado, e usar o pressionar para falar com o som ligado;
- o Testar conexão em casa e numa rede que bloqueia UDP;
- mandar os logs e baixar no Painel, e conferir o estado do servidor.

## Etapa 12: lançamento da `0.6.0`

- `0.6.0` no beta, uma semana de uso, depois o estável. Problema no beta vira `0.6.1`.
- As notas do "O que há de novo" (`CHANGELOG.md`), revisadas.
- A API da Etapa 10 já está no servidor desde antes.

---

## Riscos

- **O gancho de teclado é o ponto mais delicado.** Um callback lento faz o Windows desligar o gancho em silêncio, e
  um jogo rodando como administrador não manda as teclas para um app comum (UIPI). O primeiro caso é tratado com o
  canal (o callback só copia o evento); o segundo é aceito e explicado na aba Atalhos. Alguns anti-cheats olham
  ganchos globais: o Discord usa o mesmo caminho, mas conferir com os jogos do grupo na Etapa 11.
- **O portão mexe no áudio de todo mundo.** Uma sensibilidade automática ruim corta palavras. Por isso o padrão é o
  automático com margem folgada, e a régua mostra o nível ao vivo.
- **A reconexão não pode trazer de volta quem não devia voltar.** Quem foi desconectado, movido, ou perdeu o acesso à
  sala (v0.5) não reconecta; os testes da Etapa 5 cobrem cada motivo.
