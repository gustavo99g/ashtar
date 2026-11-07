# NOTES — pendências da v0.2.4 (publicador nativo)

Lista de verificação da fase descrita no [`PLAN.md`](PLAN.md). Cada item deve ser resolvido ou
conscientemente adiado (marcar como tal) antes de fechar a fase. A lista da fase anterior está arquivada em
[`docs/plans/v0.2.3-notes.md`](docs/plans/v0.2.3-notes.md).

## Vindos do BACKLOG

- [ ] **Publicador de vídeo e áudio nativo em Rust:** as duas peças, a redução na GPU antes de copiar para a
      memória e o publicador em si, são as Etapas 2 e 3.
- [ ] **Redução da imagem no caminho do IPC** (o `scale` do libyuv, 5–10 ms no 1080p): deixa de existir com o
      IPC (Etapa 5). O `fast_image_resize` sai do `Cargo.toml`.
- [ ] **Divisão do `capture_frame` em readback, redução e conversão:** sai com o IPC. O caminho novo tem os
      próprios números e logs (Etapa 3).
- [ ] **Linha de base de desempenho em release por preset** (CPU, memória e histograma de intervalos entre
      frames): a medição da Etapa 6, contra a `0.2.30`.
- [ ] **Medição e comparação estruturada:** a mesma Etapa 6, com o roteiro e os números na ADR 0017.
- [ ] **Janelas minimizadas no seletor:** lista própria por `EnumWindows`, o selo "Minimizada" e a janela
      restaurada ao escolher (Etapas 1 e 5). Remedir o tempo da lista com muitas janelas: hoje leva ~95 ms com
      4, por causa dos ícones.
- [ ] **Miniaturas no seletor** (v0.8 do roadmap, adiantadas): pelo WGC, só dos cards visíveis, sem `Vec<u8>` em
      JSON, pelo `Channel` do Tauri (Etapa 5).
- [ ] **Janela parada custa uma conversão por volta:** o WGC só entrega imagem quando algo muda, e o caminho novo
      só codifica imagens novas (Etapa 2).

## Antes do beta

- [ ] **Jogo em tela cheia exclusiva:** confere se o WGC captura como janela; se não, o contorno é compartilhar a
      tela.
- [ ] **Monitor HDR:** a cor sai lavada na conversão para BT.709?
- [ ] **Notebook com duas GPUs:** captura, conversão e encoder no mesmo adaptador (decisão 2).
- [ ] **Janela redimensionada, minimizada e fechada** no meio da transmissão.
- [ ] **Máquina sem encoder de hardware:** o plano B entra sozinho e o painel mostra "Software".
- [ ] **Driver atualizado com a transmissão aberta** (dispositivo perdido): a transmissão acaba com aviso, sem
      fantasma na sala.
- [ ] **Outras placas do grupo** pelo `encoder-probe.exe` (Etapa 6), principalmente NVIDIA e Intel.
- [ ] **A API da Etapa 4 no computador de casa** antes de o app ir para o beta.

## A decidir durante a fase

- [ ] **Atalho do pausar:** uma tecla global ou só pela bandeja e pelo painel.
- [ ] **Miniaturas em JPEG ou em RGBA cru** pelo `Channel`: o plano parte do JPEG; medir na Etapa 5.
- [ ] **Codec do plano B:** VP8 ou H.264 em software. Quem assiste decodifica os dois.

## Riscos e cuidados

- [ ] **Driver da AMD e a ordem da codec API** (decisão 4): uma atualização de driver pode mudar o
      comportamento. O teste com GPU da Etapa 2 confere o fps gravado no SPS.
- [ ] **Outras marcas de placa** podem ter as próprias pegadinhas no Media Foundation. O encoder fica atrás de uma
      interface, para o AMF (SDK da AMD) ou outro entrar se o MF não servir.
- [ ] **Sem chave para voltar ao IPC:** um problema no beta só se resolve com outra versão. A semana no beta é a
      rede de segurança.
- [ ] **Conteúdo com DRM** sai preto também no WGC. O aviso de conteúdo protegido continua na v0.8.
- [ ] **Cota do LiveKit Cloud:** a `:screen` conta como mais um participante enquanto a VPS não entra (cerca de 1
      minuto a mais por minuto de transmissão, dos 5.000 do plano gratuito).
- [ ] **A trava de uma transmissão por vez** continua só no app e agora precisa reconhecer a `:screen` como a
      transmissão de alguém.
- [ ] **O `SetForegroundWindow`** só troca o foco se o app estiver em primeiro plano, o que vale no clique de
      transmitir. Pela bandeja, trocar de fonte pode não trazer a janela para a frente.
