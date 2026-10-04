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
      por outro sink sem duplicar a captura. **Base pronta:** traits `VideoSink`/`AudioSink`, a captura de
      áudio e de vídeo sobre eles e os sinks do IPC (`IpcVideoSink`, `IpcAudioSink`); os passos 5 a 7 da
      Etapa 3 estão concluídos. Some quando os comandos novos substituírem o `legacy/` (Etapa 4.4).
- [ ] Loop de captura sem controle de taxa: chama `capture_frame` o mais rápido que o ACK permite
      (~43 fps com a tela parada), gastando CPU com frames idênticos. Corrigir com agendamento por
      deadline no `video_capture.rs`.
      **Base pronta:** `video_capture.rs` com deadline (um frame por intervalo, sem acumular atraso) e
      respeito ao `FrameGate`. Resolve quando os comandos novos o usarem (Etapa 4).
- [ ] Conversão para I420 ignora o stride do frame (assume `width * 4`), o que pode inclinar a imagem
      quando a textura tem padding no fim das linhas.
      **Base pronta:** `to_i420` passa `frame.stride()` ao libyuv, e o empacotamento do `IpcVideoSink`
      descarta o padding (testado com stride maior que a largura). A conversão BGRA → I420 não tem teste
      automático do stride, porque não dá para montar um `DesktopFrame` num teste.
- [ ] Resize em BGRA com `fast_image_resize` e `ResizeAlg::Nearest`, precedido de `frame.data().to_vec()`
      (cópia do frame inteiro em resolução cheia). Substituir por conversão para I420 seguida do `scale`
      do libyuv (mais rápido e mais legível para texto).
      **Base pronta:** `to_i420` converte em resolução cheia e reduz com o `scale` do I420 só quando o
      frame passa da caixa do preset (`fit_in_box`).
- [ ] Timestamps a partir de `SystemTime` (relógio de parede, pode pular). Usar `Instant`.
      **Base pronta:** `video_capture.rs` usa `Instant`, contado desde o início da captura.
- [ ] Loop de captura não trata "fonte fechada": quando a janela compartilhada é fechada, o capturer passa
      a retornar erro em todo frame e o log cresce indefinidamente. Corrigir com ~30 erros consecutivos →
      `EndReason::SourceClosed`.
      **Base pronta:** para janelas, o `window_state` (`IsWindow`/`IsIconic`) é conferido a cada volta e a
      captura encerra com `SourceClosed` quando a janela some; o WGC do libwebrtc não avisa (ADR 0008).
      Para telas, 1 s de falhas seguidas dispara a conferência da lista de fontes do capturer; se a fonte
      sumiu, encerra com `SourceClosed` (critério diferente dos ~30 erros do plano inicial, para não
      confundir janela fechada com minimizada).
- [ ] `in_flight` do caminho IPC é um contador sem sinal que pode dar a volta com um ACK duplicado,
      fechando o portão para sempre. **Base pronta:** `FrameGate` com decremento que para no zero.
      O `IpcVideoSink` usa o `FrameGate` e entra nele (`enter`) antes do envio, o que evita perder uma vaga
      quando o ACK chega antes de o `send` terminar; se o envio falha, a vaga volta. Continua faltando o
      `ipc_screen_share_ack` ignorar ACKs de sessões antigas (Etapa 4).

## Rust — captura de áudio

- [ ] Captura de áudio (WASAPI) usa polling em vez de modo por eventos.
      **Base pronta:** `audio_capture.rs` usa o modo por eventos. Resolve quando os comandos novos a
      usarem (Etapa 4).
- [ ] Buffer de captura de 20 ms, apertado demais: qualquer atraso da thread perde amostras. Usar 100 ms
      (em captura compartilhada, buffer maior não adiciona latência).
      **Base pronta:** buffer de 100 ms em `audio_capture.rs`. Resolve quando os comandos novos a usarem
      (Etapa 4).
- [ ] Flag de silêncio (`AUDCLNT_BUFFERFLAGS_SILENT`) ignorada: o conteúdo desses pacotes deve ser zerado.
      **Base pronta:** pacotes marcados como silenciosos chegam ao sink como zeros. Resolve quando os
      comandos novos a usarem (Etapa 4).
- [ ] Sem log de descontinuidade (glitch/drop) na captura de áudio.
      **Base pronta:** `warn!` quando o WASAPI sinaliza descontinuidade. Resolve quando os comandos novos
      a usarem (Etapa 4).
- [ ] Inicialização da captura de áudio não é determinística no lado do chamador: erros de inicialização
      aparecem depois do comando já ter retornado sucesso. **Base pronta:** `spawn_capture` com
      `ReadySignal` (dispensa o oneshot do `tokio`).
- [ ] Modo de áudio `System` recebe `process_id` do frontend para decidir o que excluir; deveria usar
      `std::process::id()` automaticamente. `AudioMode` passa para o formato com tag (`PLAN.md`,
      decisão 3).
      **Base pronta:** `spawn_audio_capture` usa `std::process::id()` no modo `System` e recusa capturar o
      próprio processo. Resolve quando os comandos novos a usarem (Etapa 4).
- [ ] Parar e iniciar em seguida pode falhar com "já existe uma captura ativa", porque o slot só é
      liberado quando a thread percebe a parada. Resolve com o `session.rs` (remover a sessão na hora).
      **Base pronta:** o `ScreenShareManager::stop` remove a sessão na hora, antes de esperar as threads, e
      um novo início já funciona (testado). Resolve quando os comandos novos o usarem (Etapa 4).
- [ ] Áudio da captura é enviado ao frontend serializado como JSON (via `Channel<Vec<u8>>`) em vez de
      bytes crus (`InvokeResponseBody::Raw`).
      **Base pronta:** `IpcAudioSink` envia os f32 como `InvokeResponseBody::Raw`. Resolve quando os
      comandos novos o usarem (Etapa 4).
- [ ] Imports e dependência do `hound` sem uso. (Verificar se já saiu na Etapa 2.)

## Rust — sessão

- [ ] Início de sessão (vídeo + áudio) não é atômico: se o áudio falha depois do vídeo já ter subido, a
      limpeza da metade que subiu fica a cargo do JavaScript — origem de vazamentos observados.
      Resolve com o `session.rs` (`PLAN.md`, decisão 6).
      **Base pronta:** `ScreenShareManager::start_with` sobe o vídeo e depois o áudio; se o áudio falha, o
      vídeo já iniciado é parado e o erro volta (testado). Resolve quando os comandos novos o usarem
      (Etapa 4).
- [ ] Comportamento indefinido quando o app de origem do áudio fecha. **Decidido:** o vídeo continua e o
      evento `screen-share-audio-ended` é emitido (`PLAN.md`, decisão 7). Registrar na Etapa 6 se o
      WASAPI reporta erro ou só para de entregar pacotes.
      **Base pronta:** o `ScreenShareManager` descarta o handle de áudio, avisa `ShareEvent::AudioEnded` e
      mantém o vídeo (testado com uma captura falsa). Resolve quando os comandos novos o usarem (Etapa 4).
      A verificação com o WASAPI de verdade continua pendente.

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

- Publicador de vídeo/áudio nativo em Rust (fica para o próximo plano). Ele precisa de duas peças:
  1. **Redução na GPU antes de copiar para a memória**, para janelas em 4K cheio: readback (~7 ms) mais
     conversão (~10 ms) somam ~17 ms, mais que os 16,7 ms de um frame a 60 fps. Combina com o encoder
     por hardware, que também põe a GPU no caminho.
  2. **O publicador em si**, que tira o teto do `FrameGate`/ACK no caminho IPC (~43 fps, estimado na
     decisão 16 do `PLAN.md` com o caminho antigo, em dev; vale remedir após o Passo 7).

  Uma terceira peça, a captura própria de janelas com o `windows-capture`, estava prevista e **deixou de
  ser necessária**: o atraso das janelas vinha de o libwebrtc cair no GDI por falta de COM na thread, e o
  passo 9 corrigiu isso (ver o item da queda de fps em janelas, abaixo, e o ADR 0008).

  Pontos para observar depois do passo 9: janela parada custa uma conversão por volta, mesmo sem mudança
  (expor o `updated_region` exigiria mexer no `webrtc-sys`); jogos em tela cheia exclusiva podem não ser
  capturáveis como janela (o contorno é compartilhar a tela); conteúdo com DRM sai preto também no WGC.
- Medição/comparação de desempenho estruturada (fica para o próximo plano; a Etapa 6 só coleta a
  linha de base).
- Queda de fps na captura de **janelas** (antes registrada como "queda com jogos": ~18–20 fps em dev,
  quedas até 10). Medido em release, sem IPC, só com o `LogVideoSink`.

  **Resolvido no passo 9** (COM na thread de captura de janela → WGC do libwebrtc; ADR 0008). Medido
  depois, em release: janela 4K do Brave de ~14 para ~35–52 fps (varia com o conteúdo; chegou a 60 quando
  a imagem estabilizou); tela 4K a 60 fps (sem COM, segue no DXGI); janela fechada encerra com
  `SourceClosed`; janela minimizada repete o último frame (~2 fps). **Janela 4K a 60 fps continua para o
  plano do publicador nativo** (reduzir na GPU antes de copiar). As medições abaixo são de antes da
  correção.

  **Pelo libwebrtc (`DesktopCapturer`), por etapa** (cada janela com um conteúdo diferente, de cadência
  desconhecida; uma rodada por fonte, com outros programas abertos):

  | Fonte | Pixels | `capture_frame` | conversão | fps |
  |---|---|---|---|---|
  | Tela 1080p | 2,1 Mpx | 4,1 ms | 3,7 ms | 60 |
  | Tela 4K | 8,3 Mpx | ~12 ms | ~9 ms | 54–60 |
  | Janela 1928×1043 | 2,0 Mpx | 21–29 ms | 3,4–4,4 ms | ~47 |
  | Janela 2393×1146 | 2,7 Mpx | ~29 ms | ~3,9 ms | ~36 |
  | Janela 3854×2105 (4K) | 8,1 Mpx | ~65 ms | ~10,5 ms | ~16 |

  **WGC direto, sem o libwebrtc** (crate `windows-capture` do `legacy/`, teste
  `mede_o_wgc_de_uma_janela`; `readback` = `frame.buffer()`, a cópia GPU→memória), janelas de 3840×2088:

  | Janela | Conteúdo | Frames que chegam | Readback |
  |---|---|---|---|
  | VS Code | texto, quase parado | 13,5–18,2 fps | 6,4–6,7 ms |
  | Brave | página parada | 0,4–30 fps | 6,9–7,1 ms |
  | Brave | vídeo tocando | ~48 fps | 7,2–7,6 ms (máx. 8,9–12,3) |

  **Controle** (mesma janela do Brave, 3840×2088, vídeo tocando, rodadas separadas): o WGC direto entrega
  ~48 fps; o libwebrtc entrega ~14 fps (~71 ms por frame).

  O que está estabelecido: (1) a cópia GPU→memória do WGC custa ~7 ms em 4K, então **não** é o gargalo
  (isto corrige uma hipótese anterior deste item). (2) **Não** é espera por conteúdo novo: o WGC direto
  entrega 48 fps na mesma janela em que o libwebrtc só consegue 14, e o Brave parado chegou a 45–47 fps
  no libwebrtc. (3) **Não** é a conversão para I420 (3–10 ms). (4) **Não** é a composição do cursor:
  com `set_include_cursor(false)` continuou em ~14 fps. (5) Sobram ~50 ms por frame dentro do
  `capture_frame` do libwebrtc para janelas, que nem o readback nem a conversão explicam, e que não
  aparecem em telas do mesmo tamanho. **Causa: o libwebrtc usava o GDI, e não o WGC, para janelas
  (confirmado pelos módulos carregados). Corrigida no passo 9 (ADR 0008).**

  Como o `capture_frame` é síncrono, ele limita o fps do laço (fps ≈ 1000 / `capture_frame_ms`). Uma
  captura própria com o `windows-capture` custaria readback + conversão: ~5 ms até ~2,5 Mpx e ~17 ms em 4K
  cheio (não cabe em CPU; só reduzindo na GPU antes de copiar). Depois do passo 9 a captura própria deixou
  de ser necessária (ADR 0008). O teste `mede_o_wgc_de_uma_janela` fica em
  `legacy/screen_share/windows.rs` até a Etapa 4.4, junto com o `windows-capture`; é a única forma de
  repetir a comparação com o WGC direto.

  Limitações: as rodadas do libwebrtc e do WGC direto foram feitas uma depois da outra, não ao mesmo
  tempo; falta medir um jogo de verdade. A falha de 0,31 s no primeiro teste de tela 4K não se repetiu
  em 3 execuções e a causa não foi identificada. Os logs de tempo por etapa (`capture_frame` e
  conversão, target `perf`) foram usados nessa medição e depois removidos do código; estão no commit
  `d418b00` (`video_capture.rs`), caso seja preciso repetir.
- Miniaturas no seletor de fontes. Enquanto isso, o seletor mostra só ícones. Pontos do código de preview
  do protótipo a corrigir quando voltarem ao escopo: previews enviados como `Vec<u8>` em JSON e uma
  sessão WGC aberta por janela.
- Aviso de possível conteúdo protegido (frames totalmente pretos por vários segundos).
- Suporte a Linux (risco principal: WebRTC no WebKitGTK) e versão web.
- Qualquer funcionalidade nova de voz além do que já existe.
