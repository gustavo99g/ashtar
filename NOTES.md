# NOTES — pendências da v0.3 (conversas privadas)

Lista de verificação da fase descrita no [`PLAN.md`](PLAN.md). Cada item deve ser resolvido ou conscientemente
adiado (marcar como tal) antes de fechar a entrega em que ele está. A lista da fase anterior está arquivada em
[`docs/plans/v0.2.4-notes.md`](docs/plans/v0.2.4-notes.md).

## Antes de começar

- [ ] **Pendências da v0.2.4** (os `[ ]` de `docs/plans/v0.2.4-notes.md`): a medição em NVIDIA e Intel, tela cheia exclusiva, HDR e
      notebook com duas GPUs. Decidir se seguem como correções `0.2.4x` em paralelo ou fecham antes.
- [ ] **A v0.2.5 (VPS)** segue em paralelo. Só a Etapa 23 depende dela.

## Vindos do BACKLOG

- [ ] **Tempo limite no `requestVoiceToken`:** com a API fora do ar, o app fica em "conectando" (Etapa 5).
- [ ] **`MIN_CLIENT_VERSION=0.2.20`** no `.env` de produção (Etapa 5). É só configuração.
- [ ] **Volume por usuário**, que o roadmap tinha na v0.5: adiantado para a Etapa 4.
- [ ] **A trava de uma transmissão por vez** só existe no app. Com as ligações ela precisa valer por sala
      (Etapa 21).

## v0.3.0 — base visual

- [ ] **Quem vê o menu do servidor:** o Convidar hoje é só do dono. Conferir o que aparece para quem gerencia
      canais e não é dono (sem Convidar) e para quem não é nenhum dos dois (sem menu).
- **Submenu nos testes:** o base-ui deixa os itens do submenu com `pointer-events: none` no jsdom. Use o
  `userEvent` com `pointerEventsCheck: 0` e `fireEvent.click` no item.
- **Entre a Etapa 1 e a 2 não há como reordenar dentro de uma categoria.** As duas saem juntas na `0.3.0`.
- [ ] **"Criar canal de voz"** aparece no quadro e fica de fora: criar sala de voz é da v0.5.
- [ ] **Sair do modo Organizar com mudanças** (trocar de tela, fechar a janela): confirmar ou descartar.
- [ ] **409 no Concluir:** recarregar a árvore sem perder o modo, com um aviso do que aconteceu.
- [ ] **Volume individual e o "ficar sem áudio":** o deafen cala as vozes sem apagar o volume de cada um.
- [ ] **O caminho com ganho (acima de 100%) com várias vozes:** hoje serve a uma trilha, a da transmissão.
      Conferir o custo e a troca da saída de áudio com cinco pessoas acima de 100%.
- [ ] **O volume guardado é por pessoa, no computador:** conferir que sobrevive a reinstalar e ao auto-update.

## v0.3.1 — todo o chat

### Experimento (Etapa 6)

- [ ] **A notificação do Windows aparece com o app só na bandeja**, instalado (e não só em desenvolvimento)?
- [ ] **Clicar nela abre a conversa certa?** Se o clique não chegar ao app, vale o plano B (aviso próprio).
- [ ] **Ponto de não lido** no ícone da bandeja e na barra de tarefas.
- [ ] **Iniciar com o Windows direto na bandeja**, sem piscar a janela, e convivendo com o auto-update.
- [ ] **Modo de foco do Windows e jogo em tela cheia:** a notificação some? É o comportamento esperado.

### Banco e API

- [ ] **A migração `0004` refaz a tabela `channels`**, que as mensagens referenciam. Rodar numa cópia do banco
      de produção e conferir as contagens antes e depois; backup feito antes de aplicar.
- [ ] **O ponteiro de lido nasce na última mensagem de cada canal**, para todos os membros, na própria
      migração: ninguém abre a `0.3.10` com tudo como não lido. Conferir também quem entra no grupo depois.
- [ ] **Toda consulta de canais filtra o tipo** (`kind IN ('text', 'voice')`): a `dm` tem `name` e
      `position` nulos, e uma consulta esquecida quebra ao ler a linha. Revisar `channels.rs`, `layout.rs`,
      `categories.rs` e o `admin`.
- [ ] **Nenhuma rota vaza uma conversa:** o `GET /api/channels`, o layout, os arquivados, o `ready`, o
      `?after=` da reconexão e o `admin`. Revisar uma a uma, além dos testes.
- [ ] **O `admin semear` e o `admin membros`** continuam funcionando com o tipo novo.
- [ ] **App antigo com a API nova:** a `0.3.0` e a `0.2.4x` ignoram os eventos e campos novos? Se não, subir o
      `MIN_CLIENT_VERSION` junto com a `0.3.10`.
- [ ] **Conexão atrasada no `broadcast`** (fechamento 4000): a volta pelo `?after=` também traz as conversas.
- [ ] **Remover alguém do grupo:** as conversas dela ficam só para leitura para quem ficou.
- [ ] **Menção a quem não lê o canal:** numa conversa privada, `@nick` de um terceiro não notifica ninguém.
- [ ] **Nick dentro de palavra ou de link** (`email@nick.com`): não vira menção.
- [ ] **Invisível não pode vazar:** a pessoa invisível some do `ready`, do `GET /api/people` e do
      `presence.changed` dos outros, mas aparece na sala de voz se entrar nela. Avisar isso no menu.

### App

- [ ] **A lateral na casca do app:** conferir o espaço na sala de voz, no Foco e com a miniatura da
      transmissão, que hoje encaixa nos cantos.
- [ ] **A janela da conversa por cima da transmissão:** não pode cobrir os controles da sala.
- [ ] **Marcar como lido com a janela sem foco:** não marcar. Com o app na bandeja, também não.
- [ ] **"Marcar tudo como lido"** limpa os canais e as conversas, inclusive as menções, e os números somem
      na hora na bandeja e na barra de tarefas.
- [ ] **A linha "novas mensagens"** some depois de lida e não pula com mensagem chegando.
- [ ] **Duas notificações para a mesma mensagem** (aviso no canto e Windows): só uma.
- [ ] **Muitas mensagens seguidas** da mesma pessoa: juntar numa notificação.
- [ ] **Os sons** (mensagem, menção e, na v0.3.2, o toque): próprios ou de licença livre, com a origem
      anotada no repositório.
- [ ] **O som da notificação** sai na saída de áudio escolhida em Voz e vídeo, e não toca em Ocupado.
- [ ] **"Começou a transmitir"** não avisa quem já está na sala nem quem transmite.
- [ ] **Os textos da aba Notificações e do menu de status**, revisados.

### A decidir durante a entrega

- [ ] **A lateral começa minimizada na sala de voz?** O plano diz que sim, para a transmissão não perder
      espaço. Conferir no uso.
- [ ] **`@todos`:** fica de fora por enquanto. Reavaliar depois de uma semana de uso.
- [ ] **Silenciar com prazo** (1 hora, até amanhã) ou só ligado e desligado. Começa só ligado e desligado.
- [ ] **Ocupado some sozinho?** Ao reiniciar o app ou no dia seguinte. Começa ficando até a pessoa trocar.
- [ ] **Fechar uma conversa da lista** (esconder sem apagar): hoje a lista mostra todas.

## v0.3.2 — ligações privadas

### Experimento (Etapa 18)

- [ ] **Botões na notificação do Windows** (Atender e Recusar): o plugin do Tauri dá suporte? Se não, a janela
      pequena sempre no topo.
- [ ] **A janela de ligação não pode roubar o foco** de um jogo em tela cheia.
- [ ] **O toque com a janela escondida:** o WebView escondido toca som? Se não, tocar pelo Rust.

### API e app

- [ ] **O webhook do LiveKit de uma sala privada** não pode sair no `voice.participants` de todos.
- [ ] **A ligação fica presa** se o app de um dos dois cair: o `room_finished` e um tempo limite fecham o
      registro.
- [ ] **Ligar para quem está offline:** o botão fica apagado. Quem está Invisível aparece offline, então
      também não recebe ligação: conferir se é o que se quer, ou se o Invisível deve tocar mesmo assim.
- [ ] **Quando quem liga sai da sala:** o plano diz que só ao ser atendido, para não sair à toa numa chamada
      perdida. Conferir com o quadro "Conversas — aviso antes de ligar".
- [ ] **Ligar para quem já está em outra ligação privada:** toca normalmente, e atender desliga a outra.
- [ ] **Os dois ligando ao mesmo tempo:** viram uma ligação só.
- [ ] **A `:screen` da sala** é derrubada quando a pessoa sai da sala para atender (o kick da ADR 0017).
- [ ] **A miniatura da transmissão** de quem estava assistindo na sala e atendeu uma ligação: fecha.
- [ ] **Atualização pendente durante a ligação:** pergunta antes de reiniciar, como na sala.
- [ ] **Cota do LiveKit**, se a v0.2.5 atrasar: a entrega espera.

## Riscos e cuidados

- [ ] **Privacidade é o risco principal da fase.** Qualquer rota ou evento novo tem de passar pela regra de
      leitura; os testes de vazamento rodam no pipeline e não podem ser pulados.
- [ ] **A v0.3.1 é grande** (onze etapas). Se apertar, o corte é publicar as conversas com as não lidas
      (Etapas 7, 8, 11, 12 e 13, mais o ponteiro da 9) e deixar menções, silenciar e status numa `0.3.11`.
- [ ] **O tempo real com destinatário muda o caminho de todos os eventos.** Um erro ali derruba o chat
      inteiro: a Etapa 8 sobe sozinha na API e roda uns dias com o app atual antes do resto.
- [ ] **As notificações dependem do Windows de cada um** (modo de foco, notificações desligadas para o app).
      O aviso do canto e as não lidas não podem depender delas.
