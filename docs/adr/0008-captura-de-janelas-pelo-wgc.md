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

Janela 4K (Brave maximizado no monitor 4K, 3840×2088, vídeo tocando):

| Captura | Janela 4K |
|---|---|
| libwebrtc sem COM (GDI) | ~14 fps |
| libwebrtc com COM (WGC) | ~35–52 fps (44–47 na rodada final) |
| WGC direto (`windows-capture`) | ~48 fps |

Com o WGC, uma janela fechada deixa de gerar erro: numa janela descartável fechada, o fps ficou em 60 por
mais ~18 s sem nenhum aviso, e o `SourceClosed` nunca disparou.

**Telas.** O `webrtc-sys` também pede o WGC para telas, então se esperava que o COM as afetasse. Uma
primeira medição parecia confirmar (a tela 4K caía de 54–60 para 43–50 fps com COM), mas o conteúdo da tela
não estava controlado. Medida de novo na tela 4K, com e sem COM e com o mesmo conteúdo:

| Conteúdo na tela 4K | Sem COM | Com COM |
|---|---|---|
| vídeo tocando (Brave) | 43–53 fps | 43–53 fps |
| editor de código, imagem parada | 59–60 fps | 60 fps |

O fps da tela depende do conteúdo, e o COM não muda nada: nem o fps, nem as DLLs carregadas
(`GraphicsCapture.dll` e `dcomp.dll` não carregam no modo tela, com ou sem COM). A tela não passa pelo WGC
nesta configuração. Qual capturer ela usa de fato não foi determinado; presumir DXGI seria só hipótese.

## Decisão

A thread de captura de uma **janela** inicializa o COM (MTA) antes de criar o `DesktopCapturer`, atrás de
`platform::prepare_window_capture_thread`. A de **tela** não o faz: o COM não muda nada nela, então ela não
é tocada.

O laço de captura confere o estado de uma janela a cada volta (`IsWindow` e `IsIconic`, em
`platform/win32/window_capture.rs`, exposto como `platform::window_state`): se a janela sumiu, a captura
encerra com `SourceClosed`; se está minimizada, não chama o `capture_frame` e reenvia o último frame.

## Alternativas consideradas

- **Captura própria de janelas com o `windows-capture`.** Mais código (captura, conversão, ciclo de vida)
  para um ganho pequeno sobre esta decisão: ~48 fps contra ~44–47 fps com o WGC do libwebrtc.
- **COM também nas telas.** Seria uma regra só e, pelas medições, equivale à escolhida: não muda o fps nem
  as DLLs carregadas. Não foi adotada porque mudaria as telas sem ganho mensurável. Se uma versão futura do
  libwebrtc passar a mandar as telas para o WGC quando há COM, esta alternativa precisa ser reavaliada.
- **Laço de mensagens na thread de captura**, para receber o aviso de janela fechada do próprio WGC. Mais
  complexo que o `IsWindow`, que já resolve com duas chamadas baratas por volta.

## Consequências

- **A escolha do capturer depende do COM e não tem teste automático.** O Rust não expõe qual capturer o
  libwebrtc instanciou (não há `capturer_id` nem equivalente na crate `libwebrtc` nem no `webrtc-sys`).
  Quem protege a decisão são as medições manuais, sempre com o mesmo conteúdo: `captura_uma_janela` (janela
  4K bem acima de 14 fps) e, como sinal mais direto, conferir se `GraphicsCapture.dll` está carregada
  durante a captura de uma janela. O fps de `captura_uma_tela` **não** serve para isso, porque depende do
  conteúdo. Vale repetir ao atualizar as crates `livekit` e `libwebrtc`.
- **Janela parada repete o último frame a cada volta, com a conversão inteira.** O `updated_region` do
  libwebrtc não chega ao Rust (a crate não o expõe), então não dá para pular a conversão quando nada mudou.
  Era assim com o GDI também. Expor a região exigiria mexer no `webrtc-sys`.
- **Janela 4K a 60 fps ainda depende de reduzir na GPU.** O readback (~7 ms) mais a conversão (~10 ms) em
  resolução cheia somam mais que os 16,7 ms de um frame. Isso fica para o publicador nativo. Ponta a ponta,
  com o encoder, um jogo e o espectador na mesma máquina, uma janela 4K ficou em 25–35 fps em qualquer
  preset ([ADR 0009](0009-codec-e-bitrate-do-compartilhamento.md)).
- **Jogos em tela cheia exclusiva podem não ser capturáveis como janela.** O contorno é compartilhar a tela.
  Conteúdo com DRM sai preto também no WGC (ADR 0002).
- **Sinal para rever a decisão:** o fps de janela voltar para perto de 14, ou `GraphicsCapture.dll` deixar
  de carregar durante a captura de uma janela (o libwebrtc voltou ao GDI).
