# Plano — v0.1: reorganização e correções do compartilhamento de tela

Este plano cobre a reorganização do protótipo e as correções das revisões, **antes** do publicador nativo
em Rust. O publicador e a medição comparativa ficam para um plano seguinte, que vai se encaixar na
estrutura criada aqui. As versões seguem a numeração do `README.md` (v0.1, v0.2...).

**Objetivo desta fase:** o app faz exatamente o que faz hoje, mas organizado, sem os vazamentos e bugs
encontrados, e pronto para receber uma segunda implementação de compartilhamento sem mexer no resto.

**Fora do escopo:** publicador nativo, mudanças no backend, miniaturas no seletor de fontes, qualquer
funcionalidade nova de voz, e suporte a Linux e web (ver decisão 14 para os cuidados já adotados).

## Progresso

| Etapa | Descrição | Status |
|---|---|---|
| 1 | Preparação | Concluída |
| 2 | Esqueleto do Rust | Concluída |
| 3 | Captura desacoplada do destino | Em andamento (passos 0 a 9 concluídos) |
| 4 | Contrato entre Rust e React | Pendente |
| 5 | Frontend | Pendente |
| 6 | Verificação | Pendente |

---

## Decisões

### 1. Pipeline de vídeo único com `DesktopCapturer` — confirmada

O caminho `windows_capture`/WGC (`ScreenShareVideoCapture`, `WindowPreviewCapture`) e os comandos
`test_*`/`StageTimings` são removidos quando o código legado sair (Etapas 4 e 5).

**Teste de correção: passou.**
- Janela do Chrome com vídeo: capturada normalmente.
- Janela parada (bloco de notas): os frames continuam chegando (~43 fps no caminho IPC, em dev). O
  `DesktopCapturer` funciona por demanda e devolve a imagem atual a cada `capture_frame`, então o
  espectador que entra durante uma tela parada não fica no preto. O reenvio do último frame vira
  proteção opcional, não obrigatória.
- Jogo: capturado corretamente. O fps caiu para ~18–20 (quedas até 10), em dev. **Investigação de
  desempenho pendente**, a ser feita com o profiling por etapa (target `perf`), em build de release.

**Conteúdo com DRM** (HBO, Netflix etc.) aparece preto por proteção do próprio Windows, em qualquer
método de captura. Não é bug e não deve ser contornado. Melhoria futura: avisar quem compartilha quando
a captura entregar frames totalmente pretos por alguns segundos.

**Por que o teste inicial favoreceu o `DesktopCapturer`:** não foi uma limitação do WGC em si, e sim um
pipeline contra outro. O caminho WGC lia `frame.buffer()` (cópia GPU→memória) em toda chegada de frame
na taxa do monitor, fazia duas cópias em resolução cheia por frame (inclusive dos descartados) e mandava
RGBA pelo IPC (~3,7 MB/frame a 720p, contra ~1,4 MB em I420). Se o `DesktopCapturer` um dia falhar, um
WGC ajustado (leitura só dos frames aceitos, envio em I420) volta a ser opção real.

**Janelas pelo WGC do libwebrtc, telas no DXGI (passo 9, ADR 0008).** A captura de janelas caía no GDI
(~14 fps numa janela 4K) porque a thread de captura não tinha COM, e o libwebrtc só escolhe o WGC com COM.
Hoje a thread de captura de janela inicializa o COM; a de tela não, para seguir no DXGI. A captura própria
com a `windows-capture`, que esta decisão deixava como alternativa, não foi necessária.

### 2. Listagem de fontes vem do `DesktopCapturer`

O `DesktopCapturer` é a fonte da verdade de **quais fontes existem e quais são seus ids**. A plataforma
só complementa cada item (PID, ícone, geometria do monitor). Com isso, toda fonte listada é capturável,
e a listagem em si é código compartilhado (o `DesktopCapturer` também existe no Linux). `EnumWindows`
sai do projeto.

Ids de monitor: o libwebrtc identifica telas pelo índice do `EnumDisplayDevicesW`, não pelo `HMONITOR`.
O mapeamento é feito pelo nome do dispositivo (`\\.\DISPLAY1`).

`list_capture_sources` bloqueia (enumeração e extração de ícones) e é chamada dentro de
`tauri::async_runtime::spawn_blocking`.

### 3. `AudioMode`

Mora em `media/audio.rs` (compartilhado). O modo `System` não recebe PID do frontend: usa
`std::process::id()` para excluir o próprio app. Formato com tag, fácil de tipar no TypeScript:

```rust
#[derive(Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AudioMode {
    Off,
    Application { process_id: u32 },
    System,
}
```

JSON: `{ "mode": "off" }`, `{ "mode": "application", "processId": 123 }`, `{ "mode": "system" }`.

### 4. `AppError`

Variantes: `SourceNotFound(u64)`, `AlreadySharing`, `VideoCapture(String)`, `AudioCapture(String)`,
`Internal(String)` e `Unsupported(&'static str)`. Serializado como `{ kind, message }`, com o `kind`
vindo de um `match` explícito (sem `_`, para o compilador obrigar a tratar variantes novas).

### 5. Threads de captura: `spawn_capture`

Toda captura (áudio, vídeo, e futuras versões de outras plataformas) usa `media::spawn_capture`, que:
- cria a thread com nome;
- bloqueia até o corpo chamar `ctx.ready.ok()` ou `ctx.ready.fail(erro)` (canal da biblioteca padrão;
  o `tokio` não é necessário);
- garante, via `EndGuard`, que o `on_end` seja chamado **exatamente uma vez** e **só se a captura
  iniciou**, inclusive em caso de panic.

`CaptureHandle` tem `request_stop()` (não bloqueia, seguro de qualquer lugar) e `stop_and_join()`
(bloqueia). `spawn_capture` e `stop_and_join` só podem ser chamados dentro de `spawn_blocking`, e
`stop_and_join` **nunca** a partir da própria thread de captura.

### 6. Início de sessão atômico

O comando de início aguarda a inicialização do vídeo e, se ligado, do áudio antes de responder. Se um
falhar, o que já subiu é parado e o erro é retornado. O JavaScript nunca vê uma sessão pela metade.

### 7. Falha de áudio não derruba o vídeo

Só o fim da captura de **vídeo** encerra a sessão e emite `screen-share-ended`. Se o áudio cair sozinho,
o handle de áudio é descartado e o evento `screen-share-audio-ended` é emitido; o frontend despublica a
trilha de áudio e avisa o usuário. Observação: quando o processo alvo fecha, o process loopback pode
simplesmente parar de entregar pacotes sem erro; nesse caso o evento nunca dispara, o que é aceitável.

### 8. Encerramento da sessão por eventos

Os `on_end` das capturas não encerram nada diretamente (evita a thread fazer join em si mesma). Eles
mandam um `SessionEvent` por um canal, e o manager trata:

```rust
pub enum SessionEvent {
    VideoEnded { session_id: u64, reason: EndReason },
    AudioEnded { session_id: u64, reason: EndReason },
}
```

**Regra de emissão:** quem remove a sessão do `Mutex` é quem emite o evento de fim. Se o usuário clicou
em parar, o `screen_share_stop` remove e emite `stopped`; o `VideoEnded` que chega depois não encontra a
sessão (id não bate) e não emite nada.

### 9. Estrutura por plataforma

Código específico do Windows fica em `media/platform/win32/`, atrás de `#[cfg(target_os = "windows")]`.
Em qualquer outro sistema, `media/platform/unsupported.rs` fornece as mesmas funções, retornando valores
padrão ou `AppError::Unsupported`. **Regra:** só os pontos de entrada comuns (`media/sources.rs`,
`media/audio.rs`, `media/video_capture.rs`) chamam `platform::`; o resto do código nunca usa
`platform::win32` diretamente.

A pasta se chama `win32` (e não `windows`) para evitar conflito de nome com a crate `windows`.

### 10. `windows-sys` e guards RAII

As declarações FFI escritas à mão foram substituídas pela `windows-sys`. Recursos GDI são embrulhados em
guards (`ScreenDc`, `GdiObject`) que se liberam no `Drop`, eliminando a limpeza manual e o risco de
vazar objetos GDI (limite de 10 mil por processo). Um teste verifica que criar e soltar mil bitmaps não
altera a contagem de objetos GDI do processo.

### 11. Ícones

Ícones são dado estático de identificação da fonte (não miniatura ao vivo) e ficam em
`platform/win32/sources/icon.rs`. Obtidos com `SendMessageTimeoutW` (`SMTO_ABORTIFHUNG`, 50 ms) para não
travar em janelas que não respondem, com correção do alfa para ícones antigos. Enviados ao frontend como
data URL em PNG.

### 12. Sinks e captura independentes

- `VideoSink::push` recebe `&CapturedFrame`, permitindo reenviar o último frame e, no futuro, um
  `TeeSink` (publicador + preview) sem cópia.
- A captura de vídeo não depende do `ScreenShareManager`: previews rodam em paralelo com a sessão e
  entre si.

### 13. `FrameGate` e ACKs

O decremento do `FrameGate` para no zero (um ACK duplicado não fecha o portão para sempre). O
`ipc_screen_share_ack` ignora silenciosamente ids que não são da sessão atual, já que frames em trânsito
de uma sessão encerrada ainda geram ACKs.

### 14. Linux e web: fora do escopo, com cuidados

- Código do Windows isolado (decisão 9).
- `src/lib/tauri/commands.ts` é o único arquivo que importa `@tauri-apps/api` (regra de lint). A versão
  web, se existir, troca a implementação do `ScreenShareController` (por `getDisplayMedia`), usando
  `isTauri()`.
- O seletor de fontes deve ser escrito sabendo que, em algumas plataformas (Wayland), quem mostra o
  seletor é o sistema. Um comando de capacidades por plataforma entra mais adiante.
- Risco conhecido do Linux: o WebKitGTK tem suporte fraco a WebRTC, o que pode inviabilizar a voz no
  React nessa plataforma. Testar cedo quando houver uma máquina Linux disponível.

### 15. `tauri-specta` adiado

O caminho IPC usa `Channel<InvokeResponseBody>`, e não há certeza de suporte no specta. Enquanto isso,
`commands.ts` tem wrappers tipados à mão. Quando o caminho IPC for removido, trocar pelos bindings
gerados.

### 16. Presets de qualidade

O compartilhamento oferece três presets, nomeados pelo uso na interface:

| Preset | Valor no contrato | Caixa máxima | fps | Bitrate inicial | Dica ao encoder |
|---|---|---|---|---|---|
| Movimento | `720p60` | 1280×720 | 60 | 3 a 4 Mbps | `contentHint "motion"`, `maintain-framerate` |
| Equilibrado | `900p60` | 1600×900 | 60 | 4 a 5 Mbps | `contentHint "motion"`, `maintain-framerate` |
| Nitidez | `1080p30` | 1920×1080 | 30 | 4 a 5 Mbps | `contentHint "detail"`, `maintain-resolution` |

- A imagem é reduzida para caber na **caixa** do preset (largura e altura), mantendo a proporção, e
  nunca é ampliada. Janelas de proporção livre (altas e estreitas, por exemplo) também respeitam o limite.
- A dica ao encoder define o que é sacrificado quando a banda aperta: nos presets de 60 fps cai a
  resolução, no de 1080p30 cai o fps e o texto continua legível.
- Os bitrates são pontos de partida, a ajustar depois de testes reais.
- **Teto do ACK no caminho IPC:** com no máximo N frames em trânsito, o fps máximo é N dividido pelo tempo
  de ida e volta de um frame. Os ~43 fps medidos com N = 3 indicam ~70 ms de ida e volta (em dev). Para
  sustentar 60 fps, o tempo precisa cair para menos de 50 ms ou N precisa subir; por isso o limite do
  `FrameGate` faz parte da configuração de cada preset.
- 1080p60 e resoluções acima (4K) ficam fora desta versão. Dependem do publicador nativo com encoder por
  hardware (ver ADR 0007) e pesam no plano gratuito do LiveKit Cloud.

---

## Etapa 1: preparação — concluída

- Commit, tag `prototipo-v0`, push. O trabalho seguiu na branch `dev-screen-share`; a branch `marco-0` prevista aqui não chegou a ser criada.
- `NOTES.md` na raiz com os problemas conhecidos do protótipo, usado como lista de verificação.

## Etapa 2: esqueleto do Rust — concluída

- Código do protótipo movido, sem mudanças de lógica, para `src-tauri/src/legacy/`. Continua sendo o
  que o app usa até as Etapas 4 e 5.
- `error.rs` com `AppError` e teste de serialização.
- `tracing` inicializado com `EnvFilter` (padrão `info,<crate>=debug` em dev), hook de panic que registra
  o nome da thread, e threads nomeadas. Métricas de desempenho no target `perf`
  (`RUST_LOG=info,perf=debug`), com campos estruturados.
- Nenhum `println!`/`eprintln!` no código.
- `src/lib/tauri/commands.ts` com `AppError`, `isAppError` e wrappers para os comandos legados; regra de
  lint proibindo `invoke` fora dele.
- Dependências enxutas: `hound` removido, `image` só com PNG e JPEG.

**Lembrete de medição:** números de desempenho só valem em build de release; em dev o código próprio
roda sem otimização.

## Etapa 3: captura desacoplada do destino — em andamento

A captura não pode saber se os dados vão para o IPC ou para o LiveKit.

### Árvore

```
src-tauri/src/media/
├── mod.rs              # só declarações e reexportações
├── sink.rs             # CapturedFrame, SinkStatus, VideoSink, AudioSink, constantes de áudio
├── gate.rs             # FrameGate
├── capture.rs          # EndReason, OnEnd, EndGuard, CaptureHandle, CaptureContext, ReadySignal, spawn_capture
├── sources.rs          # tipos das fontes + list_capture_sources
├── audio.rs            # AudioMode + entrada comum da captura de áudio
├── diagnostics.rs      # sinks de diagnóstico
├── video_capture.rs
├── ipc_sink.rs         # temporário
├── session.rs
└── platform/
    ├── mod.rs
    ├── unsupported.rs
    └── win32/
        ├── mod.rs
        ├── audio_capture.rs
        ├── window_capture.rs  # COM da thread de janela + estado da janela (ADR 0008)
        └── sources/
            ├── mod.rs
            ├── gdi.rs
            ├── icon.rs
            ├── window.rs
            ├── monitor.rs
            └── thumbnail.rs   # vazio até as miniaturas entrarem no escopo
```

### Passo 0: validar o `DesktopCapturer` — concluído

Ver decisão 1.

### Passo 1: estrutura por plataforma — concluído

Ver decisão 9.

### Passo 2: tipos compartilhados — concluído

`sink.rs`, `gate.rs` e `capture.rs`, reexportados pelo `media/mod.rs`. Testes:
1. `FrameGate` fecha no máximo, reabre com `release`, e um `release` extra não o deixa fechado.
2. `spawn_capture` normal: `stop_and_join` faz o `on_end` receber `Stopped`.
3. Corpo que chama `fail()`: retorna o erro e o `on_end` não é chamado.
4. Panic depois do `ok()`: o `on_end` recebe `Error`.
5. Panic antes do `ok()`: retorna `Internal` e o `on_end` não é chamado.

### Passo 3: listagem de fontes — concluído

Tipos em `media/sources.rs`:

```rust
#[serde(tag = "kind", content = "id", rename_all = "camelCase")]
pub enum SourceRef { Window(u64), Monitor(u64) }   // { "kind": "window", "id": 123 }

pub struct CaptureSource {
    pub source: SourceRef,
    pub title: String,
    pub process_id: Option<u32>,
    pub icon: Option<String>,          // data URL
    pub monitor: Option<MonitorInfo>,  // x, y, width, height, is_primary
}
```

A plataforma fornece `window_details(id) -> Option<WindowDetails>` (`None` esconde a janela; usado para
as janelas do próprio app) e `monitor_details(id) -> Option<MonitorInfo>`. Telas recebem títulos como
"Tela 1 (principal)".

Testes ignorados (precisam de área de trabalho real; rodar com `-- --ignored --nocapture`): ícone da
janela em foco, detalhes da janela em foco, mapeamento das telas do capturer e listagem completa.

**Pendente:** confirmar o mapeamento de monitores com dois monitores conectados, se ainda não foi feito.
A exclusão das janelas do próprio app só pode ser verificada na Etapa 4, com o app rodando.

### Passo 4: sinks de diagnóstico — concluído

Em `media/diagnostics.rs`: `LogVideoSink` registra fps, resolução e os intervalos entre frames (máximo
da janela, e contagem cumulativa acima de 20/34/50 ms — a média de fps sozinha esconde travadas
pontuais); `LogAudioSink` registra a taxa real de amostras e o nível do sinal (RMS e pico, em dBFS).
Ambos no target `perf`, um relatório por segundo. Servem para testar cada captura isoladamente, sem IPC
nem LiveKit no meio; se a captura parar de entregar, os logs param, o que já é o sinal de travamento.

Testes: contagem cumulativa dos intervalos (um gap de 60 ms conta nos três limites), `mem::take` zera
as estatísticas do relatório anterior, conversão linear → dBFS (piso de -100 dB pro silêncio), e o sink
de áudio nunca devolve `Stop`.

### Passo 5: captura de áudio — concluído

- Entrada comum em `media/audio.rs`, que escolhe a implementação da plataforma; implementação WASAPI em
  `platform/win32/audio_capture.rs`; versão em `unsupported.rs` retornando `Unsupported`.
- Construída sobre `spawn_capture`.
- Modo por eventos (não polling), buffer de 100 ms, formato f32 estéreo 48 kHz.
- Flag de silêncio tratada (zerar o buffer); descontinuidade registrada em log.
- Modo `System` com `std::process::id()` (decisão 3).

Testes automáticos: `Off` não inicia nada nem chama o `on_end`, o próprio PID é recusado, e o JSON do
frontend (`off`/`application`/`system`) é lido corretamente.

Validado manualmente com áudio real, pelos testes ignorados de `media/audio.rs` e o `LogAudioSink`
(precisam de áudio tocando; rodar com `-- --ignored --nocapture`):
`cargo test --lib media::audio -- --ignored --nocapture captura_o_sistema` e, para um aplicativo,
`CAPTURE_PID=<pid> cargo test --lib media::audio -- --ignored --nocapture captura_um_aplicativo`.

### Passo 6: `video_capture.rs` — concluído

- `VideoCaptureConfig { source: SourceRef, max_width: u32, max_height: u32, fps: u32 }`, preenchido a
  partir do preset (decisão 16).
- Construída sobre `spawn_capture`; `DesktopCapturer` criado dentro da thread. Fonte inexistente falha
  com `SourceNotFound` na inicialização.
- Controle de taxa por deadline (sem acumular atraso), respeitando o `FrameGate` quando houver.
- Conversão para I420 usando o stride do frame; redução com o `scale` do I420 quando passar de
  a caixa `max_width` × `max_height`, sem nunca ampliar; proteção para janelas muito pequenas;
  dimensões pares.
- Timestamps a partir de `Instant` (não `SystemTime`).
- **Fonte fechada:** 1 s de falhas seguidas dispara a conferência na lista de fontes do capturer; se a
  fonte sumiu, encerra com `SourceClosed`. Se ainda está lá (janela minimizada), a captura continua e a
  conferência se repete a cada 1 s. (Critério mudou em relação ao plano inicial, de ~30 erros
  consecutivos, porque contar erros não distingue janela fechada de janela minimizada.)
- Reenvio do último frame após 500 ms sem novidade, respeitando o `FrameGate`.

Testes automáticos: `fit_in_box` (reduz, nunca amplia, lados pares e nunca zero), validação da
configuração e intervalo entre frames. Testes ignorados (precisam de área de trabalho real): fonte
inexistente falha na inicialização, tela principal por 10 s, e `captura_uma_tela`/`captura_uma_janela`
(`CAPTURE_MONITOR`/`CAPTURE_WINDOW`; `CAPTURE_FPS` opcional). Validado à mão: tela a 60 fps; fechar a
janela no meio da captura encerra a captura (o motivo exato impresso não foi conferido). O desempenho com janelas grandes ficou
abaixo de 60 fps; as medições estão no `NOTES.md`.

### Passo 7: `ipc_sink.rs` — concluído

- `IpcVideoSink`: empacotamento I420 atual, envio com `InvokeResponseBody::Raw`, `FrameGate` para o ACK.
- `IpcAudioSink`: envio dos f32 com `InvokeResponseBody::Raw` (corrige o envio atual em JSON).

**Formato das mensagens** (little-endian). Vídeo: cabeçalho de 16 bytes (`width: u32`, `height: u32`,
`timestamp_us: i64`, relativo ao início da captura), seguido dos planos Y, U e V colados, sem o padding do
stride. Áudio: só as amostras f32 intercaladas (estéreo, 48 kHz). **O cabeçalho de vídeo mudou em relação
ao legado:** eram 24 bytes (`width`, `height`, `capture_timestamp`, `send_timestamp`), agora são 16, sem o
`send_timestamp`. O `IpcScreenShare` (Etapa 5) precisa decodificar o formato novo.

Cada frame enviado ocupa uma vaga do `FrameGate` até o ACK (o `enter` vem antes do `send`, e a vaga volta
se o envio falhar); com o portão fechado o frame é descartado antes de ser empacotado. Um envio que falha
(webview fechado) devolve `Stop`. Testes: empacotamento sem o padding do stride, tamanho e capacidade exatos
da mensagem, vaga do portão (ocupa, fecha, reabre com o ACK, volta se o envio falha) e áudio (uma mensagem
por pacote, pacote vazio ignorado). Teste ignorado que precisa de áudio tocando:
`captura_o_sistema_pelo_ipc`. A verificação de ponta a ponta, com o webview de verdade, é na Etapa 4.

### Passo 8: `session.rs` — concluído

Um `ScreenShareManager` substitui `ScreenShareTestState` e `ScreenShareAudioState`:

```rust
struct Session {
    id: u64,
    video: CaptureHandle,
    audio: Option<CaptureHandle>,
}

struct AckGate {            // guardado à parte, num Mutex próprio
    session_id: u64,
    gate: FrameGate,
}
```

O portão do ACK fica fora da `Session`, num `Mutex` próprio, para o `ack` não esperar o lock do estado,
que o início da sessão segura durante a inicialização das capturas (medido: com um início de 600 ms, o
`ack` esperava 500 ms; isso pararia uma thread do runtime async). Ordem dos locks: estado primeiro, depois
o do ACK, nunca o contrário. Um `try_lock` foi descartado porque descartaria ACKs da sessão atual quando
houvesse disputa com o `stop`, e o `FrameGate` perderia uma vaga para sempre.

- Início atômico (decisão 6), dentro de `spawn_blocking`: se o áudio falha, o vídeo já iniciado é parado.
- Encerramento por `SessionEvent` e regra de emissão (decisão 8): quem remove a sessão avisa, e só uma vez.
- Política de falha do áudio (decisão 7): o fim do áudio sozinho não derruba o vídeo.
- Parar: remover a sessão, emitir o evento e fazer `stop_and_join` dos handles em `spawn_blocking`.
  Idempotente; pedidos de parada e ACKs de sessões antigas são ignorados (decisão 13).
- O manager não conhece o Tauri: avisa pelo `on_event` que recebeu no `new`, com um `ShareEvent`
  (`Ended { session_id, reason }` ou `AudioEnded { session_id, reason }`), e os comandos da Etapa 4
  transformam isso em `screen-share-ended` e `screen-share-audio-ended`.
- `Drop` no manager: solta a sessão ativa (os handles só pedem a parada, sem bloquear). Sem isso a
  `Session` ficaria presa no estado compartilhado que a thread de eventos segura, e as capturas nunca
  parariam. Não emite eventos.

Testes (com uma captura falsa sobre o `spawn_capture` de verdade): início e parada, início duplo recusado,
falha do áudio desfaz o vídeo, falha do vídeo não deixa sessão, parada e ACK de sessão antiga ignorados,
fim do vídeo encerra a sessão, queda do áudio mantém o vídeo, `ack` não espera um início lento, soltar o
manager para as capturas, e o portão do ACK (só a própria sessão o apaga; iniciar sem portão apaga o
antigo). A verificação de ponta a ponta, com o app, é na Etapa 4.

### Passo 9: janelas pelo WGC do libwebrtc — concluído

Descoberto durante a medição do Passo 6 (`NOTES.md`): a captura de janelas do `DesktopCapturer` caía no
GDI (~14 fps numa janela 4K) porque a thread de captura não tinha COM, e o libwebrtc só escolhe o WGC se
`IsWgcSupported` passar, o que exige COM (ADR 0008).

- `platform::prepare_window_capture_thread`: inicializa o COM (MTA) na thread de captura **só para
  janelas**; telas ficam sem COM, no DXGI (a tela 4K cairia de 54–60 para 43–50 fps com o WGC).
- `platform::window_state`: `IsWindow`/`IsIconic`, conferido a cada volta do laço. Com o WGC o fim da
  janela não gera erro, então sem isso o `SourceClosed` deixava de disparar. Janela que sumiu encerra a
  captura; minimizada não chama o `capture_frame` e reenvia o último frame.
- Implementados em `platform/win32/window_capture.rs`; em `unsupported.rs` ficam como no-op e `Visible`.

Testes: `janela_invalida_nao_existe` (automático) e `janela_em_foco_esta_visivel` (ignorado, precisa de área
de trabalho real). Não há teste automático da escolha do capturer: o Rust não expõe qual foi instanciado.
Validado à mão, em release: janela 4K do Brave de ~14 para ~46–52 fps (chegou a 60 com a imagem estável);
tela 4K a 60 fps; janela fechada encerra com `SourceClosed`; janela minimizada cai para ~2 fps (reenvios) e
volta a 60 ao restaurar, sem nenhum `WARN`.

### Critério de pronto da Etapa 3

- Passos 4 a 6 validados com os sinks de diagnóstico.
- Ciclo de vida da sessão validado com um comando temporário de teste, se desejado; a verificação de
  ponta a ponta acontece na Etapa 4.
- O app continua funcionando pelo `legacy/`.

## Etapa 4: contrato entre Rust e React — pendente

### 4.1 Comandos (`commands/screen_share.rs`, todos `async`)

```rust
list_capture_sources() -> Result<Vec<CaptureSource>, AppError>
ipc_screen_share_start(options: StartOptions, video: Channel<InvokeResponseBody>, audio: Channel<InvokeResponseBody>) -> Result<u64, AppError>
ipc_screen_share_ack(session_id: u64)
screen_share_stop(session_id: u64) -> Result<(), AppError>
```

O prefixo `ipc_` marca o que é específico do caminho atual. `screen_share_stop` e os eventos servirão
também ao publicador nativo. `StartOptions`:

```json
{
  "source": { "kind": "window", "id": 123 },
  "quality": "720p60",
  "audio": { "mode": "application", "processId": 456 }
}
```

`quality` é `720p60`, `900p60` ou `1080p30` (decisão 16). O Rust mapeia o valor para a caixa máxima, o
fps e o limite do `FrameGate`; o frontend mapeia para o bitrate e as dicas ao encoder.

### 4.2 Eventos

- `screen-share-ended`: `{ sessionId, reason, message }`, com `reason` = `stopped` | `sourceClosed` |
  `error`.
- `screen-share-audio-ended`: `{ sessionId, reason, message }` (decisão 7).

### 4.3 `commands.ts`

Wrappers para os comandos novos, tipos `CaptureSource`, `SourceRef`, `StartOptions` e `AudioMode`, e
funções `onScreenShareEnded(callback)` e `onScreenShareAudioEnded(callback)` que retornam a função de
cancelar a escuta. Adicionar `"Unsupported"` e `"Internal"` ao `AppErrorKind`, se ainda não estiverem.

### 4.4 Remoção do legado

Os comandos e o código de `legacy/` saem quando o `IpcScreenShare` (Etapa 5) estiver usando os comandos
novos. Junto saem as dependências `windows-capture` e `fast_image_resize`.

**Exceção:** a medição do WGC direto (crate `windows-capture`) já foi feita e está no `NOTES.md`, no item
da queda de fps em janelas. O teste `mede_o_wgc_de_uma_janela`, em `legacy/screen_share/windows.rs`, é a
única forma de repetir essa comparação; ele e a dependência `windows-capture` saem junto com o
`legacy/`, a não ser que o plano do publicador nativo decida usá-los como base de uma captura própria
de janelas. Nesse caso, mantê-los.

## Etapa 5: frontend — pendente

### 5.1 Estrutura

```
src/features/
├── voice/
│   ├── VoiceProvider.tsx
│   └── useVoice.ts
└── screen-share/
    ├── controller.ts          # interface ScreenShareController e ScreenShareState
    ├── ipc/
    │   ├── IpcScreenShare.ts
    │   ├── ScreenShareAudio.ts
    │   └── jitter-buffer.worklet.js
    └── SourcePicker.tsx
```

### 5.2 Contrato

```ts
export type ScreenShareState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "active"; sessionId: number; source: CaptureSource }
  | { status: "error"; kind: string; message: string };
```

`ScreenShareController` com `listSources`, `start`, `stop`, `onStateChange` e `dispose()`. O provider
chama `dispose()` quando a sala cai ou o usuário troca de canal.

### 5.3 `IpcScreenShare`

Recebe o `Room`; concentra o generator, o `ScreenShareAudio`, os ACKs, a escuta dos dois eventos e o
teardown. Correções: `videoEncoding`, `contentHint` e `degradationPreference` de acordo com o preset
(decisão 16);
`AudioPresets.musicHighQualityStereo` e `dtx: false` no áudio; sem cópia extra no handler de frame;
proteção contra início duplo; ao receber `screen-share-audio-ended`, despublicar a trilha de áudio.

### 5.4 Worklet

Jitter buffer: ring buffer pré-alocado de 1 segundo, estado "acumulando" até 50 ms (2.400 frames),
silêncio e volta ao acúmulo quando esvaziar, descarte das amostras mais antigas ao passar de 150 ms.
Nenhuma alocação dentro do `process()`.

### 5.5 `VoiceProvider` enxuto

Só conexão, mute e deafen; expõe o controller. `RoomAudioRenderer` com `muted={isDeafened}` e
restauração do mute anterior ao sair do deafen; tratamento de `Reconnecting`/`Reconnected`;
`controller.dispose()` no cleanup do efeito e no `Disconnected`; árvore envolvida por `RoomContext`.

### 5.6 `SourcePicker`

Lista sem miniaturas, telas e janelas separadas (a aba de telas mostra a disposição física dos monitores,
a partir do `MonitorInfo`), com os ícones vindos do Rust; os três presets de qualidade nomeados pelo uso,
com a descrição do selecionado; e a escolha de áudio. Escrito sabendo que, em algumas plataformas, o
seletor será do sistema (decisão 14). O desenho de referência está no canvas de telas.

## Etapa 6: verificação — pendente

1. Iniciar e parar o compartilhamento 20 vezes seguidas, inclusive clicando rápido; a memória do app
   volta ao patamar inicial.
2. Trocar de canal de voz durante um compartilhamento; a captura para e nenhum log de frame continua.
3. Desligar a rede por 30 segundos durante um compartilhamento e religar; a UI mostra a reconexão e o
   compartilhamento volta ou é encerrado de forma limpa.
4. Fechar a janela compartilhada; o evento `sourceClosed` chega e a UI volta a `idle`.
5. Fechar o programa cujo áudio está sendo capturado; o vídeo continua. Registrar o comportamento real
   do áudio (evento de fim ou só silêncio).
6. Deafen e alguém novo entra no canal: não deve ser ouvido. Mute, deafen, undeafen: o microfone
   continua mutado.
7. As janelas do próprio app não aparecem no seletor.
8. Compartilhar um jogo por duas horas com o app minimizado, com alguém assistindo, em build de release;
   anotar CPU, memória e picotes, separadamente para os três presets. Registrar fps, maior intervalo
   entre frames e quantos intervalos passaram de 20, 34 e 50 ms, não só a média. Antes, confirmar a
   taxa real da fonte (um vídeo a 30 fps nunca vai medir 60). É a linha de base do plano seguinte.

**Critério de pronto da fase:** todos os itens do `NOTES.md` resolvidos ou conscientemente adiados, a
lista acima passando, e o provider sem nenhuma referência direta a generator, worklet ou comandos de
captura.

---

## Registro de desempenho

| Cenário | Build | Resultado | Observação |
|---|---|---|---|
| Janela parada, caminho IPC | dev | ~43 fps | Limitado pela ida e volta do ACK; sem controle de taxa |
| Jogo, caminho IPC | dev | ~18–20 fps, quedas até 10 | Investigação pendente com o target `perf` |

## Próximos passos (fora deste plano)

- Publicador nativo em Rust (conexão `{user_id}:screen`) e medição lado a lado com o caminho IPC.
- Investigação do fps com jogos (tempo do `capture_frame`, conversão, IPC).
- Miniaturas no seletor: `get_source_thumbnail` por pedido (cards visíveis, concorrência limitada,
  atualização a cada 3 s, data URL); preview ao vivo da fonte selecionada via `PreviewSink` (480 px,
  5 fps, desenhado num canvas).
- Aviso de possível conteúdo protegido (frames pretos por vários segundos).
- Comando de capacidades por plataforma.
- Teste do `livekit-client` no WebKitGTK (Linux).
- Troca do `commands.ts` pelos bindings do `tauri-specta`, após remover o caminho IPC.
