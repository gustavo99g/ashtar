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

**Limite de tentativas.** Até 20 convites ou logins errados a cada 10 minutos, somando todo mundo.

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
- Alguém errando convites de propósito trava os convites de todos por até 10 minutos.
- Um convite de grupo que vaze, nos minutos em que vale, deixa entrar quem o viu. O limite de usos, a
  validade curta, o `revogar` e o `remover` seguram isso.
- Quem tiver o executável continua conseguindo token pela rota antiga até a parte visual desligar o código
  de acesso e subir a versão mínima.
- Rever quando houver cargos (a tabela de permissões ganha a origem "cargo"), mais de um dispositivo por
  membro, ou administração pela interface.
