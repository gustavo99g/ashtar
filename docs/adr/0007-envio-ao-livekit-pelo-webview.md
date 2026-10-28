# 0007 — Compartilhamento publicado pelo webview, via IPC

- **Status:** aceita, provisória (revisão prevista numa versão seguinte)
- **Data:** 2026-09

## Contexto

A captura acontece no Rust (ver 0001), mas a conexão com a sala do LiveKit está no webview. Era
preciso decidir como os frames e o áudio capturados chegam ao LiveKit. Havia dois caminhos:

- enviar os dados pelo IPC do Tauri para o webview, que os publica na mesma conexão da voz;
- publicar direto do Rust, com a crate `livekit`, numa segunda conexão (um participante
  `{user_id}:screen` que só publica).

O protótipo já funcionava pelo primeiro caminho, e o segundo tem uma incógnita importante: se o
libwebrtc da crate codifica vídeo por hardware no Windows. Codificar 1080p60 em software consome
muita CPU, justamente enquanto o usuário está jogando.

## Decisão

Por enquanto, o compartilhamento é publicado pelo webview:

- o vídeo sai do Rust em I420, pelo `Channel` do Tauri com bytes crus, com backpressure por ACK
  (`FrameGate`), e vira uma trilha no webview com o `MediaStreamTrackGenerator`;
- o áudio sai em f32, pelo mesmo tipo de canal, e vira uma trilha por um `AudioWorklet` com jitter
  buffer.

O código fica atrás da interface `ScreenShareController` no frontend e dos sinks no Rust, para que a
alternativa possa ser implementada ao lado e comparada.

## Alternativas consideradas

- **Publicador nativo em Rust**, descrito acima. Elimina o volume de dados no IPC, a dependência da
  thread principal do webview e o problema de relógio do áudio no `AudioContext`. Custa uma segunda
  conexão por usuário e depende do encoder por hardware.

## Consequências

- A 1080p60, o volume no IPC passa de 180 MB/s; desempenho ruim nessa qualidade é esperado neste
  caminho.
- O webview pode desacelerar a thread principal com o app minimizado, afetando o compartilhamento.
- O `MediaStreamTrackGenerator` é uma API não padronizada do Chromium; funciona no WebView2 hoje,
  mas pode mudar.
- **Critério de revisão:** a medição lado a lado com o publicador nativo, numa versão seguinte. Se ele
  sustentar 1080p60 com CPU aceitável, esta decisão é substituída e o caminho IPC é removido.
- **Medição do caminho IPC (2026-10-05/06, release; [ADR 0009](0009-codec-e-bitrate-do-compartilhamento.md)):**
  o envio até o webview custa ~0,1 ms por frame e não é o gargalo: o fps depende da captura. O H.264 do
  WebView2 nessa máquina é o OpenH264, em software, e o VP8 aguenta melhor. A pergunta do encoder por
  hardware continua aberta para o publicador nativo, que usa a crate `livekit`.
