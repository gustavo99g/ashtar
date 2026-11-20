# 0029 — Configurações de voz e atalhos globais

- **Status:** proposta (passa a aceita com o teste de três computadores da Etapa 11 da v0.6)
- **Data:** 2026-11

## Contexto

A aba Voz e vídeo saiu na v0.2.2 só com os dispositivos, e a supressão de ruído entrou na v0.2.3 como um
interruptor (BACKLOG). O resto do quadro "Configurações — voz e vídeo" (volumes, teste de microfone, modo de
entrada, eco, ganho e os padrões da transmissão) ficou guardado para a v0.6, junto do pressionar para falar e dos
atalhos globais. O grupo joga com o Ashtar atrás do jogo: um atalho que só funciona com a janela do Ashtar em foco
não serve.

## Decisão

**O microfone passa por uma cadeia só**, num `AudioContext`, aplicada como processador do LiveKit na trilha
(`setProcessor`, o mesmo caminho do RNNoise desde a v0.2.3): o volume de entrada (ganho de 0 a 200%), o RNNoise (se
ligado) e o portão, nessa ordem. O processador fica na trilha sempre que alguma etapa dele vale alguma coisa. O
medidor e a régua de sensibilidade leem o nível depois do ganho, antes do portão.

**A detecção de voz é um portão, não um mute.** Abaixo da sensibilidade, o portão manda silêncio, mas a trilha
continua publicada e sem o ícone de microfone cortado para os outros. Abre em 10 ms e fecha 300 ms depois de a voz
cair. A sensibilidade automática segue o piso de ruído dos últimos segundos, mais uma margem; a manual é uma régua
de -100 a 0 dB.

**O pressionar para falar é o mesmo portão**, aberto pelo atalho em vez da voz, com os mesmos 300 ms depois de
soltar. Detecção de voz e pressionar para falar são exclusivos. Mutar e ensurdecer continuam desligando o microfone
(`setMicrophoneEnabled(false)`), e ganham do portão.

**Os atalhos globais vêm de um gancho do Windows no Rust** (`WH_KEYBOARD_LL` e `WH_MOUSE_LL`, numa thread com o
próprio laço de mensagens). O gancho só olha: o callback sempre chama `CallNextHookEx`, e o jogo continua recebendo
a tecla. O callback faz o mínimo (copia o evento para um canal), porque o Windows desliga um gancho que demora. O
Rust compara as teclas apertadas com a lista de atalhos que o app mandou e avisa só "apertou" e "soltou" com o nome
do atalho; nenhuma tecla vai para o app nem para o log fora do modo de gravar.

**Atalhos de agora:** Desativar microfone, Desativar áudio, Pressionar para falar, Atender ligação e Recusar ou
desligar. Uma combinação é até três modificadores e uma tecla, ou um botão do mouse (do meio e laterais), com ou sem
modificadores. A mesma combinação não pode estar em duas ações. Os atalhos e o modo de entrada ficam no computador,
no `settingsStore`.

**"Você está mutado"** aparece no painel de voz quando a pessoa fala mutada, lido de um clone da trilha do microfone
(o mute do LiveKit desliga a publicada). **O pressionar para falar tem um som** opcional ao abrir e fechar, que só
quem aperta ouve.

## Alternativas consideradas

- **`RegisterHotKey` (e o plugin de atalhos globais do Tauri):** o Windows entrega a tecla só para quem registrou, e
  o jogo deixa de recebê-la. Não serve para o pressionar para falar (o `V` sumiria do jogo).
- **Raw Input (`RegisterRawInputDevices` com `RIDEV_INPUTSINK`):** também só olha e não prende a tecla, mas exige uma
  janela própria para receber as mensagens e não dá os botões laterais do mouse de um jeito uniforme. O gancho é o
  caminho mais usado por apps de voz.
- **Detecção de voz com mute de verdade (`mute()` da trilha):** cada pausa viraria o ícone de microfone cortado
  piscando para os outros, e o LiveKit renegocia a cada troca.
- **O portão no servidor** (o VAD do LiveKit): o áudio continuaria saindo do computador, e a sensibilidade não seria
  de quem fala.

## Consequências

- Um jogo rodando como administrador não manda as teclas para um app comum (UIPI): o atalho não chega. A aba
  Atalhos explica; o Ashtar não pede administrador.
- Alguns anti-cheats olham ganchos globais. O mesmo caminho é usado pelos apps de voz conhecidos; conferido com os
  jogos do grupo no teste da v0.6.
- O processador fica na trilha quase sempre (o portão está no caminho mesmo com o RNNoise desligado): um custo de CPU
  pequeno, medido na Etapa 1.
- Sinal para rever: o Windows desligando o gancho (atalho que para de funcionar depois de um tempo), ou palavras
  cortadas pela sensibilidade automática.
