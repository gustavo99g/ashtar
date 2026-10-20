# 0011 — Identidade do dispositivo, sessão, convites e permissões

- **Status:** aceita
- **Data:** 2026-10

## Contexto

O Ashtar não tem senha (roadmap, v0.2): o convite é a única forma de entrar, e a identidade vem do próprio
computador, para que formatar o Windows não exija nada. A API é pública (Tailscale Funnel). O grupo é
pequeno, e por enquanto só o dono administra.

## Decisão

**Chave do dispositivo.** O desktop calcula uma chave (o hash do UUID da BIOS e do serial da placa-mãe com
uma constante do app; ou 32 bytes aleatórios guardados no cofre do Windows quando o hardware é genérico) e
a manda à API. Para a API, as duas são iguais: um texto de 32 a 128 caracteres, guardado só como SHA-256.
**Um dispositivo por membro**, garantido por um índice único; liberar mais de um é uma migração que apaga
o índice.

**Sessão.** Entrar com a chave (`POST /api/auth/login`) ou usar um convite devolve um token de sessão
aleatório (32 bytes), guardado só como SHA-256, uma sessão por dispositivo. As chamadas mandam
`Authorization: Bearer <token>`. A sessão não expira sozinha: cai quando o dispositivo é trocado,
desvinculado ou o membro é removido. As permissões são consultadas no banco a cada chamada, nunca guardadas
no token.

**Convites.** Código de 12 caracteres no alfabeto Crockford (60 bits), mostrado como `XXXX-XXXX-XXXX` uma
única vez e guardado só como SHA-256. Dois tipos: **novo** (cria o membro com o nick escolhido) e
**recuperação** (aponta para um membro e troca o computador dele). O novo vale até expirar ou até atingir o
limite de usos (de 1 a 50), o que vier primeiro: 5 minutos e 8 usos para mandar no grupo, 7 dias e 1 uso
(o padrão) para mandar no privado. A recuperação é sempre de uso único. Revogar corta os usos seguintes;
quem já entrou continua. Convites e usos (`invite_uses`) nunca são apagados: são o histórico de quem
convidou quem.

**Permissões.** O **dono** é uma marca no usuário (no máximo um) e pode tudo; só muda pelo `admin`. As
ações de administração (`Action`) passam todas por uma função, `permissions::can`, que hoje responde "só o
dono". Permissões dadas a um usuário (`Permission`) ficam na tabela `user_permissions`; hoje só existe
`atualizacoes.beta`. As chaves das permissões estão no código; o banco guarda só quem tem qual.

**Limite de tentativas.** Até 20 convites errados a cada 10 minutos, somando todo mundo. O login com a chave
do dispositivo fica de fora: a chave tem 256 bits (ou 32 bytes aleatórios), então adivinhá-la é inviável, e
todo app de quem ainda não tem convite chama o login ao abrir. Contar essas chamadas travaria os convites de
todos, e bloquear o login deixaria de fora quem já é membro.

## Alternativas consideradas

- **Mandar a chave do dispositivo em toda chamada, sem sessão:** mais simples, mas a chave é fixa e não dá
  para trocar; um token de sessão pode ser derrubado e trocado sem mexer no computador da pessoa.
- **Sessão com validade (JWT, por exemplo):** tirar uma permissão ou remover alguém só valeria quando o
  token expirasse. Consultar o banco a cada chamada custa nada nesse tamanho.
- **Cargos agora:** o modelo foi pensado para recebê-los (cargos com permissões, permissões diretas, sem
  "negar"), mas para o grupo de hoje bastam dono e membros.
- **bcrypt/argon2 nos segredos:** só fazem diferença contra quem tenta adivinhar senhas fracas. Os três
  segredos aqui são aleatórios e longos.
- **Limite por IP:** atrás do Funnel, todos chegam do mesmo endereço.

## Consequências

- Formatar o Windows não exige nada; trocar a placa-mãe exige um convite de recuperação.
- Alguém errando convites de propósito trava os convites de todos por até 10 minutos; o login de quem já é
  membro continua funcionando.
- Um convite de grupo que vaze, nos minutos em que vale, deixa entrar quem o viu. O limite de usos, a
  validade curta, o `revogar` e o `remover` seguram isso.
- Quem tiver o executável continua conseguindo token pela rota antiga até a parte visual desligar o código
  de acesso e subir a versão mínima.
- Rever quando houver cargos (a tabela de permissões ganha a origem "cargo") ou mais de um dispositivo por
  membro. A administração pela interface está na seção abaixo.

## Administração pela interface (2026-10, v0.2.2)

O Painel de controle do app substitui o `admin` temporário. A API ganha rotas com sessão para o que o
`admin` fazia (criar, listar e revogar convites; listar membros; ver as permissões de um membro; ligar e
desligar o beta; desvincular o computador; criar a recuperação; remover), e cada rota chama as mesmas
funções de `identity/` e passa por `permissions::require`. Ler o painel é uma ação própria,
`Action::ViewPanel`, que hoje responde "só o dono"; o `/api/me` devolve `can_view_panel` ao lado de
`can_create_invite`, e o app esconde o que a pessoa não pode usar. Ao HTTP, os membros são conhecidos pelo
id; buscar pelo nick fica só na linha de comando.

**Os modelos de convite ficam na API.** O app manda o `preset`: `person` (7 dias, 1 uso) e `group`
(5 minutos, 8 usos) com os números da própria API; só `custom` manda validade (de 1 minuto a 30 dias) e
usos (de 1 a 50). O convite guarda o modelo (coluna `preset`, nula só na recuperação), porque deduzi-lo da
validade e dos usos falha quando o "Do seu jeito" escolhe os números de um modelo.

**Nome visível.** Cada membro pode ter um nome visível (`display_name`, nulo quando em branco, e aí aparece
o nick), de 1 a 32 caracteres depois do `trim`, com as regras de caracteres do nick, sem precisar ser único.
O nick continua sendo a identidade: é ele que sai na cor do avatar e nos metadados do token do LiveKit (que
o participante não pode trocar), enquanto o nome do participante na sala é o nome visível. Trocar o nome
vale na próxima entrada na sala. Dois membros podem ter o mesmo nome visível; é um risco aceito para o
grupo, e o nick continua à mão no Painel.

**Antes de ter conta.** `GET /api/invites/{código}` lê um convite sem gastá-lo e sem sessão, para a tela
mostrar quem convidou antes do nick. Ela e as páginas `/convite/{código}` e `/recuperar/{código}` (HTML da
própria API, fora da `ClientPolicy`, para o navegador e a prévia no chat) contam no limite de tentativas
quando o código não vale, como o `redeem`, e respondem igual para inválido, vencido, revogado e esgotado.

**Quase ao vivo sem conexão longa.** A tela do servidor pergunta quem está na sala
(`GET /api/voice/participants`) a cada 5 s; o app do dono compara a lista de membros a cada 30 s para
avisar quem entrou. Não há SSE: o WebSocket do chat (v0.2.3) substitui as duas consultas.

**O `admin` encolhe.** Com o Painel no ar no estável, o `admin` fica só com `dono` (cria o dono antes de
existir qualquer sessão) e `backup` (é o que o Agendador do Windows chama).

Alternativas: manter o `admin` como única forma de administrar (o dono precisaria do computador da API à mão
para cada convite); modelos de convite no app (a tela, o `admin` e a API poderiam discordar dos números);
nome visível único (atrapalha apelidos repetidos sem ganhar nada, já que o nick é o identificador); SSE
agora (ver ADR 0012).
