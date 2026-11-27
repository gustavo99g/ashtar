# Ashtar Transmissor (Android)

O APK que transmite a tela do AYN Odin 3 para onde você está no Ashtar, numa sala de voz ou numa
ligação ([ADR 0038](../docs/adr/0038-aparelho-de-transmissao.md)). Não é o Ashtar para Android: não
tem chat, voz nem lista de canais.

## Usar

1. Baixe o APK do último run do **CI Android** (artefato `ashtar-transmissor`) e instale no Odin
   (permita instalar de fontes desconhecidas).
2. No Ashtar do computador: Configurações › Voz e vídeo › Aparelhos de transmissão › **Parear um
   aparelho**. Digite o código no Transmissor, com o endereço do servidor.
3. Entre numa sala ou ligação pelo computador. No Odin, toque em **Transmitir** (ou no bloco
   **Transmitir** das Configurações rápidas) e confirme a captura do Android.

Para o grupo, a tela aparece como "Kid · Odin 3", ao lado da tela do computador se ela também
estiver no ar. Se você sair da sala, a transmissão do Odin cai.

## Como funciona

- O pareamento troca o código por uma sessão só do aparelho, que só pede o token da tela
  (`/api/stream-devices/self/*`).
- O vídeo sai pelo MediaProjection, em H.264 pelo encoder de hardware, a 1080p60 (8 Mbps) ou
  720p60 (4 Mbps), numa camada só, como o publicador do computador.
- O áudio do jogo sai pela captura de áudio dos apps do Android (10 ou mais novo); o microfone é
  zerado antes (`GameAudio.kt`). Jogos que bloqueiam a captura saem sem som.
- O nome da trilha segue o formato do app (`screen-share:{"t","q","s"}`), então quem assiste vê
  a qualidade e o horário como numa transmissão do computador.

## Desenvolver

Precisa do JDK 17 e do Android SDK (36). `./gradlew testDebugUnitTest` roda os testes e
`./gradlew assembleRelease -PashtarApiUrl=https://...` gera o APK (assinado com a chave de debug,
para instalar à mão).
