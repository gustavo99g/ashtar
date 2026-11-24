# 0035 — Encoder AMF da AMD como reserva do Media Foundation

- **Status:** proposta (passa a aceita quando a RX 7600 transmitir pelo AMF)
- **Data:** 2026-11
- **Plano:** `docs/plans/v0.8-amf.md`

## Contexto

O vídeo da transmissão sai pelo encoder H.264 da placa, pelo Media Foundation (ADR 0018). Numa RX 7600 (RDNA3,
Windows 11 build 26300), o `AMDh264Encoder` abre sem erro, aceita um quadro e para: não pede outra entrada, não
devolve saída e não manda evento de erro. Isso acontece com a textura na GPU e com a imagem na memória. A RX 9060 XT e
as NVIDIA funcionam pelo mesmo caminho.

Desde a 0.8.3, um teste antes de publicar pega o caso em 1,5 s e a transmissão vai para o plano B (VP8 no processador),
que pesa nos jogos que já usam muito a CPU. O Discord e o OBS falam direto com a biblioteca de cada fabricante (NVENC,
AMF, Quick Sync), sem o Media Foundation no meio.

## Decisão

**O AMF entra como reserva, só na AMD.** A ordem é o Media Foundation com a textura na GPU, depois o AMF direto (numa
placa AMD em que o primeiro não passe no teste) e, por fim, o plano B. Quem já funciona não muda nada. Os dois encoders
passam pelo mesmo teste e entregam o mesmo H.264 em Annex B, com o SPS e o PPS em todo IDR (`h264.rs`), então o
publicador, os keyframes sob pedido e o controle de bitrate não mudam.

**Sem dependência nova.** O AMF vem com o driver da AMD (`amfrt64.dll`). O app carrega a DLL na hora e chama
`AMFInit`; as poucas vtables usadas são escritas à mão a partir dos cabeçalhos públicos do SDK (licença MIT), com
testes do tamanho de cada uma. O AMF só é chamado numa placa com o vendor id da AMD.

**O app lembra onde o Media Foundation trava.** Quando ele falha numa AMD e o AMF funciona, a placa e a versão do
driver vão para `encoder-da-placa.json`, na pasta de dados do app, e as próximas transmissões nela começam pelo AMF,
sem os 1,5 s do teste. Um driver novo é outra chave e testa tudo de novo. Só esse caso é lembrado: uma falha passageira
nunca prende a placa no plano B.

**A tentativa com a imagem na memória (0.8.4) sai.** Ela não resolveu na RX 7600 e somava 1,5 s no começo de toda
transmissão numa placa com problema.

**Para testar:** `ASHTAR_ENCODER=amf`, `=mf` ou `=software` força um caminho. O `amf-probe`
(`cargo run --example amf_probe --release`) valida o AMF numa placa sem abrir o app.

## Consequências

- Uma posição errada numa vtable derruba o app em vez de dar erro. Por isso o `amf-probe` roda numa AMD antes, e o AMF
  só é chamado depois de o Media Foundation falhar.
- Se o AMF se mostrar melhor que o Media Foundation na AMD, inverter a ordem é trocar uma linha (`encoder_memory::order`).
- NVENC e Quick Sync diretos, HEVC e AV1 ficam de fora: o Media Foundation funciona nessas placas.
- Trocar de encoder no meio de uma transmissão continua impossível: o tipo da trilha é decidido na publicação.
