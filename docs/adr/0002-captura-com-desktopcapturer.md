# 0002 — Captura de vídeo com o `DesktopCapturer`

- **Status:** aceita
- **Data:** 2026-09

## Contexto

O protótipo tinha dois pipelines de captura de vídeo: um com o Windows Graphics Capture (WGC), pela
crate `windows-capture`, e outro com o `DesktopCapturer` do libwebrtc, exposto pela crate `livekit`.
Manter os dois dobraria o trabalho de manutenção.

Num teste inicial, o caminho com `DesktopCapturer` teve desempenho bem melhor. Mas o teste comparava
pipelines inteiros, não as APIs: o caminho WGC lia da GPU todos os frames na taxa do monitor, fazia
duas cópias em resolução cheia por frame (inclusive dos descartados) e enviava RGBA pelo IPC, cerca
de 2,7 vezes mais dados que o I420 do outro caminho.

O maior risco do `DesktopCapturer` não era desempenho, e sim correção: dependendo do método interno,
jogos DirectX e janelas aceleradas por hardware podem sair pretos.

## Decisão

A captura de vídeo usa apenas o `DesktopCapturer`.

A decisão foi condicionada a um teste de correção, que passou:

- janela do Chrome com vídeo tocando: capturada normalmente;
- janela parada: os frames continuam chegando, porque a captura é por demanda;
- jogo em janela: capturado corretamente.

## Alternativas consideradas

- **WGC com o pipeline corrigido** (ler da GPU só os frames aceitos, enviar I420). Continua sendo uma
  alternativa real: o teste não mostrou limitação do WGC em si.

## Consequências

- A listagem de fontes pode vir do mesmo lugar, com ids garantidamente compatíveis (ver 0003).
- O `DesktopCapturer` também existe no Linux, usando o portal do sistema com PipeWire.
- Conteúdo protegido por DRM (serviços de streaming) aparece preto. É uma proteção do sistema, igual
  em qualquer método de captura, e não deve ser contornada.
- Com um jogo aberto, a taxa caiu para cerca de 20 fps em build de dev. A investigação está pendente;
  se a causa estiver no próprio `capture_frame`, esta decisão deve ser revista em favor do WGC
  corrigido.
