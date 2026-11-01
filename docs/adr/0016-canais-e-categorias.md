# 0016 — Canais e categorias

- **Status:** aceita
- **Data:** 2026-10

## Contexto

O roadmap punha os vários canais de texto na v0.5 e um canal só, o `#geral`, na v0.2.3. No levantamento
(31/10), o pedido mudou: a v0.2.3 já sai com vários canais de texto, agrupados em categorias que também vão
guardar as salas de voz (e, um dia, outros tipos de canal), arrumados arrastando, e com uma permissão para
quem pode criá-los e editá-los. A sala de voz Sala, até aqui, é só uma constante no app (`SALA`).

## Decisão

**Uma árvore de dois níveis.** Categorias (`categories`) guardam canais (`channels`), cada um com um `kind`
(`text` ou `voice`; outro tipo entra por migração). Canal sem categoria fica no topo. A ordem é um campo
`position` em cada um. A migração cria a categoria "Texto" com o `#geral` e a "Voz" com a Sala, que
vira uma linha do banco com o mesmo id `sala` (o nome da sala no LiveKit não muda).

**Só canais de texto são criados agora.** Criar sala de voz continua na v0.5; na v0.2.3, a Sala só é
movida e renomeada.

**Arquivar, e não apagar.** Arquivar esconde o canal (ou a categoria) de todos e guarda as mensagens;
desarquivar devolve com o histórico. Arquivar uma categoria manda os canais dela para o topo. O `#geral` e
a Sala não podem ser arquivados, para sempre existir um canal de cada tipo.

**Arrumar é mandar a árvore inteira.** Depois de um arrasto, o app manda `PUT /api/channels/layout` com
todas as categorias e canais em ordem, mais a versão da árvore que tinha. A API grava numa transação só;
se a versão mudou no meio (outra pessoa mexeu), responde 409, e o app recarrega em vez de sobrescrever.
Qualquer mudança sai num evento só, `channels.changed`, com a árvore nova.

**A permissão `canais.gerenciar`.** Uma `Permission` guardada por pessoa, ao lado de `atualizacoes.beta`,
ligada pelo dono no Painel com o mesmo interruptor do beta. O dono sempre pode. Ela cobre criar, editar,
mover e arquivar canais e categorias.

**No app**, cada categoria é um rótulo de texto com uma seta que recolhe e abre os canais dela; o que fica
recolhido é gravado só no computador de cada um. Recolhida, ela ainda mostra o canal aberto, a sala em que
você está e as salas com gente, numa linha só de avatares (até 5 e um "+N"). O arrasto usa o `@dnd-kit`,
que também funciona pelo teclado, e o menu de cada item tem Mover para cima e Mover para baixo.

## Alternativas consideradas

- **Um canal só na v0.2.3 e os outros na v0.5** (o roadmap até 31/10): o banco já nasceria com a tabela,
  mas o grupo pediu os canais junto com o chat.
- **Categoria só para canais de texto:** as salas de voz da v0.5 precisariam de outra forma de agrupar.
- **Apagar canal de vez:** não se desfaz, e as mensagens iriam junto.
- **Um evento por tipo de mudança** (`channel.created`, `channel.moved`…): para uns 10 canais, mandar a
  árvore inteira é mais simples e não deixa o app montar a ordem errada.
- **Gravar cada arrasto como "mova X para depois de Y":** duas pessoas arrastando juntas embaralhariam a
  ordem sem ninguém ver.
- **Gerenciar canais só para o dono** (como as ações do Painel): o pedido foi poder dar a outras pessoas.

## Consequências

- O `GET /api/channels` passa a ser a fonte de quais canais e salas existem; a constante `SALA` do app
  sai.
- A v0.5 só acrescenta criar sala de voz e o resto da presença; os canais de texto já existem.
- Canal que só algumas pessoas veem (a primeira permissão por canal, v0.3) entra como uma regra nova, sem
  mudar a árvore.
- Rever se a árvore precisar de mais de dois níveis ou se o número de canais crescer a ponto de a árvore
  inteira pesar em cada evento.
