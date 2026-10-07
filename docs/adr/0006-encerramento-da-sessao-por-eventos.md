# 0006 — Encerramento da sessão por eventos

- **Status:** aceita
- **Data:** 2026-09

## Contexto

Um compartilhamento (sessão) tem uma captura de vídeo e, opcionalmente, uma de áudio. Ele pode
terminar por três caminhos: o usuário para, a janela compartilhada fecha, ou uma captura falha.

O `on_end` de uma captura roda dentro da própria thread dela. Se ele encerrasse a sessão diretamente,
chamaria `stop_and_join` no handle da mesma thread, e uma thread fazendo join em si mesma entra em
panic ou trava para sempre, dependendo da plataforma. O bug só apareceria quando alguém fechasse a
janela compartilhada.

Além disso, o protótipo deixava a limpeza de uma sessão pela metade a cargo do JavaScript, o que
causou vazamentos.

## Decisão

- O `on_end` das capturas não encerra nada: só envia um `SessionEvent` (`VideoEnded` ou `AudioEnded`,
  com o id da sessão) por um canal. O `ScreenShareManager` recebe o evento e encerra a sessão de fora
  da thread de captura.
- **Quem remove a sessão do manager é quem emite o evento de fim.** Se o usuário parou, o comando
  remove e emite `stopped`; o `VideoEnded` que chega depois não encontra a sessão (o id não bate) e
  não emite nada. O evento sai exatamente uma vez.
- O início é atômico: o comando só responde depois de vídeo e áudio inicializarem. Se o áudio
  falhar, o vídeo já iniciado é parado e o erro é devolvido.
- Se só o áudio cair, o vídeo continua e o evento emitido é o `screen-share-audio-ended`.

## Alternativas consideradas

- **Encerrar a sessão direto no `on_end`, pulando o join do próprio handle.** Funciona, mas espalha
  uma regra sutil por todo lugar que encerra sessões; o canal concentra o encerramento num lugar só.

## Consequências

- O frontend nunca vê uma sessão pela metade nem recebe dois eventos de fim para a mesma sessão.
- ACKs e eventos de sessões antigas são ignorados pela comparação de ids.
- Quando o processo cujo áudio está sendo capturado fecha, o WASAPI pode simplesmente parar de
  entregar pacotes, sem erro; nesse caso o `AudioEnded` nunca chega, o que é aceitável.
