# 0018 — Captura pelo WGC e vídeo na GPU

- **Status:** aceita
- **Data:** 2026-11

## Contexto

O `DesktopCapturer` do libwebrtc (ADRs 0002 e 0008) entrega cada imagem já na memória, não lista as janelas
minimizadas e não captura nenhuma enquanto está minimizada. Para o vídeo não sair da GPU até o encoder (ADR
0017), a captura precisa entregar texturas, e a redução, a conversão e o encoder precisam estar no mesmo
dispositivo.

## Decisão

**A captura é própria, pelo Windows.Graphics.Capture**, para telas e janelas, com o pool "free threaded" (sem laço
de mensagens), sem a borda amarela e com o cursor ligável no meio. O WGC só entrega imagem quando algo muda, e cada
uma traz o horário de composição, no mesmo relógio do WASAPI.

**Um dispositivo D3D11 por transmissão**, dividido pela captura, pela conversão e pelo encoder, com a proteção
multithread ligada. Um dispositivo perdido (driver atualizado no meio) encerra só aquela transmissão.

**Redução e conversão na GPU** pelo `ID3D11VideoProcessor`: NV12 em BT.709 de faixa limitada, num anel de 4
texturas. A saída tem sempre o tamanho do preset; uma fonte de outra proporção entra no meio, com bordas pretas,
e a janela mudando de tamanho não reinicia o encoder.

**O encoder H.264 de hardware do Media Foundation**, escolhido pela placa do dispositivo (`MFTEnum2` com o LUID),
assíncrono, em baixa latência, CBR, sem B-frames, GOP de 30 s e keyframes sob pedido. **A codec API vem antes dos
tipos de mídia:** configurada depois, o encoder da AMD volta para 30 fps, grava 30 fps no SPS (o vídeo sai em
câmera lenta) e orça o bitrate para 30 fps.

**Só imagens novas são codificadas;** com a tela parada, a última é reenviada a cada 1 s e sempre que alguém pede
um keyframe. **O bitrate é corrigido pelo medido** (`bitrate.rs`), a cada segundo, metade do caminho por vez,
entre metade e o dobro do alvo, porque o encoder orça por fps configurado e o fps real varia.

**A saída tem mais de um destino** (`PacketSink`, `Fanout`), a base dos clipes e do replay da v1.1.

**Plano B:** sem encoder de hardware, ou se ele falhar ao abrir, o NV12 reduzido é lido para a memória e vai ao
codificador de software da crate `livekit`. `ASHTAR_FORCE_SOFTWARE_ENCODER=1` o força.

## Alternativas consideradas

- **Continuar com o `DesktopCapturer`** e só trocar o envio. A imagem continuaria indo para a memória, e as
  minimizadas continuariam fora.
- **A crate `windows-capture`.** Faz o mesmo que o `wgc.rs`, mas esconde o dispositivo, que aqui precisa ser o
  mesmo da conversão e do encoder.
- **AMF, NVENC e QuickSync direto.** Mais controle por marca, três integrações. O Media Foundation cobre as três
  com uma; o encoder fica atrás de uma interface para um SDK entrar se o MF não servir.
- **Conversão por shader próprio.** O `VideoProcessor` é o hardware de vídeo da placa e já faz redução e espaço
  de cor; um shader seria código a manter sem ganho medido.

## Consequências

- A CPU de quem transmite fica perto de zero, e uma janela parada não custa nada.
- O código de GPU é COM puro, que não é `Send`: tudo vive numa thread só por transmissão.
- Cada marca de placa pode ter a sua pegadinha no Media Foundation; o teste com GPU (`pipeline.rs`) e o
  `encoder-probe` são a conferência.
- Sinal para rever: um driver que mude o comportamento da codec API, ou uma marca do grupo sem MFT de hardware
  utilizável.
