# 0025 — Câmera na sala e na ligação

- **Status:** proposta (passa a aceita com o teste de câmeras da Etapa 14 da v0.4)
- **Data:** 2026-11

## Contexto

A câmera estava no BACKLOG, sem versão, já desenhada no canvas ("Webcam — escolher câmera", "Webcam — câmeras na
sala", "Ligação privada — com câmera"). Ela divide a tela com as transmissões (a fileira de baixo do palco), então
entra na v0.4 junto delas.

A tela sai pelo Rust, porque a captura e o H.264 de hardware precisam dele (ADR 0017). A câmera não: o WebView2 já
abre a câmera com `getUserMedia`, e o `livekit-client` publica com simulcast.

## Decisão

**A câmera sai pelo WebView, na conexão da voz**, com o `setCameraEnabled` do `livekit-client`: 480p, 720p (padrão)
ou 1080p, sempre a 30 fps, com camadas (180p e 360p embaixo da escolhida). O token da voz já deixa publicar; a API
não muda.

**A câmera começa sempre desligada.** Cada entrada (sala, troca de sala, ligação atendida) cria uma `Room` nova, e
sair dela para as trilhas. Ligar é sempre um clique. Desligar tira a trilha da sala (e não só pausa), e a luz da
câmera apaga. A câmera que some (desconectada) desliga com um aviso.

**O botão Câmera fica entre Áudio e Tela**, com a setinha que abre a prévia: só a pessoa vê; o dispositivo, a
qualidade e Espelhar. A escolha fica no `localStorage` (`cameraChoiceStore`), como o microfone, e a aba Voz e vídeo
ganha a seção Câmera com os mesmos campos. Com a câmera ligada, trocar de câmera troca na hora, e trocar a
qualidade publica de novo.

**O app libera a câmera sem perguntar** (`permissions.rs`), como já fazia com o microfone, só para as páginas do
próprio app: ela só abre por um clique da pessoa. A chave de privacidade do Windows continua valendo.

**A câmera aparece no bloco da pessoa** (Grade, fileira do palco e ligação), no lugar do avatar, com o anel de
quem fala por cima. A própria aparece espelhada se a pessoa escolheu; os outros sempre veem sem espelhar.

**A câmera é assinada só com os blocos à vista** (`subscriptions.ts`): na Grade, a camada do meio; na fileira do
palco, a baixa. Na miniatura e fora da sala, nenhuma. A camada é pedida pelo `setVideoQuality`, e não pelo
`adaptiveStream` do plano: o app já escolhe as camadas da tela à mão, e os dois juntos brigam.

**Quem transmite com a câmera ligada** aparece com ela pequena no canto da própria transmissão no palco, em cima do
nome. Na miniatura, não (ela não baixa câmeras).

## Alternativas consideradas

- **A câmera pelo Rust**, como a tela: mais código nativo sem ganho; a câmera não precisa de captura de GPU.
- **Lembrar a câmera ligada** entre as entradas: a câmera ligar sozinha ao entrar numa sala é o erro que mais
  constrange; o clique a mais vale.
- **`adaptiveStream`** para as câmeras: escolheria a camada pelo tamanho do elemento, mas brigaria com o pedido de
  camada que a tela já faz à mão.

## Consequências

- Uma câmera ligada é mais um vídeo que a VPS manda para cada pessoa com os blocos à vista; a medição da Etapa 14
  diz se quatro câmeras e duas transmissões cabem.
- A permissão da câmera muda no Rust e só é conferida no Windows.
- Sinal para rever: câmeras travando a sala em computadores fracos (a 1080p, por exemplo).
