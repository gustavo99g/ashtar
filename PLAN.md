# Plano — v0.2.4: publicador nativo

A transmissão de tela sai do WebView: a captura, a redução, a conversão e o encoder passam a rodar na GPU, e o
vídeo e o áudio são publicados direto do Rust numa segunda conexão, `{user_id}:screen`. Junto vêm o seletor de
fontes refeito e o controle da transmissão em andamento. Sai como `0.2.40` (`docs/roadmap.md`). O plano da fase
anterior está arquivado em [`docs/plans/v0.2.3-chat.md`](docs/plans/v0.2.3-chat.md).

**Objetivo desta fase:** transmitir 1080p60 com custo quase zero para a máquina de quem transmite, sem o custo
crescer com a resolução do monitor; o seletor mostra todas as janelas, com miniaturas ao vivo; e a transmissão
pode ser ajustada sem parar.

**Fora do escopo:** o servidor próprio (v0.2.5; a fase roda sobre o LiveKit Cloud), os clipes das transmissões e
o replay dos jogos (v1.1; aqui só a base, decisão 5), saída acima de 1080p60, simulcast, HEVC e AV1, câmera,
Linux e o pressionar para falar (v0.6).

Base: a `dev` no `773d66a` (`0.2.30`), mais o `encoder-probe` da Etapa 0. Em cada etapa, `cargo fmt --check`,
`cargo clippy --all-targets -- -D warnings` e `cargo test` (em `api/` e em `desktop/src-tauri/`) e `pnpm lint`,
`pnpm build` e `pnpm test` (em `desktop/`) devem passar.

## Progresso

| Etapa | Descrição | Status |
|---|---|---|
| 0 | Decisões: experimento (`6472945`), ADRs 0017 a 0019, roadmap, BACKLOG | Concluída |
| 1 | Captura própria pelo WGC, lista de janelas, foco e exclusão do app | Pendente |
| 2 | Vídeo na GPU: conversão, encoder, plano B, bitrate e destinos | Pendente |
| 3 | Publicador `:screen` (vídeo e áudio), sessão, comandos, logs e teste de ponta a ponta | Pendente |
| 4 | API: token da `:screen`, participantes e kick | Pendente |
| 5 | App: transmissão nativa, seletor com miniaturas, painel e bandeja; sai o IPC | Pendente |
| 6 | Medição contra a `0.2.30` e bitrates dos presets | Pendente |
| 7 | Lançamento: `0.2.40` no beta e no estável | Pendente |

A 2 usa a captura da 1, a 3 usa o vídeo da 2, e a 5 usa os comandos da 3 e o token da 4. A 4 pode andar em
paralelo desde o começo. O caminho de hoje (IPC) continua funcionando até a Etapa 5, que é onde ele sai.

Branches: tudo na `feature/0.2.4`, um pull request por etapa para dentro dela. A Etapa 4 também vai para a `dev`
logo que fica pronta: só acrescenta uma rota, e o app instalado não percebe. Nada do app é publicado até a
Etapa 7, que leva a `feature/0.2.4` para a `dev` (beta) e depois para a `main`.

## Decisões

As decisões de arquitetura estão nas ADRs, que são a fonte:
[`0017-publicador-nativo.md`](docs/adr/0017-publicador-nativo.md) (a conexão `:screen`, o vídeo já codificado, o
áudio, o fim do IPC), [`0018-captura-pelo-wgc-e-video-na-gpu.md`](docs/adr/0018-captura-pelo-wgc-e-video-na-gpu.md)
(a captura, o dispositivo, a conversão, o encoder, o bitrate) e
[`0019-seletor-de-fontes.md`](docs/adr/0019-seletor-de-fontes.md) (a lista, as miniaturas, o foco, a exclusão do
app). Abaixo, o que foi combinado para esta fase e o que o plano decidiu além disso.

### Combinado

- **Solução definitiva, sem passo intermediário:** captura, vídeo e envio no Rust de uma vez, e não um caminho
  IPC mais leve.
- **Teto de 1080p60**, mesmo num monitor 4K. Os presets passam a ser **Movimento** (1080p60) e **Nitidez**
  (1080p30, com mais bits por quadro, para texto); os bitrates saem da Etapa 6.
- **Encoder de hardware do Media Foundation**, medido na Etapa 0. **Sem encoder de hardware, plano B:** a imagem
  já reduzida vai para o codificador de software da crate `livekit`, e o painel mostra "Software".
- **Seletor com todas as janelas, inclusive as minimizadas**, com o selo "Minimizada". **Escolher uma fonte traz
  a janela para a frente** (restaurando, se estiver minimizada) **e minimiza o app.**
- **Miniaturas ao vivo pelo WGC, a 5–10 fps**, só dos cards visíveis e só com o seletor aberto. Adianta as
  miniaturas da v0.8 do roadmap. **O preview de quem transmite reaproveita a miniatura** da fonte em uso.
- **Ajustar a transmissão em andamento**, sem parar: preset, fonte, áudio, cursor e pausa, num painel da própria
  transmissão.
- **Bandeja durante a transmissão** ("Abrir o painel", "Pausar"/"Continuar", "Parar de transmitir"),
  **estatísticas** no painel (fps, bitrate, encoder, aviso de rede limitando) e **quem está assistindo**.
- **O IPC sai nesta fase, sem chave para voltar.** Já se mostrou pesado (ADR 0009 e a Etapa 0), e manter os dois
  caminhos dobraria as Etapas 1 a 6. A rede de segurança é o canal beta.
- **Logs do pipeline** no arquivo de log e **teste de ponta a ponta** com um LiveKit local.
- **Clipes e replay ficam para depois** (v1.1). Esta fase só deixa a saída do encoder pronta para isso.

### Decidido neste plano

1. **Captura própria pelo WGC**, para telas e janelas, no lugar do `DesktopCapturer` do libwebrtc: ele não lista
   nem captura janelas minimizadas e entrega a imagem na memória. Sem a borda amarela e com o cursor.
2. **Um dispositivo D3D11 por transmissão**, dividido pela captura, pela conversão e pelo encoder, com a proteção
   multithread ligada. Por transmissão, e não global, para que um dispositivo perdido encerre só aquela.
3. **Redução e conversão para NV12 na GPU** pelo `ID3D11VideoProcessor`, em BT.709 de faixa limitada. A saída tem
   sempre o tamanho do preset, com a imagem centralizada: a janela mudando de tamanho não reinicia o encoder.
4. **A codec API do encoder antes dos tipos de mídia.** No driver da AMD, configurada depois, o encoder volta para
   30 fps. O encoder é escolhido pela placa do dispositivo (`MFTEnum2` com o LUID).
5. **A saída do encoder tem mais de um destino** (`PacketSink` e `Fanout`): o publicador agora; o buffer de clipes
   e replay na v1.1.
6. **Bitrate corrigido pelo medido**, a cada ~1 s, para seguir o alvo da LiveKit mesmo com o fps variando.
7. **Só imagens novas são codificadas.** Com a tela parada, a última é reenviada a cada ~1 s.
8. **Publicação já codificada pela crate `livekit`** (0.9.1): `NativeVideoSource::new_encoded`, H.264, sem
   simulcast. Os pedidos de keyframe e de bitrate da LiveKit vão para o encoder. No plano B, VP8.
9. **Áudio da transmissão pelo `NativeAudioSource`**, direto do WASAPI, no mesmo relógio do vídeo.
10. **Uma conexão só para a tela, `{user_id}:screen`**, com um token que só publica a tela e o áudio dela, não
    assina nada e vale 5 minutos para entrar. Para o resto do app, ela é "a tela de fulano".
11. **O Ashtar nunca aparece numa captura** (`WDA_EXCLUDEFROMCAPTURE`).
12. **Pausar silencia a trilha de vídeo** (`mute`), e quem assiste vê "Transmissão pausada" sobre a última imagem.
13. **Quem está assistindo vai por mensagem de dados** na conexão da voz (tópico `screen-viewers`).
14. **Falha sem transmissão fantasma:** se a captura, o encoder ou a conexão falharem, a `:screen` sai da sala na
    hora e o app avisa uma vez.

---

**Critério de pronto da fase:** transmitir 1080p60 de um monitor 4K com a CPU da máquina abaixo de ~2% e o fps
cravado; o seletor com as minimizadas e as miniaturas; o IPC removido; a medição contra a `0.2.30` registrada na
ADR 0017; e todos os itens do `NOTES.md` resolvidos ou conscientemente adiados.
