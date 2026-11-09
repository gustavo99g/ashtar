# encoder-probe — Etapa 0 do publicador nativo

Mede, na máquina de quem roda, o caminho que a transmissão vai usar quando sair do WebView:

```text
WGC (textura D3D11) → VideoProcessor (redução + BGRA→NV12, na GPU) → encoder H.264 de hardware (Media Foundation)
```

Sem rede e sem LiveKit. Responde se o encoder do Media Foundation entrega latência, ritmo e
controle (keyframe sob pedido e troca de bitrate) bons o bastante para o publicador nativo.
É um projeto à parte do app, sem o libwebrtc, então compila em segundos. Só roda no Windows.

## Como rodar

Num terminal, nesta pasta:

```powershell
cargo run --release -- --list
```

Mostra as telas, o adaptador e os encoders de hardware (H.264, HEVC e AV1). Depois, com um vídeo
ou jogo se mexendo na tela que vai ser capturada:

```powershell
# 1080p60 a 8 Mbps, o caso principal
cargo run --release -- --size 1920x1080 --fps 60 --bitrate 8000 --out 1080p60.h264

# resolução cheia da tela, para ver se o custo ainda cresce com o monitor
cargo run --release -- --size native --fps 60 --bitrate 12000

# os presets de hoje
cargo run --release -- --size 1280x720 --fps 60 --bitrate 6000
cargo run --release -- --size 1600x900 --fps 60 --bitrate 8000

# como o app faria: só codifica quando a imagem muda
cargo run --release -- --only-new
```

Durante cada teste, vale olhar no Gerenciador de Tarefas → Desempenho → GPU o gráfico
**Video Encode** (deve subir) e o **3D** (deve ficar baixo).

O `.h264` gravado abre no VLC ou com `ffplay 1080p60.h264`, para conferir a imagem (cores, nitidez
do texto, artefatos).

`cargo run --release -- --help` lista todas as opções.

## O que o relatório mostra

- **Frames**: quantas imagens novas o WGC entregou e quantas foram ao encoder; descartes com o
  encoder ocupado indicam que ele não acompanha o fps.
- **CPU do processo**: o objetivo do caminho é que isso fique perto de zero.
- **CPU por frame (laço)**: tempo de CPU para copiar, converter e entregar um frame (o trabalho
  real fica na GPU).
- **Captura → H.264 pronto**: latência de ponta a ponta na máquina (conversão + encoder).
- **Intervalo entre saídas**: se o ritmo é regular (p50 perto de 16,7 ms a 60 fps).
- **Bitrate real**: na primeira metade, contra o alvo; na segunda, depois de trocar o alvo pela
  metade (o que o `take_rate_control_request` da crate `livekit` vai pedir).
- **Keyframes**: pedidos a cada 3 s; o atraso em frames entre o pedido e o keyframe (o que o
  `take_keyframe_request` vai pedir quando alguém entra na transmissão).

## Resultado (2026-11-05, RX 9060 XT, AMDh264Encoder, release)

Telas de 1080p e 4K (150% de escala), com uma live e um cronômetro tocando no navegador.

| Saída | Tela | CPU da máquina | Captura → H.264 (p50 / p99) | Saídas | Descartes | GPU (Gerenciador) |
|---|---|---|---|---|---|---|
| 1080p60 | 1080p | ~0,7% | 5,4 / 7,3 ms | 60 fps | 0 | ~10% |
| 1080p60 | 4K | 0,73% | 5,8 / 8,8 ms | 60 fps | 0 | ~10% |
| 1080p30 | 1080p | 0,41% | 5,7 / 8,2 ms | 30 fps | 0 | — |
| 4K60 | 4K | 0,64% | 9,0 / 10,7 ms | 60 fps | 0 | ~30% |

- **O tamanho do monitor quase não pesa mais:** 4K reduzido para 1080p na GPU custa o mesmo que 1080p.
- **Keyframe sob pedido:** sempre no frame seguinte (atraso 0). **Troca de bitrate em andamento:** aceita.
- **Imagem:** cores e nitidez boas no player.
- **Pegadinha do driver AMD:** a codec API (baixa latência, CBR, bitrate, B-frames, GOP) precisa vir
  **antes** dos tipos de mídia. Depois deles, o encoder volta para 30 fps: grava 30 fps no SPS (o vídeo
  toca em câmera lenta) e orça o bitrate para 30 fps (o dobro do alvo a 60 fps). O `MF_MT_FRAME_RATE`
  e o nível H.264 não resolvem, e o `CODECAPI_AVEncVideoOutputFrameRate` é recusado.
- **Ritmo do WGC:** imagens novas a cada 20,8 ms (48 Hz) nessa máquina; com a tela parada, nenhuma.
  Codificar só imagens novas (`--only-new`) economiza CPU sem piorar a latência, mas o encoder
  orça cada frame como bitrate ÷ fps: com fps variável, o publicador precisa corrigir pelo bitrate medido.
