# 0038 — Aparelho de transmissão (Odin 3)

- **Status:** proposta (passa a aceita com o primeiro teste no Odin 3 numa sala e numa ligação)
- **Data:** 2026-11

## Contexto

O Kid joga no AYN Odin 3 (um portátil Android) e quer que o grupo veja. Portar o Ashtar para Android está fora de
cogitação por enquanto. Ele pediu em 27/11 um APK só para o Odin: um botão Transmitir, e a tela vai para onde ele está
no Ashtar, numa sala de voz ou numa ligação. O Odin fica ligado a ele, mas é **outra fonte**: o PC e o Odin podem
transmitir ao mesmo tempo. Se ele sair da sala, o Odin cai junto.

Duas coisas do Ashtar de hoje atrapalhavam: cada membro tem um dispositivo só (o convite de recuperação troca o
computador), e cada pessoa tem uma tela só (`{id}:screen`, ADR 0017).

## Decisão

**O aparelho é do membro, mas não é o dispositivo dele.** Uma tabela própria, `stream_devices` (até 3 por pessoa),
com o token da sessão guardado como SHA-256. Esse token não passa no `CurrentUser`: o aparelho não chega a nenhuma
rota do app, só às `/api/stream-devices/self/*`, pelo `CurrentStreamDevice`. Cai quando o dono desvincula ou é
removido.

**Pareamento pelo app.** Configurações › Voz e vídeo › Aparelhos de transmissão gera um código no formato do convite
(`XXXX-XXXX-XXXX`), que vale 10 minutos e uma vez só (`stream_pair_codes`). O aparelho manda
`POST /api/stream-devices/pair { code, name }` e recebe a sessão. O pareamento conta no limite de tentativas, como o
convite.

**A permissão "Transmitir de um aparelho"** (`transmissao.aparelho`) libera parear e pedir o token. Ninguém recebe de
saída: só o dono tem. Abrir para outros é dar a permissão em Membros.

**Outra identidade na sala:** `{id}:screen-{aparelho}`, ao lado da `{id}:screen` do computador. O dono é o que vem
antes do primeiro `:` (nenhum id de membro tem `:`). O token leva nos metadados o nome do aparelho
(`{"screenOf": id, "nick": "...", "source": "Odin 3"}`), e quem assiste vê "Kid · Odin 3".

**Na lista da sala, o aparelho é uma entrada à parte** (pedido do Kid no primeiro teste): o controle no lugar da
foto, o nome do aparelho e o selo de transmissão, e clicar já assiste (sem cartão de perfil). A tela do aparelho
não marca o dono como transmitindo: só a do computador marca. A API manda os aparelhos no `devices` da entrada do
dono (`ParticipantView`), e o aviso "começou a transmitir" sai para cada aparelho, com o nome dele. No app, cada transmissão
tem uma chave: a do computador continua sendo o id do dono, e a do aparelho é a identidade inteira; tudo que guarda
algo por transmissão (aberta, foco, volume, à vista) usa a chave. A do próprio aparelho não é "a própria
transmissão": o dono pode assistir.

**Para onde vai:** `POST /api/stream-devices/self/screen-token` sem sala. A API procura o dono: a ligação atendida
(banco), depois a lista das salas no hub, depois todas as salas da LiveKit. Valem as regras do token da tela de sempre
(estar na sala pela voz, o limite de transmissões, agora contando cada conexão). Sem o dono em lugar nenhum, 409.

**Segue o dono:** quando a voz dele sai de uma sala (o webhook da LiveKit), as telas dos aparelhos dele nessa sala
caem. Desconectar, mover, encerrar a transmissão pela moderação e remover o membro também derrubam as dele. Trocar de
sala não leva a transmissão junto: ele aperta Transmitir de novo.

**Fora da versão mínima do app.** As rotas do aparelho ficam fora da `ClientPolicy`: o APK tem versão própria.

**O contrato com o APK** é o mesmo de uma tela do computador: publicar `screen_share` (H.264) e, se der,
`screen_share_audio`, com o nome da trilha `screen-share:{"t": <ms>, "q": "1080p60" | "720p60" | ..., "s": "<título>"}`
(`shareInfo.ts`).

## Consequências

- O PC e o Odin transmitem ao mesmo tempo, e cada um conta uma no limite da sala (6 por padrão).
- Outro membro pode ganhar um aparelho só com a permissão; o que falta para isso é distribuir o APK (hoje instalado à
  mão) e testar outros aparelhos Android.
- Sem o webhook da LiveKit (o `--dev` sem configuração), o aparelho não cai sozinho quando o dono sai; o APK percebe ao
  pedir o token de novo.
