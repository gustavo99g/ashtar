# 0005 — Threads de captura criadas por `spawn_capture`

- **Status:** aceita
- **Data:** 2026-09

## Contexto

As capturas de áudio e vídeo rodam em threads próprias, porque as APIs do sistema são bloqueantes e
exigem ser usadas na thread onde foram criadas. No protótipo, cada captura criava sua thread de um
jeito, e isso causou três classes de problema:

- o comando respondia sucesso antes de a captura inicializar, e erros de inicialização apareciam só
  no log;
- um panic numa thread de captura a matava em silêncio, e o app continuava achando que ela estava
  ativa;
- não havia garantia de que uma captura esquecida parasse.

## Decisão

Toda thread de captura nasce por `media::spawn_capture`, que:

- cria a thread com nome;
- **bloqueia até a inicialização terminar**: o corpo da captura chama `ctx.ready.ok()` ou
  `ctx.ready.fail(erro)`, e o erro volta para quem chamou;
- garante, com um guard (`EndGuard`), que o `on_end` seja chamado **exatamente uma vez** e **só se
  a captura iniciou**, inclusive quando a thread entra em panic.

O `CaptureHandle` devolvido tem `request_stop()`, que não bloqueia, e `stop_and_join()`, que
bloqueia. Um handle descartado pede a parada no `Drop`.

`spawn_capture` e `stop_and_join` bloqueiam e só podem ser chamados dentro de `spawn_blocking`.

## Alternativas consideradas

- **Oneshot do `tokio` para a inicialização.** Funcionaria, mas o canal da biblioteca padrão basta,
  já que a chamada acontece dentro de `spawn_blocking`, e evita uma dependência.

## Consequências

- Capturas novas (inclusive de outras plataformas) só escrevem o corpo: inicializar, sinalizar,
  rodar o loop e devolver o motivo do fim.
- Os comportamentos de inicialização, panic e parada têm testes próprios no `capture.rs`, sem
  depender de captura real.
- Quem encerra uma captura não pode ser a própria thread dela; ver 0006.
