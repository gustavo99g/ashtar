# 0032 — Chat avançado

- **Status:** proposta (passa a aceita com o teste de três computadores da Etapa 15 da v0.7)
- **Data:** 2026-11

## Contexto

O chat da v0.2.3 (ADR 0016) manda e lê texto; a v0.3 trouxe as conversas privadas, as menções e as não lidas
(ADRs 0021 e 0022). Desde a v0.2.3, a tabela `messages` tem `edited_at` e `deleted_at` esperando a v0.7, e o canvas
tem as reações, o arquivo anexado, as fixadas e a busca desenhados. Os quadros "Chat avançado (0.7)" fecham o resto
(20/11).

## Decisão

**A tabela `messages` é refeita numa migração só** (o SQLite não muda um `CHECK`): o texto pode ser vazio quando há
anexo, e entram `reply_to`, `pinned_at`, `pinned_by` e o resumo da mensagem encaminhada. Os eventos novos são
`message.updated` (a mensagem inteira) e `message.deleted`, com a mesma audiência do `message.created`.

**Editar:** só o autor, sem limite de tempo, só o texto, com "(editada)"; sem histórico; não conta como não lida; a
menção nova notifica quem não era mencionado antes. **Excluir:** o autor, e o dono numa mensagem de canal; apaga a
mensagem de verdade, com as menções, as reações e os arquivos (o `deleted_at` fica sem uso). **Responder:** a citação de uma linha, com `@` ligado por
padrão, e o histórico em volta carregado por `?around=<id>`, com a faixa "Ir para o presente".

**Reações** com qualquer emoji Unicode ou do grupo (`c:<id>`), até 20 diferentes por mensagem, numa tabela própria. O
seletor é nosso, sobre o `emojibase-data` em português, com Recentes e os emojis do grupo primeiro.

**Markdown** desenhado pelo app, sem HTML: negrito, itálico, código, bloco de código e spoiler; o texto é guardado
como foi escrito.

**Anexos:** até 10 por mensagem; imagem pela miniatura, com o visualizador; `.mp4` e `.webm` tocam no chat; o resto é
o cartão com Baixar. **Prévia de links:** a API busca até 3 por mensagem em segundo plano, só `http`/`https` em 80 e
443, sem endereço privado nem a própria VPS (conferido a cada redirecionamento), 5 s, 512 KB de HTML, com cache de 24
horas, e guarda a imagem como arquivo. **Encaminhar** copia o texto e reaproveita os arquivos, com o resumo da
original.

**Fixadas:** quem gerencia canais, ou os dois numa conversa privada; até 50 por canal. **Busca:** FTS5 com
`remove_diacritics`, mantido por gatilhos, só no que a pessoa pode ler, com `de:`, `em:` e `tem:`. **Mídia do canal:**
uma caixa pelo cabeçalho, como a busca e as fixadas. **Emojis do grupo:** a permissão "Gerenciar emojis", até 100,
`:nome:` no texto.

## Consequências

- O app antigo não entende mensagem só com anexo nem os eventos novos: o `MIN_CLIENT_VERSION` sobe para `0.7.0`
  quando a `0.7.0` chegar ao estável.
- A VPS passa a acessar os sites que alguém manda no chat, inclusive nas conversas privadas (o servidor já lê as
  mensagens, ADR 0021).
- Uma mensagem de conversa privada pode ser encaminhada para um canal: a escolha é de quem encaminha.
