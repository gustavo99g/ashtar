# 0028 — Canais e salas restritos

- **Status:** proposta (passa a aceita com o teste de três computadores da Etapa 15 da v0.5)
- **Data:** 2026-11

## Contexto

Até a v0.4, todo membro lê e escreve em todo canal de texto e entra em toda sala de voz (ADR 0016). A ADR 0021 já
previa o canal que só algumas pessoas veem como uma regra nova na regra de leitura. Com várias salas, o grupo pediu
um canal e uma sala só para parte dele.

## Decisão

**Qualquer canal de texto ou sala de voz pode ser restrito** a uma lista de pessoas (`channel_members`, a tabela
das conversas privadas, com `channels.restricted`). A lista vai junto do canal para quem o vê, e o app a usa na
sugestão do @ e no "Mover para". Sem restrição, é de todos. Quem tem "Gerenciar canais" liga a restrição e escolhe as
pessoas no diálogo de criar e de editar ("Quem tem acesso").

**Para quem está fora, o canal não existe.** A API devolve o mesmo `NotFound` de um id que não existe, e não manda
nada dele: nem na lista de canais, nem as mensagens, as não lidas, as menções, o "digitando…", quem está na sala, o
"começou a transmitir". Uma categoria em que a pessoa não vê nenhum canal some para ela.

**O dono e quem tem "Gerenciar canais" veem todos**, para poder editar as listas, e o diálogo diz isso.

**A trava é da API.** A regra de leitura (`chat/access.rs`) ganha o terceiro caso: o canal restrito só é lido por
quem está na lista ou gerencia os canais. O `POST /api/voice/token`, o mover e a lista de quem está em cada sala
passam pela mesma regra (`can_access`), e cada evento de um canal restrito sai só para as conexões de quem tem
acesso, como as mensagens privadas. Quem recebe é calculado no banco a cada evento (`access::audience`), sem cache: o grupo é
pequeno, e um cache desatualizado vazaria. O `ServerEvent::of_channel` marca os eventos de canal, e o `publish` para
todos recusa um deles nos testes. Vale também para um app antigo.

**Perder o acesso tira a pessoa na hora.** O canal some da lista dela (um `channels.changed`); se estava com ele
aberto, o app volta ao primeiro canal; se estava na sala, a API a tira com o aviso "Você não tem mais acesso a esta
sala". "Mover para" e o arrastar não oferecem uma sala a quem está fora dela, e a menção a quem não tem acesso não
notifica.

## Alternativas consideradas

- **Papéis (cargos) com permissões por canal**, como o Discord: é o caminho certo para um grupo grande, e pesado
  para um grupo de amigos. A lista de pessoas resolve hoje e cabe numa migração para cargos depois.
- **Esconder no app:** qualquer um com o token leria o canal. A trava tem de ser na API.
- **Quem gerencia só vê o que está na lista:** não teria como editar a lista de um canal de que não faz parte.

## Consequências

- Toda consulta e todo evento com `channel_id` passa pela regra; um teste falha quando um tipo novo do
  `ServerEvent` com `channel_id` não passa pelo filtro.
- A lista de canais passa a ser por pessoa: o `channels.changed` não carrega a lista, só avisa para buscar de novo.
- A busca de mensagens da v0.7 nasce passando pela `can_access`.
- Sinal para rever: listas iguais repetidas em vários canais, que pediriam cargos.
