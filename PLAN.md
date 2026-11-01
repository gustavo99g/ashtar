# Plano — v0.2.3: chat real

O chat do grupo, com vários canais de texto em categorias, um WebSocket próprio da API e a supressão de
ruído, publicados junto com o Painel de controle da v0.2.2 numa versão só, a `0.2.30`
(`docs/roadmap.md`). O plano da fase anterior está arquivado em
[`docs/plans/v0.2.2-ui-nova.md`](docs/plans/v0.2.2-ui-nova.md).

**Objetivo desta fase:** o grupo conversa por texto no Ashtar, em canais que quem tem permissão cria e
arruma, sem depender de outro aplicativo; quem está numa chamada lê o chat sem perder a transmissão de
vista; e o microfone deixa de levar o teclado e o barulho de fundo.

**Fora do escopo:** editar, excluir, responder, reações, anexos, markdown e busca (v0.7); "digitando…",
menções, status como Ausente e criar sala de voz (v0.5); não lidas e notificações (v0.3); canal que só
algumas pessoas veem (v0.3); as opções da aba Voz e vídeo (v0.6).

Base: a `feature/0.2.3`, commit `b428171`. Em cada etapa, `cargo fmt --check`, `cargo clippy --all-targets
-- -D warnings` e `cargo test` (em `api/` e em `desktop/src-tauri/`) e `pnpm lint`, `pnpm build` e
`pnpm test` (em `desktop/`) devem passar.

## Progresso

| Etapa | Descrição | Status |
|---|---|---|
| 0 | Decisões: ADRs 0015 e 0016, roadmap, BACKLOG | Pendente |
| 2 | API: banco do chat, mensagens, `GET /api/people`, limite de envio | Pendente |
| 3 | API: WebSocket, presença, eventos, webhook do LiveKit | Pendente |
| 4 | API: canais e categorias, layout, arquivar, `canais.gerenciar` | Pendente |
| 5 | App: `lib/realtime` e o fim das consultas repetidas com o socket aberto | Pendente |
| 6 | App: o chat | Pendente |
| 7 | App: a árvore de canais | Pendente |
| 8 | App: a miniatura da transmissão | Pendente |
| 9 | App: a supressão de ruído (RNNoise) | Pendente |
| 10 | Lançamento: webhook no LiveKit Cloud, roteiro, `0.2.30` | Pendente |

A numeração pula a 1: a correção do eco que ela teria já saiu (`webview_process.rs`).

Branches: tudo na `feature/0.2.3`, um pull request por etapa para dentro dela. Nada é publicado até a
Etapa 10, que leva a `feature/0.2.3` para a `dev` (beta) e depois para a `main`.

## Decisões

As decisões de arquitetura estão nas ADRs, que são a fonte:
[`0015-chat-e-tempo-real.md`](docs/adr/0015-chat-e-tempo-real.md) (envio, histórico, WebSocket, presença,
eventos) e [`0016-canais-e-categorias.md`](docs/adr/0016-canais-e-categorias.md) (a árvore, arquivar, a
permissão). Abaixo, o que foi combinado para esta fase e não cabe numa ADR.

**Combinado (19 e 31/10):**

- uma versão só, a `0.2.30`, com o Painel, o chat, os canais, a miniatura e a supressão de ruído;
- quem entra depois vê todo o histórico; mensagens de 1 a 2.000 caracteres; 5 mensagens a cada 5 s por
  pessoa;
- a tela do servidor passa a ser o canal de texto aberto; quem está em chamada deixa de ser mandado direto
  para a sala;
- miniatura da transmissão quando se sai da sala assistindo alguém: arrasta, gruda no canto mais próximo,
  some nas configurações;
- na coluna de membros, "Na Jogatina" ou "Transmitindo" embaixo do nome; rascunho guardado por canal;
  "(saiu do grupo)" ao lado do nome de quem foi removido; o app reabre no último canal aberto; o tópico do
  canal no cabeçalho;
- um script de desenvolvimento que enche um canal do banco local com mensagens falsas;
- categoria recolhida mostra o canal aberto, a sala em que você está e as salas com gente, só com os
  avatares (até 5 e um "+N");
- supressão de ruído sempre ligada, com RNNoise, sem opção na tela; o Krisp foi descartado porque depende
  do LiveKit Cloud, que sai na v0.2.4.
