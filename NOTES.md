# NOTES — problemas conhecidos do protótipo (marco-0)

Lista de verificação para a fase "reorganização + correções" (Etapas 1-6 do `PLAN.md`).
Cada item deve ser resolvido ou conscientemente adiado (marcar como tal) antes de fechar a fase.

## Arquitetura / Rust

- [ ] Dois pipelines de captura de vídeo coexistem: `windows_capture` (WGC, usado em produção) e
      `livekit::webrtc::desktop_capturer::DesktopCapturer` (usado só nos comandos `test_*`).
      **Decisão:** consolidar em `DesktopCapturer`; remover `windows_capture`/WGC e os comandos de teste.
      **Importante:** o teste que motivou a escolha comparou pipelines diferentes, não o WGC contra o
      `DesktopCapturer` isoladamente — o caminho WGC lia frame a frame na taxa do monitor (cópia GPU→memória
      cara), fazia cópias extras mesmo de frames descartados e mandava RGBA (~2.7x maior) pelo IPC, que é o
      gargalo. O `DesktopCapturer` só lê sob demanda e manda I420. Ou seja, o WGC não foi descartado por uma
      limitação técnica dele; se o `DesktopCapturer` falhar no teste de correção (jogo em janela/tela cheia
      sem borda, Chrome/Electron com vídeo, janela parada por 1 min sem perder FPS), um WGC com leitura só
      dos frames aceitos e envio em I420 volta a ser opção real. Ver `PLAN.md`, decisão 1.
- [ ] Ids de monitor: `sources.rs` usa `EnumDisplayMonitors`/`HMONITOR`, mas o `DesktopCapturer` do
      libwebrtc no Windows identifica telas pelo índice do `EnumDisplayDevicesW`. Pode funcionar por
      coincidência com um monitor só e quebrar com dois. **Correção:** listar monitores pelo próprio
      `DesktopCapturer` (tipo `Screen`) e cruzar com `EnumDisplayDevicesW`/`GetMonitorInfoW` (`szDevice`)
      só para enriquecer nome/posição/principal. Testar com dois monitores antes de dar como resolvido.
- [ ] `sources.rs`: `SendMessageW` pode travar em janelas que não respondem — trocar por
      `SendMessageTimeoutW`.
- [ ] `sources.rs`: callback do `EnumWindows` faz enriquecimento (título, PID, ícone) dentro do próprio
      callback; deveria só coletar HWNDs e enriquecer depois, fora do callback.
- [ ] `sources.rs`: conversão de ícones antigos (sem canal alpha) para PNG/data URL não corrige o alfa.
- [ ] `sources.rs`: listagem de janelas não exclui as janelas do próprio app.
- [ ] `sources.rs`: declarações FFI feitas à mão (`extern "system"`) em vez de usar a crate `windows-sys`
      onde possível.
- [ ] Captura de vídeo e áudio estão acopladas ao destino (`Channel<InvokeResponseBody>` do Tauri).
      Não é possível trocar por outro sink (ex.: publicador LiveKit nativo) sem duplicar a captura.
- [ ] Nenhuma garantia de que uma thread de captura esquecida realmente para (sem `Drop` no handle).
- [ ] Loop de captura de vídeo não trata "fonte fechada": quando a janela compartilhada é fechada,
      o capturer passa a retornar erro em todo frame e o log cresce indefinidamente.
- [ ] Captura de áudio (WASAPI) usa polling em vez de modo por eventos.
- [ ] Buffer de captura de áudio tem tamanho fixo problemático; sem flag de silêncio explícita.
- [ ] Sem log de descontinuidade (glitch/drop) na captura de áudio.
- [ ] Inicialização da captura de áudio não é determinística no lado do chamador (sem oneshot de resultado);
      erros de inicialização podem aparecer depois do comando já ter retornado sucesso.
- [ ] Modo de áudio `System` recebe `process_id` do frontend para decidir o que excluir; deveria usar
      `std::process::id()` (processo do próprio app) automaticamente, sem depender do JS.
- [ ] Início de sessão (vídeo + áudio) não é atômico: se o áudio falha depois do vídeo já ter subido,
      a limpeza da metade que subiu fica a cargo do JavaScript — origem de vazamentos observados.
- [ ] Áudio da captura é enviado ao frontend serializado como JSON (via `Channel<Vec<u8>>` normal) em vez
      de bytes crus (`InvokeResponseBody::Raw`), com custo de serialização desnecessário.
- [ ] Erros de comando são `String` livre; frontend não consegue diferenciar casos (ex. "fonte fechada")
      sem comparar texto de mensagem.
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
- [ ] Sem backpressure entre captura e sink de IPC: nada impede o produtor de acumular frames em trânsito
      caso o consumidor (React/worklet) fique para trás.

## Frontend

- [ ] Publicação de vídeo no LiveKit sem `videoEncoding` nem `contentHint` explícitos.
- [ ] Publicação de áudio sem `AudioPresets.musicHighQualityStereo` e sem `dtx: false`.
- [ ] Cópia extra desnecessária de buffer no handler de frame de vídeo.
- [ ] Sem proteção contra início duplo do compartilhamento (cliques rápidos/repetidos).
- [ ] `AudioWorkletProcessor` aloca dentro de `process()` e não implementa um jitter buffer de verdade
      (sem acúmulo inicial, sem descarte de amostras antigas) — causa estalos/latência variável.
- [ ] `RoomAudioRenderer` não usa `muted={isDeafened}`; deafen/undeafen não restaura o estado de mute anterior.
- [ ] Sem tratamento de `Reconnecting`/`Reconnected` do LiveKit na UI.
- [ ] Sem `dispose()` chamado no cleanup do efeito nem no evento `Disconnected` — captura pode continuar
      rodando depois de trocar de canal ou sair da sala.
- [ ] Árvore de componentes não está envolvida por `RoomContext`, então hooks do LiveKit não funcionam
      de forma idiomática nos componentes filhos.
- [ ] Comportamento indefinido quando o app de origem do áudio fecha (áudio deveria parar sem derrubar
      o vídeo — decisão tomada na Etapa 3.6, ver `PLAN.md`).

## Fora do escopo desta fase (adiado conscientemente)

- Publicador de vídeo/áudio nativo em Rust (fica para o próximo plano).
- Medição/comparação de desempenho estruturada (fica para o próximo plano; a Etapa 6.7 só coleta a
  baseline).
- Miniaturas no seletor de fontes.
- Qualquer funcionalidade nova de voz além do que já existe.
