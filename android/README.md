# Ashtar Transmissor (Android)

O APK que transmite a tela do AYN Odin 3 para onde você está no Ashtar, numa sala de voz ou numa
ligação ([ADR 0038](../docs/adr/0038-aparelho-de-transmissao.md)). Não é o Ashtar para Android: não
tem chat, voz nem lista de canais.

## Usar

1. Baixe o APK do último run do **CI Android** (artefato `ashtar-transmissor`) e instale no Odin
   (permita instalar de fontes desconhecidas).
2. No Ashtar do computador: Configurações › Dispositivos › **Parear um aparelho**.
3. No Transmissor, escolha o servidor:
   - **Internet**: o endereço do Ashtar de casa (vem preenchido quando o CI tem a variável
     `VITE_API_URL`).
   - **Local (dev)**: o app procura a API no Wi-Fi sozinho e preenche o IP e a porta. A API precisa
     escutar na rede: `BIND_ADDR=0.0.0.0:3000` no `.env`, com a porta liberada no firewall.
4. Digite os 6 números do código (valem 3 minutos): o pareamento sai sozinho.
5. Logo depois, o Android pergunta se pode pôr o bloco **Transmitir** nas Configurações rápidas.
   Com ele, é puxar a barra e tocar: aparece só a confirmação da captura (o Android sempre pede) e a
   tela vai para onde você está. No ar, o bloco vira **Parar transmissão**.

Na lista da sala, o Odin aparece como uma entrada à parte, com o controle no lugar da foto e o
selo de transmissão: clicar nele assiste. Na tela da chamada, a transmissão é "Kid · Odin 3", ao lado
da tela do computador se ela também estiver no ar. Se você sair da sala, a transmissão do Odin cai.

## Como funciona

- O pareamento troca o código por uma sessão só do aparelho, que só pede o token da tela
  (`/api/stream-devices/self/*`).
- O vídeo sai pelo MediaProjection, em H.264 pelo encoder de hardware, a 720p60 (4 Mbps,
  o padrão) ou 1080p60 (8 Mbps), numa camada só, como o publicador do computador.
- O áudio do jogo sai pela captura de áudio dos apps do Android (10 ou mais novo); o microfone é
  zerado antes (`GameAudio.kt`). Jogos que bloqueiam a captura saem sem som.
- O nome da trilha segue o formato do app (`screen-share:{"t","q","s"}`), então quem assiste vê
  a qualidade e o horário como numa transmissão do computador.

## Desenvolver

Precisa do JDK 17 e do Android SDK (36). `./gradlew testDebugUnitTest` roda os testes e
`./gradlew assembleRelease -PashtarApiUrl=https://...` gera o APK (assinado com a chave de debug,
para instalar à mão).
