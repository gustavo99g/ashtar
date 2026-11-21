-- Arquivos e perfil (ADR 0031): o que a API sabe de cada arquivo guardado no disco, e quais
-- mensagens usam cada um (a mensagem encaminhada reaproveita o mesmo arquivo).

CREATE TABLE files (
    id           TEXT    PRIMARY KEY,
    uploader_id  TEXT    NOT NULL REFERENCES users (id),
    kind         TEXT    NOT NULL CHECK (kind IN ('avatar', 'attachment', 'preview', 'emoji')),
    -- O nome original, só para mostrar e para o "Baixar". No disco o arquivo é o id.
    name         TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
    -- O tipo MIME. A imagem e o vídeo que não batem com a assinatura dos primeiros bytes ficam
    -- como `application/octet-stream`, servidos como download.
    mime         TEXT    NOT NULL,
    size         INTEGER NOT NULL,
    -- As dimensões e a duração que o app mandou (a API nunca decodifica imagem).
    width        INTEGER,
    height       INTEGER,
    duration_ms  INTEGER,
    thumbnail_id TEXT    REFERENCES files (id),
    created_at   INTEGER NOT NULL,
    -- Quando passou a ser usado (numa mensagem, na foto, num emoji). Sem uso em 24 horas, sai.
    used_at      INTEGER
);

CREATE INDEX files_unused ON files (created_at) WHERE used_at IS NULL;
CREATE INDEX files_by_thumbnail ON files (thumbnail_id) WHERE thumbnail_id IS NOT NULL;

CREATE TABLE message_files (
    message_id TEXT    NOT NULL REFERENCES messages (id),
    file_id    TEXT    NOT NULL REFERENCES files (id),
    -- A ordem dos anexos na mensagem.
    position   INTEGER NOT NULL,
    PRIMARY KEY (message_id, file_id)
);

CREATE INDEX message_files_by_file ON message_files (file_id);
