# NOTES — pendências da v0.2.3 (chat real)

Lista de verificação da fase descrita no [`PLAN.md`](PLAN.md). Cada item deve ser resolvido ou
conscientemente adiado (marcar como tal) antes de fechar a fase. A lista da fase anterior está arquivada em
[`docs/plans/v0.2.2-notes.md`](docs/plans/v0.2.2-notes.md).

## Vindos do BACKLOG

- [ ] **Consultas repetidas** (adiadas da v0.2.2): a lista da sala a cada 5 s e o aviso de quem entrou a
      cada 30 s viram eventos do WebSocket, e as consultas só rodam com o socket fora. Etapas 3 e 5.
- [ ] **Quadro "Canal de texto"** do canvas como referência visual. Etapas 6 e 7, só com o que esta fase
      leva.
- [ ] **Supressão de ruído** (a parte da v0.2.3 da aba Voz e vídeo): sempre ligada, com RNNoise. Etapa 9.

## Riscos para conferir

- [ ] **O Tailscale Funnel e uma conexão parada:** o socket pode cair a cada poucos minutos. O ping da API
      a cada 25 s deve segurar; medir na API de casa na Etapa 3.
- [ ] **O webhook do LiveKit até o computador de casa:** um evento perdido com o socket aberto só se corrige
      no próximo. Medir na Etapa 10, com o LiveKit Cloud configurado.
- [ ] **A assinatura do webhook no `livekit-api` 0.7.1:** se a crate não verificar, a API confere o JWT
      por conta própria. Etapa 3.
- [ ] **CPU do RNNoise com um jogo aberto.** Etapa 9.
