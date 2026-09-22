# Plano — Marco 0: reorganização e correções do protótipo de screen share

Este plano cobre as etapas 1 a 4 da ordem combinada: preparar o projeto, definir o contrato e mover o
caminho atual (IPC) para trás dele, já com as correções das revisões. O publicador em Rust e a medição
ficam para o plano seguinte, que vai se encaixar na estrutura criada aqui.

**Objetivo desta fase:** o app faz exatamente o que faz hoje, mas organizado, sem os vazamentos e bugs
que encontramos, e pronto para receber uma segunda implementação de compartilhamento sem mexer no resto.

**Fora do escopo:** publicador nativo, mudanças no backend, miniaturas no seletor de fontes e qualquer
funcionalidade nova de voz.

## Decisões tomadas nesta fase

1. **Pipeline de vídeo único:** consolidar em `DesktopCapturer` (LiveKit). O caminho `windows_capture`/WGC
   (`ScreenShareVideoCapture`, `WindowPreviewCapture`) e os comandos `test_*`/`StageTimings` são removidos.
   Evita manter dois caminhos de captura redundantes e já deixa a base pronta para o publicador nativo do
   próximo plano.

   **Por que o teste favoreceu o `DesktopCapturer`:** não foi uma limitação do WGC em si, foi um pipeline
   contra outro. O caminho WGC lia `frame.buffer()` (cópia GPU→memória, a etapa cara) em toda chegada de
   frame na taxa do monitor, fazia duas cópias em resolução cheia por frame — inclusive dos descartados —
   e mandava RGBA pelo IPC (~3.7 MB/frame a 720p). O caminho `DesktopCapturer` só lê sob demanda via
   `capture_frame` (chamado apenas quando há espaço no `in_flight`) e manda I420 (~1.4 MB/frame), menos
   de metade do payload, sendo o IPC o gargalo desse caminho. Isso está registrado no `NOTES.md`: se o
   `DesktopCapturer` falhar no teste de correção abaixo, um WGC ajustado (leitura só dos frames aceitos,
   envio em I420) volta a ser uma opção real — não foi descartado por ser pior tecnicamente.

   **Teste de correção obrigatório antes de construir o publicador em cima do `DesktopCapturer`** (o maior
   risco aqui é correção, não desempenho — se usar GDI internamente para janelas, jogos DirectX e janelas
   aceleradas por hardware podem sair pretos ou congelados):
   1. Compartilhar um jogo em modo janela e, se possível, em tela cheia sem borda.
   2. Compartilhar uma janela do Chrome ou de um app Electron com vídeo rodando.
   3. Compartilhar uma janela parada (bloco de notas) por um minuto e checar se as estatísticas de captura
      continuam mostrando frames por segundo. Se não mostrarem, implementar reenvio do último frame para
      quem começa a assistir não ver preto.

   Só considerar a decisão 1 confirmada de vez depois que os três passarem.
2. **`list_capture_sources` roda a enumeração (FFI síncrona: `EnumWindows`, `EnumDisplayMonitors`,
   extração de ícone via GDI) dentro de `tauri::async_runtime::spawn_blocking`**, mesmo sendo um comando
   `async fn`, para não bloquear o runtime.
3. **Modo de áudio `System` não recebe mais `process_id` do frontend.** Usa `std::process::id()`
   internamente para excluir o próprio processo do app. `AudioMode` no contrato vira
   `Off | Application(u32) | System` (sem payload em `System`).
4. **`AppError` serializa `kind` via match explícito**, não via `Debug` + `split('(')`:
   ```rust
   fn kind(&self) -> &'static str {
       match self {
           Self::SourceNotFound(_) => "SourceNotFound",
           Self::AlreadySharing => "AlreadySharing",
           Self::VideoCapture(_) => "VideoCapture",
           Self::AudioCapture(_) => "AudioCapture",
       }
   }
   ```
5. **`CaptureHandle::stop_and_join` só pode ser chamado de dentro de `spawn_blocking`.** Documentado com
   `///` no próprio método; `session.rs` sempre chama assim, nunca direto de uma `async fn`.
6. **Início de sessão é atômico e bloqueante do ponto de vista do comando:** `ipc_screen_share_start`
   aguarda os oneshots de inicialização de vídeo e (se ligado) áudio antes de responder. Se um falhar,
   o que já subiu é parado com `stop_and_join` e o erro é retornado — o JavaScript nunca vê uma sessão
   pela metade.
7. **Falha de áudio não derruba o vídeo.** Só o `on_end` da captura de vídeo encerra a sessão e emite
   `screen-share-ended`. Se a captura de áudio cair sozinha, o handle de áudio é descartado e um aviso é
   logado/emitido separadamente, mas o vídeo continua.
8. **Ícone da janela (`get_window_icon`) permanece em `media/sources.rs`.** É dado estático de
   identificação da fonte, não miniatura de conteúdo ao vivo — miniaturas seguem fora do escopo.

## Etapa 1: preparação

1. Commit, tag `prototipo-v0`, push e branch `marco-0`.
2. `NOTES.md` na raiz com uma linha por problema conhecido do protótipo (ver arquivo) — lista de
   verificação da Etapa 6.

## Etapa 2: esqueleto do Rust

**2.1 Estrutura de módulos** (arquivos já criados, vazios, em `desktop/src-tauri/src/`):

```
src-tauri/src/
├── main.rs
├── error.rs
├── commands/
│   ├── mod.rs
│   └── screen_share.rs
└── media/
    ├── mod.rs            # tipos compartilhados: CapturedFrame, sinks, CaptureHandle
    ├── sources.rs        # listagem de janelas e monitores
    ├── video_capture.rs
    ├── audio_capture.rs
    ├── session.rs        # ScreenShareManager
    └── ipc_sink.rs       # caminho IPC, temporário
```

**2.2 Tipo de erro único.** Todos os comandos retornam `Result<T, AppError>`, serializado com campo
`kind` (ver decisão 4):

```rust
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("fonte de captura não encontrada: {0}")]
    SourceNotFound(u64),
    #[error("já existe um compartilhamento ativo")]
    AlreadySharing,
    #[error("falha na captura de vídeo: {0}")]
    VideoCapture(String),
    #[error("falha na captura de áudio: {0}")]
    AudioCapture(String),
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}
```

**2.3 Logs com `tracing`.** Inicializar `tracing-subscriber` com `EnvFilter` em `main.rs`; trocar todos
os `println!`/`eprintln!`. Relatórios de profiling (`StageTimings`, estatísticas por segundo) viram
`tracing::debug!`, ligados com `RUST_LOG=seu_app=debug`.

**2.4 Sobre `tauri-specta`.** Adiado: o caminho IPC usa `Channel<InvokeResponseBody>` e não há certeza de
que o specta gera tipos para ele. Como esse caminho é temporário, criar um único arquivo
`src/lib/tauri/commands.ts` com wrappers tipados à mão para cada comando e evento. Nenhum outro arquivo
do frontend chama `invoke` diretamente. Quando o caminho IPC for removido, trocar esse arquivo pelos
bindings gerados é trivial.

**Critério de pronto:** o projeto compila com a estrutura nova, sem `println!` no código, e o app ainda
funciona chamando os comandos antigos.

## Etapa 3: captura desacoplada do destino

Etapa central. A captura não pode saber se os dados vão para o IPC ou para o LiveKit.

**3.1 Tipos compartilhados em `media/mod.rs`:**

```rust
pub struct CapturedFrame {
    pub buffer: I420Buffer,
    pub timestamp_us: i64, // relativo ao início da sessão, via Instant
}

pub enum SinkStatus { Continue, Stop }

pub trait VideoSink: Send + 'static {
    fn push(&mut self, frame: CapturedFrame) -> SinkStatus;
    /// Portão de backpressure. None = sempre aberto.
    fn gate(&self) -> Option<FrameGate> { None }
}

pub trait AudioSink: Send + 'static {
    /// f32 estéreo intercalado a 48 kHz, já zerado se o pacote veio silencioso.
    fn push(&mut self, samples: &[f32]) -> SinkStatus;
}
```

`FrameGate` é um `Arc` em volta do contador de frames em trânsito. O loop de captura pega o gate *antes*
de mover o sink para o callback do `DesktopCapturer`, e consulta o gate para decidir se captura. O
`ipc_sink` devolve um gate (é onde o ACK entra); o publicador nativo não vai precisar de nenhum.

**3.2 `CaptureHandle`,** representa uma thread de captura viva:

```rust
pub struct CaptureHandle {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl CaptureHandle {
    /// Só chamar de dentro de `spawn_blocking` — o join pode levar até ~100 ms
    /// (timeout do evento do WASAPI).
    pub fn stop_and_join(mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(t) = self.thread.take() { let _ = t.join(); }
    }
}

impl Drop for CaptureHandle {
    fn drop(&mut self) { self.stop.store(true, Ordering::Release); }
}
```

`Drop` garante que uma captura esquecida sempre para.

**3.3 `video_capture.rs`.** `spawn_video_capture(config, sink, on_end) -> Result<CaptureHandle, AppError>`:

- `VideoCaptureConfig { source: SourceRef, max_width: u32, fps: u32 }`, `SourceRef` = `Window(u64)` |
  `Monitor(u64)`.
- `DesktopCapturer` criado dentro da thread, resultado devolvido por oneshot (mesmo padrão do áudio). Se
  a fonte não existir, o comando falha na hora com `SourceNotFound`.
- Loop com controle de taxa por deadline, respeitando o gate.
- Conversão para I420 com `frame.stride()`, `scale` quando passar de `max_width`, com proteções para
  janelas pequenas.
- **Fonte fechada:** ~30 erros consecutivos (≈1s) → encerra com motivo `SourceClosed`, em vez de logar
  erro indefinidamente.
- `on_end: Box<dyn FnOnce(EndReason) + Send>` chamado exatamente uma vez ao terminar (stop, erro ou fonte
  fechada).

**3.4 `audio_capture.rs`.** `spawn_audio_capture(mode, sink, on_end)`: modo por eventos, buffer de 100 ms,
flag de silêncio, log de descontinuidade, resultado de inicialização por oneshot, modo `System` usando
`std::process::id()` (decisão 3).

**3.5 `sources.rs`.** `list_capture_sources()` retorna janelas e monitores num formato único, com o PID
do processo (via `GetWindowThreadProcessId`, crate `windows`) já resolvido para janelas:

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSource {
    pub id: u64,
    pub kind: SourceKind,       // Window | Monitor
    pub title: String,
    pub process_id: Option<u32>, // só para janelas
}
```

Executado via `spawn_blocking` a partir do comando (decisão 2).

**Ids de monitor — não usar `HMONITOR` do `EnumDisplayMonitors`.** O `DesktopCapturer` do libwebrtc no
Windows identifica telas pelo índice do `EnumDisplayDevicesW`, não pelo `HMONITOR`. Numa máquina com um
monitor só isso pode funcionar por coincidência e quebrar com dois. Os monitores devem vir do próprio
`DesktopCapturer` (tipo `Screen`, via `get_source_list`), usando as APIs do Windows só para enriquecer os
dados (nome, posição, resolução, principal). Para cruzar o `id()` do libwebrtc com o `HMONITOR`/`szDevice`
do `GetMonitorInfoW`:

```rust
let mut device: DISPLAY_DEVICEW = unsafe { std::mem::zeroed() };
device.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;

if unsafe { EnumDisplayDevicesW(std::ptr::null(), source.id() as u32, &mut device, 0) } != 0 {
    // device.DeviceName == "\\.\DISPLAY1" → compare com o szDevice do MONITORINFOEXW
}
```

Testar com dois monitores conectados, imprimindo as duas listas, para confirmar o mapeamento antes de dar
por certo. Para janelas não há esse problema: os dois lados (libwebrtc e Win32) usam o mesmo HWND.

**Outros ajustes que entram no `sources.rs` nesta fase, independentes do capturer escolhido:**
- `SendMessageTimeoutW` no lugar de `SendMessageW` (evita travar em janelas que não respondem).
- Callback do `EnumWindows` só coleta HWNDs; enriquecimento (título, PID, ícone) é feito depois, fora do
  callback.
- Correção do alfa em ícones antigos (sem canal alpha) na conversão para PNG/data URL.
- Exclusão das janelas do próprio app da listagem.
- Migração das declarações FFI manuais para a crate `windows-sys`, onde fizer sentido.

Pontos sobre previews (JSON no `Channel`, uma sessão WGC por janela) ficam para quando miniaturas
entrarem no escopo — fora desta fase.

**3.6 `session.rs`.** Um único `ScreenShareManager` substitui `ScreenShareTestState` e
`ScreenShareAudioState`. Sessão agrupa vídeo e áudio:

```rust
struct Session {
    id: u64,
    video: CaptureHandle,
    audio: Option<CaptureHandle>,
    gate: Option<FrameGate>,
}
```

Iniciar uma sessão é atômico (decisão 6): se o vídeo sobe e o áudio falha, o vídeo é parado e o comando
retorna o erro. Quando a captura de **vídeo** chama `on_end`, o manager encerra a sessão inteira e emite
o evento de fim. Quando é a captura de **áudio** que chama `on_end` sozinha, o manager só derruba o
handle de áudio e emite um aviso separado — o vídeo continua (decisão 7).

**3.7 `ipc_sink.rs`.** Código de empacotamento atual: `IpcVideoSink` (`pack_i420` + envio via
`InvokeResponseBody::Raw`) e `IpcAudioSink` (envio dos f32 também como `Raw`, corrigindo o problema do
JSON).

**Critério de pronto:** as capturas rodam, param e reportam o fim corretamente num teste manual chamando
os comandos pelo console do webview, e o `DesktopCapturer` passa no teste de correção (jogo em janela/tela
cheia sem borda, Chrome/Electron com vídeo, janela parada por 1 minuto sem perder FPS reportado).

## Etapa 4: contrato entre Rust e React

**4.1 Comandos**, em `commands/screen_share.rs`, todos `async`:

```rust
list_capture_sources() -> Result<Vec<CaptureSource>, AppError>
ipc_screen_share_start(options: StartOptions, video: Channel<InvokeResponseBody>, audio: Channel<InvokeResponseBody>) -> Result<u64, AppError>
ipc_screen_share_ack(session_id: u64)
screen_share_stop(session_id: u64) -> Result<(), AppError>
```

Prefixo `ipc_` marca o que é específico desse caminho. `screen_share_stop` e o evento de fim são comuns
e vão servir também ao publicador nativo. `StartOptions` leva a fonte, a qualidade (`720p30` ou
`1080p60`, mapeadas para `max_width`/`fps` no Rust) e o modo de áudio (`Off | Application(u32) | System`,
decisão 3).

**4.2 Evento** `screen-share-ended` com `{ sessionId, reason, message }`, `reason` = `stopped` |
`sourceClosed` | `error`.

**4.3 Wrappers no `commands.ts`,** um por comando e um `onScreenShareEnded(callback)` que retorna a
função de cancelar a escuta.

## Etapa 5: frontend

**5.1 Estrutura:**

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

**5.2 Contrato.** `ScreenShareController` com estado como união discriminada:

```ts
export type ScreenShareState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "active"; sessionId: number; source: CaptureSource }
  | { status: "error"; kind: string; message: string };
```

Método `dispose()`: o provider chama quando a sala cai ou o usuário troca de canal; a implementação para
tudo o que estiver rodando.

**5.3 `IpcScreenShare`.** Recebe o `Room` no construtor; concentra o generator, o `ScreenShareAudio`, os
ACKs, a escuta do `screen-share-ended` e o teardown. Com as correções: `videoEncoding` e `contentHint` na
publicação do vídeo, `AudioPresets.musicHighQualityStereo` e `dtx: false` no áudio, sem cópia extra no
handler de frame, proteção contra início duplo.

**5.4 Worklet.** Jitter buffer: ring buffer pré-alocado de 1 segundo, estado "acumulando" até 50 ms
(2.400 frames), silêncio e volta ao acúmulo quando esvaziar, descarte das amostras mais antigas ao passar
de 150 ms. Nenhuma alocação dentro do `process()`.

**5.5 `VoiceProvider` enxuto.** Só conexão, mute e deafen; expõe o controller. Mudanças: `RoomAudioRenderer`
com `muted={isDeafened}` e restauração do mute anterior, tratamento de `Reconnecting`/`Reconnected`,
`controller.dispose()` no cleanup do efeito e no `Disconnected`, árvore envolvida por `RoomContext`.

**5.6 `SourcePicker`.** Lista simples, sem miniaturas, janelas e monitores separados, escolha de
qualidade e de áudio. PID vem pronto do Rust.

## Etapa 6: verificação

1. Iniciar e parar o compartilhamento 20 vezes seguidas, inclusive clicando rápido; memória do app no
   Gerenciador de Tarefas deve voltar ao patamar inicial.
2. Trocar de canal de voz durante um compartilhamento; a captura para e nenhum log de frame continua
   aparecendo.
3. Desligar a rede por 30 segundos durante um compartilhamento e religar; a UI mostra a reconexão e o
   compartilhamento volta ou é encerrado de forma limpa.
4. Fechar a janela que está sendo compartilhada; o evento `sourceClosed` chega e a UI volta ao estado
   `idle`.
5. Fechar o programa cujo áudio está sendo capturado; o áudio para sem derrubar o vídeo (decisão 7).
6. Deafen, e então alguém novo entra no canal; não deve ouvi-lo. Mute, deafen, undeafen; o microfone
   continua mutado.
7. Compartilhar um jogo por duas horas com o app minimizado, com alguém assistindo; anotar CPU, memória
   e picotes. Esse número vira a base de comparação do próximo plano.

**Critério de pronto da fase:** todos os itens do `NOTES.md` resolvidos ou conscientemente adiados, a
lista acima passando, e o provider sem nenhuma referência direta a generator, worklet ou comandos de
captura.
