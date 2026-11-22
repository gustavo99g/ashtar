# 0031 — Arquivos e perfil

- **Status:** proposta (passa a aceita com o teste de três computadores da Etapa 15 da v0.7)
- **Data:** 2026-11

## Contexto

Até a v0.6, o Ashtar não guardava arquivo nenhum: o avatar é a letra e a cor do nick (ADR 0012), o chat só tem
texto, e o nome visível, que já pode ser trocado em Configurações › Perfil, só chega aos outros quando eles
recarregam. A v0.7 precisa de um lugar para a foto de perfil, para os anexos do chat (até 100 MB cada), para as
imagens das prévias de link e para os emojis do grupo. O Kid decidiu (20/11) que os arquivos ficam no disco da VPS,
sem a Cloudflare por enquanto, e fora do backup do banco.

## Decisão

**Um armazenamento só**, a interface `FileStore` (`put`, `open`, `delete`) na API, com a implementação em disco
(`FILES_DIR`, padrão `data/files`, em `ab/cd/<id>`). Uma tabela `files` guarda quem enviou, o tipo (`avatar`,
`attachment`, `preview`, `emoji`), o nome original, o MIME, o tamanho, as dimensões, a duração e a miniatura; a
`message_files` liga o arquivo às mensagens (o encaminhar reaproveita o mesmo arquivo), e ele só é apagado quando
nada mais o usa. O R2, se vier, é outra implementação da interface.

**O envio** é um `POST /api/files` com o corpo cru, gravado em pedaços, até 100 MB, com 10 minutos de tempo limite.
Arquivo enviado e não usado em 24 horas é apagado. Com menos de 1 GB livre a API recusa (`507`), e o dono é avisado
quando o disco passa de 80%, no máximo uma vez por dia.

**A leitura** é um `GET /api/files/{id}` com o token de sempre, e a API confere o acesso: a foto e os emojis, todo
mundo do grupo; o anexo e a prévia, quem lê o canal da mensagem. O app mostra por `blob:` num cache em memória, e o
Rust baixa os arquivos grandes direto para Downloads. Só o `<video>`, que não manda cabeçalho, usa um link assinado de
10 minutos para um arquivo só, com `Range`.

**A API nunca decodifica imagem.** O app redimensiona antes de enviar (a foto em 256×256 WebP, a miniatura com 640 px
no lado maior, a capa do vídeo, os emojis em 128×128) e manda as dimensões. A API só confere a assinatura dos
primeiros bytes; o que não bate vira arquivo comum, servido com `Content-Disposition: attachment`.

**A foto de perfil** sai de um recorte redondo com zoom; o GIF fica parado. O nick continua fixo. A troca de foto ou de
nome visível manda `user.updated` para todos, e o `Author`, o `ParticipantView`, o `/api/me`, o `/api/people` e o
`/api/members` ganham o `avatar`. Sem foto, ou se ela não carrega, fica a letra e a cor de sempre.

## Consequências

- Os arquivos não estão no backup: se o disco da VPS se perder, as fotos e os anexos vão junto (as mensagens ficam).
  Está escrito no `deploy/server/README.md`, e a cópia no R2 está no BACKLOG.
- O servidor guarda arquivos de qualquer tipo, mas nunca os executa nem abre; só devolve para quem pode ler.
- O token nunca vai na URL, menos no link do vídeo, que vale 10 minutos para um arquivo só.
