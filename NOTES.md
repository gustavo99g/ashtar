# NOTES — problemas conhecidos do protótipo (v0.1)

Lista de verificação para a fase "reorganização + correções" (Etapas 1-6 do `PLAN.md`).
Cada item deve ser resolvido ou conscientemente adiado (marcar como tal) antes de fechar a fase.

Convenção: **Base pronta** indica que a peça nova que resolve o problema já existe, mas o problema só
some de fato quando o código legado for substituído por ela.

## Rust — infraestrutura

- [x] Logging via `println!`/`eprintln!` espalhado pelo código, incluindo os relatórios de profiling
      (`StageTimings` e estatísticas por segundo) — sem nível, sem filtro, sempre ligados.
      **Resolvido:** `tracing` inicializado em `main.rs` (`EnvFilter` + hook de panic nomeando a
      thread). Todo `println!`/`eprintln!` do legado convertido: erros que interrompem algo →
      `error!`, problemas recuperáveis → `warn!`, eventos de ciclo de vida → `info!`, estatísticas
      por segundo → `debug!(target: "perf", ...)` com campos estruturados (filtrar só métricas com
      `RUST_LOG=info,perf=debug`). `pack_bgra` (morto) e o `process_frame_to_jpeg` comentado foram
      removidos junto.
      **Bug encontrado depois:** `EnvFilter::try_from_default_env()` trata `RUST_LOG` presente porém
      vazia (`RUST_LOG=`) como filtro válido e vazio, suprimindo todo log (até `error!`) sem cair no
      fallback. Corrigido em `main.rs` tratando "ausente" e "vazia" como o mesmo caso. De brinde,
      corrigido também o nome de crate errado no filtro padrão (`desktop` → `desktop_lib`, que é o
      nome real da lib no Cargo.toml e onde vive o `legacy/`). Também faltava `info!` de ciclo de
      vida na captura de vídeo (`DesktopCapturer`) — só o áudio tinha, porque o código original só
      tinha `println!` de início/fim no áudio. Confirmado end-to-end com `RUST_LOG=info,desktop_lib=debug,perf=debug`:
      início/fim de vídeo e áudio em `info!`, formato do stream em `debug!`, métricas de `perf` a cada
      segundo (`capture_frame() calls`, `capture stats`, `pipeline stats`).
- [x] Panic numa thread de captura passava despercebido: a thread morria em silêncio e o app continuava
      achando que a captura estava ativa. **Resolvido em duas partes:** hook de panic com o nome da thread
      (Etapa 2) e `EndGuard` no `spawn_capture`, que encerra a captura com `EndReason::Error` mesmo em
      panic (Etapa 3, passo 2).
- [ ] Erros de comando são `String` livre; frontend não consegue diferenciar casos (ex. "fonte fechada")
      sem comparar texto de mensagem. **Base pronta:** `AppError` com `{ kind, message }` e `isAppError`
      no `commands.ts`. Resolve de vez quando os comandos novos (Etapa 4) substituírem os legados.
- [ ] Nenhuma garantia de que uma thread de captura esquecida realmente para (sem `Drop` no handle).
      **Base pronta:** `CaptureHandle` com `Drop` que pede a parada. Resolve quando as capturas migrarem
      para `spawn_capture` (Etapa 3, passos 5 e 6).
- [ ] Código legado com declarações FFI à mão e dependências que saem com ele (`windows-capture`,
      `fast_image_resize`). Resolve na remoção do `legacy/` (Etapa 4.4).

## Rust — listagem de fontes

- [x] `SendMessageW` podia travar em janelas que não respondem. **Resolvido:** `SendMessageTimeoutW`
      com `SMTO_ABORTIFHUNG` e 50 ms em `platform/win32/sources/icon.rs`.
- [x] Callback do `EnumWindows` fazia enriquecimento (título, PID, ícone) dentro do próprio callback.
      **Resolvido de outra forma:** o `EnumWindows` saiu do projeto; as janelas vêm do `DesktopCapturer`
      e o enriquecimento acontece fora de qualquer callback. O único callback restante
      (`EnumDisplayMonitors`) só coleta handles.
- [x] Ícones antigos (sem canal alfa) viravam PNG transparente. **Resolvido:** correção do alfa em
      `icon.rs`.
- [x] Listagem de janelas não excluía as janelas do próprio app. **Resolvido:** `window_details` retorna
      `None` para o PID do próprio processo. Verificação com o app rodando na Etapa 6, item 7.
- [x] Declarações FFI feitas à mão no `sources.rs`. **Resolvido:** código novo de listagem usa
      `windows-sys`, com guards RAII (`ScreenDc`, `GdiObject`) e teste de vazamento de objetos GDI.
- [ ] Ids de monitor: o protótipo usava `HMONITOR`, mas o `DesktopCapturer` identifica telas pelo índice
      do `EnumDisplayDevicesW`. **Implementado:** monitores vêm do `DesktopCapturer` e são enriquecidos
      pelo nome do dispositivo (`monitor.rs`), com teste ignorado de mapeamento. **Falta:** confirmar com
      dois monitores conectados antes de marcar como resolvido.

## Rust — captura de vídeo

- [ ] Dois pipelines de captura de vídeo coexistem: `windows_capture` (WGC) e `DesktopCapturer`.
      **Decisão confirmada:** consolidar em `DesktopCapturer` (ver `PLAN.md`, decisão 1). O teste de
      correção passou: Chrome com vídeo, janela parada (frames continuam chegando) e jogo. O WGC não foi
      descartado por limitação técnica dele; o teste inicial comparou pipelines diferentes.
      **Falta:** remover o WGC junto com o `legacy/` (Etapa 4.4).
- [ ] Captura de vídeo e áudio acopladas ao destino (`Channel<InvokeResponseBody>`); não dá para trocar
      por outro sink sem duplicar a captura. **Base pronta:** traits `VideoSink`/`AudioSink`. Resolve com
      os passos 5 a 7 da Etapa 3.
- [ ] Loop de captura sem controle de taxa: chama `capture_frame` o mais rápido que o ACK permite
      (~43 fps com a tela parada), gastando CPU com frames idênticos. Corrigir com agendamento por
      deadline no `video_capture.rs`.
- [ ] Conversão para I420 ignora o stride do frame (assume `width * 4`), o que pode inclinar a imagem
      quando a textura tem padding no fim das linhas.
- [ ] Resize em BGRA com `fast_image_resize` e `ResizeAlg::Nearest`, precedido de `frame.data().to_vec()`
      (cópia do frame inteiro em resolução cheia). Substituir por conversão para I420 seguida do `scale`
      do libyuv (mais rápido e mais legível para texto).
- [ ] Timestamps a partir de `SystemTime` (relógio de parede, pode pular). Usar `Instant`.
- [ ] Loop de captura não trata "fonte fechada": quando a janela compartilhada é fechada, o capturer passa
      a retornar erro em todo frame e o log cresce indefinidamente. Corrigir com ~30 erros consecutivos →
      `EndReason::SourceClosed`.
- [ ] `in_flight` do caminho IPC é um contador sem sinal que pode dar a volta com um ACK duplicado,
      fechando o portão para sempre. **Base pronta:** `FrameGate` com decremento que para no zero.
      Também falta ignorar ACKs de sessões antigas (Etapa 4).

## Rust — captura de áudio

- [ ] Captura de áudio (WASAPI) usa polling em vez de modo por eventos.
- [ ] Buffer de captura de 20 ms, apertado demais: qualquer atraso da thread perde amostras. Usar 100 ms
      (em captura compartilhada, buffer maior não adiciona latência).
- [ ] Flag de silêncio (`AUDCLNT_BUFFERFLAGS_SILENT`) ignorada: o conteúdo desses pacotes deve ser zerado.
- [ ] Sem log de descontinuidade (glitch/drop) na captura de áudio.
- [ ] Inicialização da captura de áudio não é determinística no lado do chamador: erros de inicialização
      aparecem depois do comando já ter retornado sucesso. **Base pronta:** `spawn_capture` com
      `ReadySignal` (dispensa o oneshot do `tokio`).
- [ ] Modo de áudio `System` recebe `process_id` do frontend para decidir o que excluir; deveria usar
      `std::process::id()` automaticamente. `AudioMode` passa para o formato com tag (`PLAN.md`,
      decisão 3).
- [ ] Parar e iniciar em seguida pode falhar com "já existe uma captura ativa", porque o slot só é
      liberado quando a thread percebe a parada. Resolve com o `session.rs` (remover a sessão na hora).
- [ ] Áudio da captura é enviado ao frontend serializado como JSON (via `Channel<Vec<u8>>`) em vez de
      bytes crus (`InvokeResponseBody::Raw`).
- [ ] Imports e dependência do `hound` sem uso. (Verificar se já saiu na Etapa 2.)

## Rust — sessão

- [ ] Início de sessão (vídeo + áudio) não é atômico: se o áudio falha depois do vídeo já ter subido, a
      limpeza da metade que subiu fica a cargo do JavaScript — origem de vazamentos observados.
      Resolve com o `session.rs` (`PLAN.md`, decisão 6).
- [ ] Comportamento indefinido quando o app de origem do áudio fecha. **Decidido:** o vídeo continua e o
      evento `screen-share-audio-ended` é emitido (`PLAN.md`, decisão 7). Registrar na Etapa 6 se o
      WASAPI reporta erro ou só para de entregar pacotes.

## Frontend

- [ ] Publicação de vídeo no LiveKit sem `videoEncoding` nem `contentHint` explícitos (o preset padrão de
      compartilhamento de tela limita o encoder a 15 fps).
- [ ] Publicação de áudio sem `AudioPresets.musicHighQualityStereo` e sem `dtx: false`.
- [ ] Cópia extra desnecessária de buffer no handler de frame de vídeo.
- [ ] Sem proteção contra início duplo do compartilhamento (cliques rápidos/repetidos).
- [ ] `screenShareAudioRef` só é atribuído depois do `publishTrack` do áudio: se a publicação falhar, o
      cleanup não encontra o áudio e a captura no Rust continua rodando.
- [ ] `ScreenShareAudio.stop()` não é robusto: se `stopScreenShareAudio` lançar erro, o worklet e o
      `AudioContext` não são liberados; chamar `stop()` duas vezes lança erro no `context.close()`.
- [ ] `AudioWorkletProcessor` aloca dentro de `process()` e não implementa um jitter buffer de verdade
      (sem acúmulo inicial, sem descarte de amostras antigas) — causa estalos/latência variável.
- [ ] Deafen só cancela a assinatura das trilhas existentes no momento do clique: quem entra depois é
      ouvido. `RoomAudioRenderer` não usa `muted={isDeafened}`, e o undeafen não restaura o mute anterior.
- [ ] Sem tratamento de `Reconnecting`/`Reconnected` do LiveKit na UI.
- [ ] Sem `dispose()` chamado no cleanup do efeito nem no evento `Disconnected` — captura pode continuar
      rodando depois de trocar de canal ou sair da sala.
- [ ] Árvore de componentes não está envolvida por `RoomContext`, então hooks do LiveKit não funcionam
      de forma idiomática nos componentes filhos.
- [ ] `ActiveSpeakersChanged` recria o array de participantes e o `value` do contexto não é memorizado:
      todos os consumidores do `VoiceContext` re-renderizam várias vezes por segundo durante uma conversa.
      Resolve junto com o `RoomContext` e os hooks do LiveKit.
- [ ] Sem escuta do evento `screen-share-audio-ended`: ao receber, despublicar a trilha de áudio e avisar
      o usuário.

## Para verificar na Etapa 6

- [ ] Comportamento com o app minimizado: frames de vídeo e blocos de áudio passam pela thread principal
      do webview, que o WebView2 pode desacelerar. Se degradar, testar `additionalBrowserArgs` com
      `--disable-background-timer-throttling --disable-renderer-backgrounding
      --disable-backgrounding-occluded-windows` (mantendo os argumentos padrão do Tauri).
- [ ] Linha de base de desempenho em build de release, separada para os três presets de qualidade
      (decisão 16 do PLAN.md).

## Limitações conhecidas (não são bugs)

- Conteúdo com DRM (HBO, Netflix, Disney+ etc.) aparece preto: o Windows bloqueia a captura do vídeo
  protegido em qualquer método. Legendas aparecem porque são desenhadas como texto da página. Não
  contornar.
- Janelas minimizadas não geram frames: quem assiste vê o último frame congelado até a janela voltar.
- Apps da Microsoft Store: a janela pertence ao `ApplicationFrameHost.exe`, não ao processo que toca o
  som, então o áudio em modo aplicação pode sair mudo.
- `MediaStreamTrackGenerator` é uma API não padronizada do Chromium; funciona no WebView2 hoje, mas pode
  mudar. O publicador nativo do próximo plano elimina essa dependência.

## Fora do escopo desta fase (adiado conscientemente)

- Publicador de vídeo/áudio nativo em Rust (fica para o próximo plano).
- Medição/comparação de desempenho estruturada (fica para o próximo plano; a Etapa 6 só coleta a
  linha de base).
- Investigação da queda de fps com jogos (~18–20 fps em dev, quedas até 10): usar o target `perf` em
  build de release para descobrir se o tempo está no `capture_frame`, na conversão ou no IPC.
- Miniaturas no seletor de fontes. Enquanto isso, o seletor mostra só ícones. Pontos do código de preview
  do protótipo a corrigir quando voltarem ao escopo: previews enviados como `Vec<u8>` em JSON e uma
  sessão WGC aberta por janela.
- Aviso de possível conteúdo protegido (frames totalmente pretos por vários segundos).
- Suporte a Linux (risco principal: WebRTC no WebKitGTK) e versão web.
- Qualquer funcionalidade nova de voz além do que já existe.
