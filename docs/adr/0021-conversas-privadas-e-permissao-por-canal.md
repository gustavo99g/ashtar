# 0021 — Conversas privadas e a primeira permissão por canal

- **Status:** aceita
- **Data:** 2026-11

## Contexto

A v0.3 traz a conversa entre duas pessoas. Até aqui, todo membro ativo lê e escreve em todo canal de texto (ADR
0015), e o tempo real é um `broadcast` só: todo evento vai, igual, para todas as conexões. A ADR 0015 já
avisava que as mensagens privadas pediriam "eventos só para os dois", e a 0016, que o canal que só algumas
pessoas veem entraria "como uma regra nova, sem mudar a árvore".

O chat tem muita coisa pronta que a conversa privada quer igual: o envio com `client_id`, o histórico com
cursor, o limite de envio, o rascunho, o "Tentar de novo" e a volta de uma queda pelo `?after=`. A API é um
processo só, com SQLite, e o grupo tem uns dez membros.

## Decisão

**A conversa privada é um canal de tipo `dm`.** Usa a tabela `messages` e as rotas
`/api/channels/{id}/messages` de sempre. A `dm` não tem nome, tópico, categoria nem posição, e nunca aparece no
`GET /api/channels`, no layout nem nos arquivados: toda consulta da árvore pede `kind IN ('text', 'voice')`.

**Um par de pessoas tem uma conversa só.** A coluna `dm_key` guarda os dois ids em ordem (`menor:maior`) e é
única. A tabela `channel_members` diz quem é de cada `dm`. Como o SQLite não altera um `CHECK`, a migração
refaz a tabela `channels` (com `PRAGMA defer_foreign_keys`, porque as mensagens apontam para ela).

**Uma regra de leitura só** (`chat/access.rs`): dado quem pede e o id, devolve o canal de texto aberto, ou a
`dm` de que a pessoa faz parte, ou 404. Toda rota de mensagens passa por ela. Para quem não é da conversa, a
resposta é a mesma de um id que não existe: a API não confirma que a conversa existe.

**Rotas novas:** `POST /api/dms` com `{ user_id }` abre a conversa com alguém, ou devolve a que já existe;
`GET /api/dms` lista as conversas da pessoa que têm pelo menos uma mensagem. Abrir uma conversa e não escrever
nada não aparece para a outra pessoa.

**O tempo real ganha destinatário.** Cada sinal do `Hub` leva para quem é: todos, ou uma lista de pessoas.
Cada conexão descarta o que não é dela antes de escrever no socket. O `message.created` de uma `dm` sai só
para os dois. O `ready` de cada conexão traz os canais de texto, que são de todos, e as conversas só da
própria pessoa.

**Texto puro, e avisado.** As mensagens privadas ficam no banco como as outras, legíveis por quem administra
o servidor. O começo de toda conversa mostra uma linha fixa dizendo isso, e o grupo é avisado no lançamento.

**Quem saiu do grupo:** a conversa continua para quem ficou, só para leitura. Enviar para ela dá 409.

**Testes de vazamento no pipeline:** três pessoas, três conexões; a terceira não lê pelo REST, não envia, não
recebe o evento e não vê a conversa no `ready`.

## Alternativas consideradas

- **Tabelas próprias** (`conversations` e `dm_messages`): não mexe na `channels`, mas duplica o envio, o
  histórico, o cursor, o limite e, no app, o cache e a caixa de saída. Cada recurso futuro do chat (editar,
  reagir, anexos) teria de ser feito duas vezes.
- **Uma tabela `conversations` com as mensagens na `messages`:** a `messages.channel_id` aponta para
  `channels`, então a `messages` é que teria de ser refeita, e ela é a tabela grande.
- **Filtrar no app:** mandar tudo para todos e esconder na tela. Qualquer um com o token leria as conversas dos
  outros pelo socket.
- **Um `broadcast` por conversa:** escala melhor, mas cada conexão passaria a assinar uma lista que muda, para
  um grupo de dez pessoas. O filtro na saída resolve com uma comparação por evento.
- **403 para quem não é da conversa:** mais "correto", mas confirma que aquele id é uma conversa de alguém.
- **Criptografia ponta a ponta:** fora do escopo (roadmap, depois da v1.0). Pede troca de chaves, e a conta
  hoje é ligada a um computador só.
- **Listar a conversa para os dois assim que ela é aberta:** a outra pessoa ganharia uma conversa vazia só
  porque alguém clicou em "Mensagem".

## Consequências

- O chat inteiro (envio, histórico, reconexão, rascunho) serve às conversas sem código novo.
- Toda consulta de canais passa a filtrar o tipo. Uma consulta esquecida quebra ao ler uma `dm`, porque `name`
  e `position` vêm nulos nela: é um erro que aparece, e não um vazamento calado.
- A migração refaz uma tabela referenciada: roda numa cópia do banco de produção antes, com backup.
- O caminho de todo evento passa pelo filtro. A mudança sobe sozinha e roda uns dias antes do resto da v0.3.1.
- A regra de leitura é o lugar onde entra, depois, o canal que só algumas pessoas veem.
- As ligações privadas (ADR 0023) usam a mesma conversa como sala e o mesmo `publish_to`.
- Rever o filtro na saída se a API passar a ter mais de um processo, junto com o `broadcast` (ADR 0015).
