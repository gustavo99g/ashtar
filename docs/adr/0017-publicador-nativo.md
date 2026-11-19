# 0017 — Publicador nativo: a tela publicada pelo Rust, numa conexão `:screen`

- **Status:** proposta (vira aceita com os números da Etapa 6 da v0.2.4)
- **Data:** 2026-11
- **Atualizada por:** 0024 (várias transmissões por sala; a camada leve sai do experimento da v0.4)

## Contexto

Desde a v0.1, a tela vai do Rust ao WebView pelo IPC do Tauri e o WebView a publica na LiveKit (ADR 0007): o
Rust captura e converte para I420 na CPU, manda cada frame por um `Channel`, e o React o embala num
`MediaStreamTrackGenerator` para o libwebrtc do navegador codificar. O áudio faz o mesmo caminho e passa por um
jitter buffer num `AudioWorklet`. A ADR 0007 já era provisória, e a ADR 0009 mediu o custo: num monitor 1080p,
5–10 ms de redução e 2–3 ms de conversão por frame, mais a cópia, mais o encoder de software do navegador. Num
monitor 4K, o custo cresce com a resolução, e o relógio do `AudioContext` desalinha o áudio.

O experimento da Etapa 0 (`desktop/experiments/encoder-probe`) mediu o caminho inteiro na GPU, até o H.264 de
hardware: 1080p60 de uma tela 4K com ~0,7% de CPU e 5,8 ms da captura ao H.264 na mediana, sem descartes.

## Decisão

**A transmissão é publicada pelo Rust.** O app abre uma segunda conexão na mesma sala, com a identidade
`{user_id}:screen`, só para a tela e o áudio dela. A conexão da voz continua no WebView.

**O vídeo vai já codificado.** Com o encoder de hardware (ADR 0018), a trilha é `NativeVideoSource::new_encoded`
com `VideoEncoderBackend::PreEncoded`, H.264, sem simulcast: a LiveKit só embala os pacotes. Os pedidos de
keyframe e de bitrate da LiveKit voltam para o encoder. A trilha anuncia o teto (10 Mbps e 60 fps), e o pipeline
limita ao preset atual: trocar o preset no meio não republica a trilha. Sem encoder de hardware (plano B), a
trilha é a comum, e o libwebrtc codifica o NV12 já reduzido em VP8.

**O áudio vai pelo `NativeAudioSource`**, direto do WASAPI, sem DTX, RED, cancelamento de eco, supressão de
ruído nem ganho automático (é música e jogo, não voz). Acaba o jitter buffer no `AudioWorklet`.

**O token da tela** (`POST /api/voice/screen-token`) só vale para quem já está na sala pela voz, só publica a
tela e o áudio dela, não assina nada, não manda dados e vale 5 minutos para entrar. Para o resto do app e para
a API, a `:screen` é "a tela de fulano": não aparece como participante, só marca o dono como transmitindo, e
tirar alguém da sala tira as duas conexões. O app nunca assina a própria `:screen`.

**Pausar silencia a trilha de vídeo** (`mute`). Quem assiste vê "Transmissão pausada" sobre a última imagem.

**Quem está assistindo** vai por mensagem de dados na conexão da voz (tópico `screen-viewers`): a LiveKit não
conta a ninguém quem assina a trilha de outro.

**O caminho IPC sai inteiro**, sem chave para voltar: `video_capture.rs`, `ipc_sink.rs`, `gate.rs`, `session.rs`
e os comandos `ipc_*` no Rust; o `IpcScreenShare`, o áudio pelo `AudioWorklet` e o `MediaStreamTrackGenerator` no
frontend.

## Alternativas consideradas

- **Um IPC mais leve** (frames menores, NV12 em vez de I420, a redução na GPU antes do readback). Tira parte do
  custo, mas mantém o encoder de software do navegador e o áudio pelo `AudioWorklet`, e o custo continua
  crescendo com a resolução. Descartado no combinado: a solução definitiva de uma vez.
- **O vídeo pela mesma conexão da voz, publicado pelo Rust.** A LiveKit não aceita duas conexões com a mesma
  identidade, e o WebView precisa da dele para a voz. Daí a `:screen`.
- **Codificar no Rust e passar o H.264 ao WebView** (Encoded Transform). Junta o pior dos dois: o IPC de volta, e o
  navegador ainda decide o ritmo.
- **Manter os dois caminhos atrás de uma chave.** Dobraria o trabalho de cada etapa e os testes. A rede de
  segurança é o canal beta.

## Consequências

- O custo de transmitir não cresce com a resolução do monitor, e a CPU de quem transmite fica perto de zero.
- A `:screen` conta como mais um participante no LiveKit Cloud enquanto a VPS não entra (cerca de 1 minuto a
  mais por minuto de transmissão).
- A ADR 0007 fica substituída, e a 0009 vale só para a história do caminho IPC.
- O app depende da `NativeVideoSource::new_encoded` da crate `livekit` 0.9.1; uma atualização da crate precisa do
  teste de ponta a ponta (`media/share_e2e.rs`).
- Sinal para rever: um encoder de hardware que não serve para o grupo (o plano B fica pesado demais), ou a
  LiveKit mudar o suporte a trilhas já codificadas.

## Medição (Etapa 6)

A preencher com a tabela da Etapa 6: a `0.2.30` e a `0.2.40` lado a lado, por preset.
