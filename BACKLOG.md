# BACKLOG — o que a reorganização deixou para as próximas etapas

Itens adiados ao fechar a reorganização do compartilhamento de tela (Etapas 1 a 6 de [`docs/plans/v0.1-reorganizacao.md`](docs/plans/v0.1-reorganizacao.md), concluída em
2026-10-06). Vieram de [`docs/plans/v0.1-notes.md`](docs/plans/v0.1-notes.md), com o texto e as evidências originais, e estão sob a versão que deve
recebê-los segundo o `docs/roadmap.md`. Os destinos de "Janelas minimizadas", "divisão do `capture_frame`"
e "linha de base de desempenho" são sugestões desta triagem, não decisões do roadmap.

Ao resolver um item, apague-o daqui e registre o resultado no ADR ou no commit.

## Resto da v0.1 (fora da reorganização)

- [ ] O `fetch` do token (`requestVoiceToken`) não tem timeout: com a API fora do ar (túnel caído), o app
      pode ficar em "conectando" por bastante tempo. Sem destino definido.

## Correções fora de ordem

Bugs que saem assim que ficarem prontos, pelo auto-update, sem esperar a entrega da ordem.

- [ ] **Enxugar o `admin`** (o que sobrou da Etapa 8; o código de acesso e a rota `/api/voice/join`
      já saíram): o Painel de controle cobre `convite`, `convites`, `revogar`, `membros`, `remover`,
      `desvincular`, `beta` e `permissoes`. **Não tirar o `recuperacao`**: se o dono perde o computador, ele
      não consegue abrir o Painel, e esse comando é o único jeito de criar a recuperação dele. Ficariam
      `dono`, `backup`, `recuperacao` e, de preferência, `membros`, só para conferir o banco. Se for feito,
      atualizar o `README.md`, o `scripts/local/admin-shell.ps1` (a lista de comandos) e os testes.
- [ ] **Subir o `MIN_CLIENT_VERSION`** no `.env` de produção (`0.2.20`, a primeira versão com conta): um
      app mais velho passa a receber o pedido de atualização, em vez de erro de rota. É só configuração.

- [ ] Eco no compartilhamento da tela inteira com "Todo o sistema". Num teste com amigos (2026-10-06), um
      amigo compartilhou o monitor e quem assistia ouviu a própria voz; só mutar o próprio microfone
      parava. **Correção fora de ordem** ("Correções fora de ordem" no `docs/roadmap.md`): sai assim que ficar pronta, sem esperar a v0.2.3.
      **Evidências (medidas nesta máquina; o teste do Brave rodou no perfil de debug, a árvore do app foi vista no
      executável de release):**
      - O código exclui o PID do app (`std::process::id()`) com `EXCLUDE_TARGET_PROCESS_TREE`; conferido na
        crate `wasapi` (`include_tree = false`).
      - Com uma instância, o WebView2 do app é todo descendente do `desktop.exe`: o `browser` é filho dele;
        renderer, GPU, rede e armazenamento, filhos do `browser`.
      - Um Brave isolado tocando um tom (mesma arquitetura de áudio do WebView2, com o
        `audio.mojom.AudioService` filho da raiz): excluir a raiz funciona. RMS 0,0022 com o tom excluído,
        contra 0,0021 de fundo sem tom e 0,0046 com o tom incluído.
      - **Com duas instâncias do app abertas há um só conjunto de processos do WebView2, e ele pertence à
        primeira** (a pasta de dados é a mesma, `%LOCALAPPDATA%\gustavo99g\EBWebView`). Com `desktop.exe` 25504
        e 2436, os dois renderizadores ficaram sob o 25504 e nada sob o 2436. Para a segunda instância,
        excluir o próprio PID não exclui nenhum processo do WebView2: a chamada entra no loopback.
      **Não verificado:** se o amigo tinha duas instâncias (ou um WebView2 remanescente de uma execução
      anterior) abertas. Outra explicação possível é o eco acústico (a voz sai da caixa de som e volta pelo
      microfone dele); mutar o próprio microfone resolveria nos dois casos, então isso não distingue. Teste
      para separar: o amigo compartilha com "Sem áudio"; se o eco continuar, vem do microfone dele. Também
      não se observou o processo de áudio do WebView2 do próprio app tocando.
      **Ideia de correção (não implementada):** excluir o processo-navegador real do WebView2
      (`ICoreWebView2::BrowserProcessId`, obtido pelo `with_webview` do Tauri; existe no webview2-com 0.38.2)
      em vez do PID do app, caindo no PID do app se não for possível obtê-lo. Assim a segunda instância
      exclui a árvore do navegador que ela de fato usa. Mexe na assinatura do `start` do manager e em
      `commands/screen_share.rs`. O teste `mede_a_exclusao_de_um_chromium` (ignorado) repete a medição com
      qualquer Chromium tocando áudio (`EXCLUDE_PID=<pid da raiz>`).

## v0.2.2 — UI nova

- [ ] O app passa a usar as rotas de identidade que a v0.2.1 deixou prontas na API (`/api/auth/redeem`,
      `/api/auth/login`, `/api/me`, `/api/voice/token`): chave do dispositivo calculada no desktop (hash do
      hardware, ou 32 bytes aleatórios no cofre do Windows quando o hardware é genérico), telas de convite e de
      escolha do nick, e fim do `idiot-<uuid>`. Em seguida, desligar o código de acesso provisório, a rota
      `/api/voice/join` e subir o `MIN_CLIENT_VERSION` (ADR 0011).
- [ ] Criar o dono pelo `admin dono` e gerar um convite de recuperação para vincular o computador do dono
      (decisão 5 do plano da v0.2.1, `docs/plans/v0.2.1-identidade-na-api.md`).

- [ ] O seletor (`SourcePicker`) e a trava de uma transmissão por vez (`ScreenShareButton`) existem e foram
      usados nos testes de 05 e 06/10 (ADR 0009). A trava só considera tracks já assinados e não impede duas
      pessoas de iniciarem ao mesmo tempo; o erro de início não tem como ser dispensado. A UI de voz é
      provisória. **Adiado para a UI nova (v0.2.2).**
- [ ] Os textos dos presets (`presets.ts`) prometem mais fluidez do que o medido em jogo: o Equilibrado ("sem
      perder fluidez") ficou em 25–34 fps e o Nitidez em 18–25 fps, abaixo dos 30 do próprio nome (ADR 0009). **Adiado para a UI nova (v0.2.2).**

- [ ] Botão "Abrir pasta de logs" e interruptor "receber versões beta", adiados da v0.2.0. Até lá, o canal
      vem de `ASHTAR_UPDATE_CHANNEL=beta`.

- [ ] Rotas de administração na API e tela de administração na UI, no lugar do `admin` temporário da v0.2.1:
      criar, listar e revogar convite, remover membro, desvincular dispositivo, marcar o beta e ver as
      permissões. Ficam sobre as funções de `identity/`, que já recebem o `actor`. Depois, tirar do `admin` o
      que a UI cobrir e deixar só `dono` e `backup`.

- [ ] Tela de usuários em que o dono marca quem recebe o beta. A API (devolver o canal e a permissão no
      `admin`) sai na v0.2.1 (`NOTES.md`); a tela e o app guardando o último valor vêm aqui, e substituem a
      variável `ASHTAR_UPDATE_CHANNEL`. Papel de dono ("supremo"), acima de administrador; só ele marca o beta.
- [x] Organizar as features do front pelo padrão da ADR 0014 (gavetas `components/`, `hooks/`, `stores/`,
      `model/`; a `voice` em subdomínios e a `server` separada). Feito em 31/10, sem regra de ESLint: é
      convenção. O que difere do plano está na seção "Como ficou" da ADR.

## v0.2.3 — Chat real

Itens que a UI nova (v0.2.2) deixou para o chat, porque dependem do WebSocket próprio.

- [ ] Trocar as consultas repetidas da v0.2.2 por eventos: a lista de quem está na sala (hoje a cada 5 s,
      `GET /api/voice/participants`) pelos webhooks do LiveKit levados pelo WebSocket, e o aviso de quem
      entrou (hoje o app do dono compara `GET /api/members` a cada 30 s) por um evento. Cada feature ganha um
      `realtime.ts` que atualiza o cache do TanStack Query (ADR 0012).
- [ ] O quadro "Canal de texto" do canvas é a referência visual do chat; a rota e o espaço no `AppShell`
      já existem desde a v0.2.2.

## v0.2.3 e v0.6 — Voz e vídeo

- [ ] A aba "Voz e vídeo" das configurações saiu na v0.2.2 só com os dispositivos, Entrada e Saída (Etapa
      5b). O resto do quadro dela fica guardado: supressão de ruído, cancelamento de eco e ganho automático
      na v0.2.3; os volumes de entrada e de saída, o teste de microfone, a detecção de voz com a
      sensibilidade, o pressionar para falar com o atalho, os atalhos globais e os padrões do
      compartilhamento de tela (qualidade e áudio) na v0.6. O
      pressionar para falar com um jogo em foco pede um gancho de teclado em Rust: o atalho global comum do
      Windows prende a tecla, e o jogo deixaria de recebê-la.
- [ ] "Reconectando" no painel "Voz conectada" e o aviso "Conexão perdida" do compartilhamento ficaram
      apagados no canvas na v0.2.2; entram com a reconexão da v0.6.

## v0.2.5 — Publicador nativo e medição

- [ ] Redução da imagem no caminho do IPC. O legado reduzia em BGRA com `fast_image_resize` e
      `ResizeAlg::Nearest`, depois de copiar o frame inteiro (`frame.data().to_vec()`); isso saiu com o
      `legacy/`. O caminho novo converte para I420 e reduz com o `scale` do libyuv (mais legível para texto).
      **Base pronta:** `to_i420` converte em resolução cheia e reduz com o `scale` do I420 só quando o
      frame passa da caixa do preset (`fit_in_box`).
      **Medido (2026-10-05/06, release):** a premissa de que isso é "mais rápido" não se confirmou. No 1080p
      o `scale` custa 5–10 ms, cerca de metade do `capture_frame`, e a conversão de cor só 2–3 ms. A causa não
      foi isolada (uma hipótese, não verificada, é o filtro do `scale`; o legado usava `Nearest`). Próximo
      teste: reduzir em BGRA antes de converter, com o `fast_image_resize`, que por isso continua no
      `Cargo.toml`, sem uso desde a remoção do `legacy/` (ADR 0009).
      **Adiado para o publicador nativo (v0.2.5):** é um experimento de otimização, não um defeito.
- [ ] A divisão do `capture_frame` em readback, redução e conversão (ADR 0009) vem de uma instrumentação que
      não está no repositório: os logs de tempo por etapa foram removidos (estão no commit `d418b00`). Para
      repetir a medição, recolocar os logs ou deixar um cronômetro permanente no target `perf`.
      **Adiado para a v0.2.5**, junto das medições do publicador nativo.
- [ ] Linha de base de desempenho em build de release, separada para os três presets de qualidade
      (decisão 16 de `docs/plans/v0.1-reorganizacao.md`). **Adiado para a v0.2.5:** só existe o fps por preset em jogo (ADR 0009); faltam
      CPU, memória e o histograma de intervalos entre frames, que o publicador nativo vai precisar para comparar.
- [ ] Publicador de vídeo/áudio nativo em Rust (fica para o próximo plano). Ele precisa de duas peças:
  1. **Redução na GPU antes de copiar para a memória**, para janelas em 4K cheio: readback (~7 ms) mais
     conversão (~10 ms) somam ~17 ms, mais que os 16,7 ms de um frame a 60 fps. Combina com o encoder
     por hardware, que também põe a GPU no caminho.
  2. **O publicador em si.** O teto de ~43 fps do ACK era de dev e do caminho antigo; em release ele não
     aparece (envio de ~0,1 ms por frame, e `max_in_flight` maior não ganhou nada; ADR 0009). O ganho do
     publicador não é tirar esse teto, e sim abrir caminho para o encoder por hardware e para a redução
     na GPU.

  Uma terceira peça, a captura própria de janelas com o `windows-capture`, estava prevista e **deixou de
  ser necessária**: o atraso das janelas vinha de o libwebrtc cair no GDI por falta de COM na thread, e o
  passo 9 corrigiu isso (ver o item da queda de fps em janelas, em `docs/plans/v0.1-notes.md`, e o ADR 0008).

  Pontos para observar depois do passo 9: janela parada custa uma conversão por volta, mesmo sem mudança
  (expor o `updated_region` exigiria mexer no `webrtc-sys`); jogos em tela cheia exclusiva podem não ser
  capturáveis como janela (o contorno é compartilhar a tela); conteúdo com DRM sai preto também no WGC.
- [ ] Medição/comparação de desempenho estruturada (fica para o próximo plano; a Etapa 6 só coleta a
  linha de base).

## Mais adiante

Miniaturas e o aviso de conteúdo protegido estão na v0.8 do roadmap (`## Screen Share`); Linux, depois da v1.0; sem versão para funcionalidades novas de voz.

- [ ] Miniaturas no seletor de fontes. Enquanto isso, o seletor mostra só ícones. Pontos do código de preview
  do protótipo a corrigir quando voltarem ao escopo: previews enviados como `Vec<u8>` em JSON e uma
  sessão WGC aberta por janela.
- [ ] Aviso de possível conteúdo protegido (frames totalmente pretos por vários segundos).
- [ ] Suporte a Linux (risco principal: WebRTC no WebKitGTK) e versão web.
- [ ] Qualquer funcionalidade nova de voz além do que já existe.
- [ ] Janelas minimizadas não aparecem no seletor. Não é bug nosso: o libwebrtc as descarta da lista
      (`IsIconic`) e também não as captura, e o `CaptureSource` só sai dessa lista (medido: o `start` de uma
      janela minimizada devolve `SourceNotFound`). O seletor recarrega a lista a cada 2 s (ao fim de cada
      pedido, sem acumular), então uma janela restaurada aparece sem reabrir. Adiado: lista própria com
      `EnumWindows`, selo "Minimizada" e restauração da janela ao escolher (contraria a decisão 2 do PLAN).
      A lista leva ~95 ms com 4 janelas (release), por causa dos ícones: remedir com muitas janelas.
      **Adiado de novo na v0.2.2** (decisão de 17/10): a lista continua sem as minimizadas, e o quadro
      do seletor no canvas perdeu o selo "Minimizada".
- [ ] Um segundo tema (claro, por exemplo). A troca por `data-theme` já existe desde a v0.2.2 (ADR 0012);
      a opção aparece nas configurações quando o tema existir, com o contraste conferido.
