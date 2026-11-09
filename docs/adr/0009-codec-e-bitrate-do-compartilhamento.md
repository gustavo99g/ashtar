# 0009 — Codec, bitrate e simulcast do compartilhamento pelo IPC

- **Status:** substituída por 0017 e 0018 (v0.2.4); fica como a medição do caminho IPC
- **Data:** 2026-10

## Contexto

No caminho IPC (ADR 0007) o Rust captura e o React publica a trilha no LiveKit. Quem codifica o vídeo é o
encoder do WebView2, ou seja, o libwebrtc do Chromium, e não o do Rust.

Os testes de 05 e 06 de outubro de 2026 começaram com um bug: a trilha publicada com
`source: ScreenShare` faz o `livekit-client 2.22` ler só o `screenShareEncoding` e ignorar o
`videoEncoding`. Sem ele, o espectador recebia 15 fps com o bitrate padrão da biblioteca (2,5 Mbps). O
`IpcScreenShare` passou a usar o `screenShareEncoding`, e a partir daí foi possível comparar codec, bitrate e
simulcast.

**Condições das medições.** Sempre em build de release (em dev tudo fica ~30% mais lento, então só
release vale). Emissor e espectador na mesma máquina, com um jogo rodando (LoL e outro). Monitor 1080p,
exceto onde indicado como 4K. Os números são, por isso, provavelmente um piso do que se veria com o
espectador em outro computador.

### De onde vem o fps (captura)

| Fonte | Preset | fps que chegam da captura |
|---|---|---|
| Janela no monitor 1080p, vídeo | Movimento | 53–60 |
| Janela no monitor 1080p, jogo | Movimento | 35–55 |
| Janela no monitor 1080p | Equilibrado | ~40–55 |
| Janela no monitor 1080p | Nitidez | 30 (o teto do preset) |
| Janela no monitor 4K | qualquer | 25–35 |

O gargalo é o `capture_frame`. No 1080p, cerca de metade é o readback do libwebrtc (5–10 ms) e metade é a
redução (`scale`) dentro do `to_i420`; a conversão de cor custa só 2–3 ms. No 4K, ~55% é conversão mais
redução (13–20 ms) e ~45% é readback (~15 ms). O envio pelo IPC até o webview custa ~0,1 ms por frame, então
o webview não é gargalo. `max_in_flight` 8 no Equilibrado não ganhou nada e voltou para 5.

### Encoder e qualidade (o que o espectador recebe)

| Configuração | Resultado |
|---|---|
| VP8 3,5 / 4,5 / 4,5 Mbps, com simulcast | Equilibrado com imagem muito ruim em jogo |
| VP8 8 Mbps, com simulcast | Equilibrado continuou ruim |
| H.264 8 Mbps (Equilibrado) | Imagem boa no vídeo; em jogo 22–40 fps, e no fim caiu para 1200×675 com limite: cpu |
| H.264 3,5 Mbps (Movimento) | Pior que o VP8 |
| H.264 8 Mbps (Nitidez, 1080p, jogo) | 5–11 fps, limite: cpu |
| VP8, sem simulcast (final) | O encoder acompanha tudo o que chega, limite: none em todos |

O H.264 do WebView2 nessa máquina é o OpenH264, em software (`powerEfficientEncoder: false`). Com jogo
rodando ele fica sem CPU. O VP8 (libvpx) também roda em software, mas aguenta. Com simulcast o encoder fazia
duas camadas; desligado, faz uma só.

Configuração final, no LoL (monitor 1080p):

| Preset | Bitrate | Resolução | fps |
|---|---|---|---|
| Movimento | 3,5 Mbps | 720p | 29–50 (quase sempre acima de 35) |
| Equilibrado | 8 Mbps | 900p | 25–34 (quase sempre perto de 30) |
| Nitidez | 8 Mbps | 1080p | 18–25 |

Em outro jogo, o Nitidez em VP8 deu 15–27 fps, também com limite: none.

**Áudio.** O buffer do jitter buffer fica entre 10 e 150 ms. Os esvaziamentos e descartes ocasionais aparecem
nas mesmas quedas de fps da captura; pela coincidência no tempo, parece ser a máquina apertada e não um
defeito do áudio (inferência, não isolada).

## Decisão

Os três presets usam **VP8**, com bitrates máximos de **3,5 / 8 / 8 Mbps** (Movimento, Equilibrado,
Nitidez) e **`simulcast: false`**, publicados com `screenShareEncoding`. O `videoCodec` é um campo de cada
preset (`presets.ts`), pronto para trocar. O limite de frames em trânsito do `FrameGate` fica em 5 / 5 / 3
(`media/quality.rs`).

## Alternativas consideradas

- **H.264.** Em software (OpenH264) no WebView2, ficou sem CPU com o jogo rodando (5–11 fps no Nitidez) e
  rebaixou a resolução sozinho no Equilibrado. Só deve compensar com encoder por hardware.
- **Simulcast ligado.** Duas camadas custam CPU, e a imagem em jogo ficou ruim mesmo com 8 Mbps.
- **Bitrates menores (3,5 / 4,5 / 4,5 Mbps).** O Equilibrado ficou com imagem muito ruim em jogo.
- **`max_in_flight` maior.** 8 no Equilibrado não ganhou fps.

## Consequências

- **O encoder deixou de ser o limite**; o fps depende da captura: quanto mais pixels por frame, menos fps.
  A janela 4K fica em 25–35 fps em qualquer preset (o ADR 0008 mediu 44–47 fps só do laço de captura, sem
  encoder, jogo nem espectador).
- **Quem transmite precisa de ~9 Mbps de upload** no Equilibrado e no Nitidez, fora da rede local, e cada
  espectador precisa de um download parecido.
- **Sem simulcast, quem assiste com rede ruim não consegue baixar de camada.** Para um grupo pequeno é
  aceitável; vale reavaliar se o teste real mostrar espectadores com conexão fraca.
- **As descrições dos presets prometem mais do que o medido em jogo:** o Equilibrado ("sem perder fluidez")
  ficou em 25–34 fps e o Nitidez em 18–25 fps, abaixo dos 30 do próprio nome.
- **O teto de ~43 fps do IPC (decisão 16 de `docs/plans/v0.1-reorganizacao.md`) não aparece em release.** O envio custa ~0,1 ms por
  frame e `max_in_flight` maior não ganhou nada; aqueles ~43 fps eram de dev e do caminho antigo.
- **Contorno para quem quiser mais fps hoje:** compartilhar a tela em vez da janela, ou usar um preset de
  resolução menor.
- **Melhorias que ficam para o publicador nativo (fora da Etapa 5):**
  - reduzir em BGRA antes de converter para I420 (com o `fast_image_resize`, que por isso
    continua no `Cargo.toml`, sem uso desde a remoção do `legacy/`);
  - captura própria, reduzindo na GPU antes do readback;
  - H.264 de hardware, trocando o `videoCodec` do preset;
  - a pergunta do encoder por hardware do ADR 0007 continua aberta para a crate `livekit`.
- **Sinais para rever esta decisão:** o encoder voltar a reportar limite: cpu com o VP8, ou uma versão do
  WebView2 passar a oferecer encoder H.264 por hardware.
