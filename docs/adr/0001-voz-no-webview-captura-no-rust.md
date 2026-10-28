# 0001 — Voz no webview, captura no Rust

- **Status:** aceita
- **Data:** 2026-09

## Contexto

O app é feito com Tauri: interface em React num webview e núcleo em Rust. A mídia em tempo real
passa por um servidor LiveKit, que tem SDK tanto para JavaScript (`livekit-client`) quanto para Rust
(crate `livekit`). Era preciso decidir quem conecta na sala, quem cuida do microfone e da reprodução
das vozes, e quem captura a tela.

Duas limitações pesaram:

- O webview não consegue capturar o áudio de um único aplicativo, nem excluir o próprio app do áudio
  do sistema. Sem isso, quem compartilha a tela com áudio manda de volta as vozes da chamada.
- Levar vídeo decodificado do Rust para o webview custa caro: a 1080p, são centenas de megabytes por
  segundo atravessando o IPC, pela thread principal da interface.

## Decisão

Cada lado cuida da mídia na direção em que é bom.

- **Webview (React):** conexão com a sala, microfone, reprodução das vozes e exibição das
  transmissões dos outros participantes, tudo pelo `livekit-client`.
- **Rust:** captura de janelas e telas, e captura do áudio de um aplicativo com a API do sistema
  (WASAPI no Windows).

## Alternativas consideradas

- **Tudo no Rust, com uma conexão só.** Exigiria reimplementar o cancelamento de eco (que o navegador
  faz usando o áudio que está tocando como referência), a mixagem e o controle de volume por pessoa,
  e trazer o vídeo recebido de volta para o webview, recriando o problema do IPC no sentido inverso.
- **Tudo no webview, com `getDisplayMedia`.** Perderia a captura de áudio por aplicativo e o controle
  sobre a captura.

## Consequências

- A voz funciona sem mudanças numa eventual versão web.
- O caminho pelo qual a captura chega ao LiveKit é uma decisão separada (ver 0007).
- O Linux será avaliado depois, e o macOS está fora do escopo. No Linux, o webview (WebKitGTK) tem
  suporte fraco a WebRTC; se isso se confirmar, esta decisão precisa ser revista para essa plataforma.
