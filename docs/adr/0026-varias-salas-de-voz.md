# 0026 — Várias salas de voz, trocar, mover e desconectar

- **Status:** proposta (passa a aceita com o teste de três computadores da Etapa 15 da v0.5)
- **Data:** 2026-11

## Contexto

Até a v0.4 o app tinha uma sala só. O banco e a API já guardavam salas de voz como canais (`kind = voice`, ADR
0016), e o `POST /api/voice/token` já aceitava qualquer sala aberta, mas o diálogo de criar canal só criava canal de
texto e o app lia a constante `SALA` em doze arquivos. Com o grupo maior, as noites pedem mais de uma sala, e
alguém precisa poder levar uma pessoa de uma sala para outra sem pedir que ela saia e entre de novo.

## Decisão

**Sala de voz é um canal como os outros.** Quem tem "Gerenciar canais" cria, renomeia e arquiva uma sala de voz pelo
mesmo menu, pelo mesmo diálogo (com a escolha Texto/Voz) e pelo mesmo modo Organizar dos canais de texto. O nome vai
de 1 a 32 caracteres (`validate_label`), e sala de voz não tem tópico. Não há limite de pessoas por sala.

**O app não guarda sala fixa.** A sala conectada é um id no `VoiceProvider`, e o painel de voz, o alto da sala, a
volta da ligação, o aviso de atualização e a lista de pessoas leem esse id e o nome dele na lista de canais. A Sala
continua no banco como a linha `sala`, pode ser renomeada, mas **não pode ser arquivada**, como o `#geral`: alguma sala
de voz precisa existir sempre, e o app antigo ainda entra nela pelo id.

**Arquivar uma sala com gente dentro** apaga a sala no LiveKit (`delete_room`). O app de cada um vê o
`ROOM_DELETED`, sai da sala e avisa "A sala foi arquivada".

**Trocar de sala é um clique** numa outra sala, já conectado: sai da atual e entra na nova pelo mesmo caminho, sem
passar pela tela vazia. A câmera e a transmissão são da sala e acabam; por isso, transmitindo ou com a câmera
ligada, o clique pergunta antes ("Trocar para a X?"), com a chave para não perguntar mais
(`askBeforeSwitchRoom`). O microfone e o surdo continuam.

**"Mover membros" (`membros.mover`) é uma permissão nova**, dada por pessoa no Painel. O dono tem todas.
"Desconectar da voz" usa a mesma.

**Mover é a pessoa trocar de sala sozinha, por ordem da API.** O `POST /api/voice/move` confere a permissão, a sala
de destino (uma sala de voz aberta, diferente da atual) e que a pessoa está numa sala de voz, e manda
`voice.moved { channel_id, by, by_name }` só para as conexões dela. O app dela troca pelo caminho da troca normal,
sem perguntar, e avisa "fulano moveu você". Se ela não sair da sala antiga em 10 segundos (app antigo ou travado),
a API a tira de lá com o `remove_participant`. Onde cada um está vem da lista que o hub guarda a cada
`voice.participants` (os webhooks do LiveKit) e, sem ela, do próprio LiveKit.

**Desconectar** (`POST /api/voice/disconnect`) manda `voice.disconnected { by, by_name }` para a pessoa e tira as
duas conexões dela (a da voz e a `:screen`). O app dela sai com o aviso "Você foi desconectado da voz" e não
reconecta sozinho.

**No cartão** de quem está numa sala, para quem tem a permissão e nunca no próprio: "Mover para" (as outras salas)
e "Desconectar da voz", em vermelho, sem pergunta.

**Arrastar uma pessoa para outra sala** na lista de canais faz o mesmo que "Mover para". Só quem tem a permissão
arrasta, só os avatares dentro das salas, fora do modo Organizar. É uma exceção à regra "arrastar só no modo
Organizar" da ADR 0020: ali nada da lista muda de lugar.

## Alternativas consideradas

- **`MoveParticipant` do LiveKit:** move a conexão sem o app saber, mas o app precisa de um token novo de qualquer
  jeito (o token é de uma sala), e a `:screen` do publicador nativo é outra conexão. A ordem para o app é mais
  simples e serve à câmera e à transmissão do mesmo jeito.
- **A Sala especial para sempre:** mantinha os doze `SALA`, e qualquer tela nova teria de lembrar dela.
- **A Sala arquivável**, como as outras: um grupo sem nenhuma sala de voz ficaria sem a entrada do app antigo e sem
  o lugar padrão da volta da ligação. Renomear basta.
- **Arrastar só no modo Organizar:** mover alguém é coisa de um momento da conversa; entrar num modo para isso é
  passo demais.

## Consequências

- O app antigo (`0.4.x`) ignora o `voice.moved`; os 10 segundos garantem que ele não fica em duas salas.
- A lista de quem está em cada sala passa a ser estado do hub, além de evento.
- Mover é poder sobre os outros: a pessoa sempre fica sabendo quem moveu ou desconectou.
- Sinal para rever: pedidos de "puxar todo mundo para cá" ou de limite de pessoas por sala.
