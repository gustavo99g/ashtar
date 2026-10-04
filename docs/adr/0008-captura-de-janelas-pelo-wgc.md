# 0008 — Captura de janelas pelo WGC do libwebrtc

- **Status:** aceita
- **Data:** 2026-10

## Contexto

A captura de janelas do `DesktopCapturer` (ADR 0002) caía no GDI, que copia a janela pela CPU: ~14 fps
numa janela 4K, contra ~48 fps do WGC direto (crate `windows-capture`, mesma janela).

O `webrtc-sys` pede o WGC para janelas (`set_allow_wgc_window_capturer`) e o `webrtc.lib` pré-compilado o
contém, mas o libwebrtc só o escolhe se a checagem `IsWgcSupported` passar. Essa checagem usa WinRT, que
exige COM inicializado na thread que cria o capturer. A thread de captura de vídeo não o inicializava (a de
áudio sim, pelo WASAPI), e a checagem não gera log: o fallback para o GDI era silencioso.

Evidências (2026-10-01, build de release):

- sem COM, durante a captura de uma janela não carregavam `GraphicsCapture.dll`, `dcomp.dll` nem as DLLs do
  driver da GPU, que o `windows-capture` carrega; uma janela minimizada devolvia frames 1×1 sem erro, como
  faz o GDI;
- com `wasapi::initialize_mta()` na thread, essas DLLs passaram a carregar e o fps subiu.

O mecanismo exato (WinRT exigindo COM) é a leitura do código do libwebrtc; o que foi medido é o efeito.

Medições com o Brave maximizado no monitor 4K (3840×2088), vídeo tocando, e a tela 4K inteira:

| Captura | Janela 4K | Tela 4K |
|---|---|---|
| libwebrtc sem COM (GDI na janela, DXGI na tela) | ~14 fps | 54–60 fps |
| libwebrtc com COM (WGC) | ~35–52 fps (varia com o conteúdo) | 43–50 fps |
| WGC direto (`windows-capture`) | ~48 fps | — |

Com COM em todas as threads, a janela melhora e a tela 4K piora, porque o `webrtc-sys` também liga o WGC
para telas. Além disso, com o WGC uma janela fechada deixa de gerar erro: numa janela descartável fechada, o
fps ficou em 60 por mais ~18 s sem nenhum aviso, e o `SourceClosed` nunca disparou.

## Decisão

A thread de captura de uma **janela** inicializa o COM (MTA) antes de criar o `DesktopCapturer`; a thread de
captura de uma **tela** não. Assim janelas usam o WGC e telas seguem no DXGI. A inicialização fica atrás de
`platform::prepare_window_capture_thread`.

O laço de captura confere o estado de uma janela a cada volta (`IsWindow` e `IsIconic`, em
`platform/win32/window_capture.rs`, exposto como `platform::window_state`): se a janela sumiu, a captura
encerra com `SourceClosed`; se está minimizada, não chama o `capture_frame` e reenvia o último frame.

## Alternativas consideradas

- **Captura própria de janelas com o `windows-capture`.** Mais código (captura, conversão, ciclo de vida)
  para um ganho pequeno sobre esta decisão: ~48 fps contra ~35–52 fps com o WGC do libwebrtc.
- **COM também nas telas.** Mais simples (uma regra só), mas a tela 4K cai de 54–60 para 43–50 fps.
- **Laço de mensagens na thread de captura**, para receber o aviso de janela fechada do próprio WGC. Mais
  complexo que o `IsWindow`, que já resolve com duas chamadas baratas por volta.

## Consequências

- **A escolha do capturer depende do COM e não tem teste automático.** O Rust não expõe qual capturer o
  libwebrtc instanciou (não há `capturer_id` nem equivalente na crate `libwebrtc` nem no `webrtc-sys`).
  Quem protege a decisão são as medições manuais: `captura_uma_janela` (janela 4K bem acima de 14 fps) e
  `captura_uma_tela` (tela 4K perto de 60 fps). Vale repeti-las ao atualizar as crates `livekit` e
  `libwebrtc`, porque uma mudança na escolha interna do capturer só apareceria no fps.
- **Dependência da thread por captura.** As telas só ficam sem COM porque cada captura roda numa thread nova
  (ADR 0005). Uma thread reaproveitada vazaria o COM de uma janela para uma tela.
- **Janela parada repete o último frame a cada volta, com a conversão inteira.** O `updated_region` do
  libwebrtc não chega ao Rust (a crate não o expõe), então não dá para pular a conversão quando nada mudou.
  Era assim com o GDI também. Expor a região exigiria mexer no `webrtc-sys`.
- **Janela 4K a 60 fps ainda depende de reduzir na GPU.** O readback (~7 ms) mais a conversão (~10 ms) em
  resolução cheia somam mais que os 16,7 ms de um frame. Isso fica para o publicador nativo.
- **Jogos em tela cheia exclusiva podem não ser capturáveis como janela.** O contorno é compartilhar a tela.
  Conteúdo com DRM sai preto também no WGC (ADR 0002).
- **Sinais para rever a decisão:** o fps de janela voltar para perto de 14 (o libwebrtc voltou ao GDI), ou
  o da tela 4K cair para perto de 45 (a tela passou a ir pelo WGC mesmo sem COM).
