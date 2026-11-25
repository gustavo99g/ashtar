# 0036 — Backup das fotos, dos emojis e dos sons

- **Status:** proposta (passa a aceita com a restauração testada numa cópia, Etapa 9 da v0.9)
- **Data:** 2026-11

## Contexto

O backup diário (`deploy/server/backup.sh`, às 22:30) leva só o banco: o `admin backup` faz o `VACUUM INTO` em
`data/backups/` e o `rclone` manda a cópia nova para o R2. Os arquivos (`data/files/`, ADR 0031) ficaram fora desde a
v0.7. Numa restauração, as fotos de perfil e os emojis do grupo sumiriam, e eles não se refazem sozinhos. O Kid
decidiu em 24/11 levar o banco, as fotos de perfil e os emojis todo dia; os sons do soundboard (ADR 0037) entraram
depois. Os anexos e as prévias ficam fora: são muitos, grandes, e a perda deles não quebra o uso.

## Decisão

**A cópia dos arquivos é incremental, no mesmo horário do banco.** O comando `admin arquivos-backup` lista os ids dos
arquivos `avatar`, `emoji` e `sound` que existem na tabela `files`, um por linha. O `backup.sh` grava essa lista num
arquivo temporário e roda `rclone copy --files-from <lista> --ignore-existing` de `data/files/` para
`{destino}/files/`. Como um arquivo nunca muda depois de gravado (o id é o nome), o que já está no R2 não sobe de
novo, e na maioria dos dias não sobe nada.

**As fotos anteriores** também são `avatar` e entram, para a pessoa voltar a uma delas depois de uma restauração.

**Nada é apagado do R2** pela cópia: um emoji, um som ou uma foto apagados no app ficam lá. O volume é pequeno (fotos de
256 px, emojis de 128 px e no máximo 50 sons aprovados de até 1 MB); se pesar um dia, entra uma limpeza mensal.

**Uma falha na cópia dos arquivos** vai para o log do backup e não desfaz o backup do banco, que roda antes.

**Restaurar é o banco e os arquivos.** O `deploy/server/README.md` ganha o passo de baixar a pasta `files/` do R2 para
`data/files/` antes de subir a API. Um anexo sem o arquivo aparece como indisponível, sem quebrar a mensagem.

**A restauração é testada numa cópia**, não na VPS de produção: uma API local sobe com o backup do R2, e o app aponta
para ela pela URL de desenvolvimento.

## Consequências

- O R2 passa a guardar arquivos, além das cópias do banco, num prefixo `files/` ao lado delas.
- A lista vai num arquivo, não na linha de comando, para não estourar o tamanho com milhares de ids.
- O BACKLOG fica só com a cópia dos anexos e das prévias.
