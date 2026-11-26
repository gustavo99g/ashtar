-- no-transaction
-- O soundboard (ADR 0037, v0.9): os sons do grupo, as permissões novas e o bloqueio de sons na
-- moderação de voz.
--
-- O SQLite não muda um `CHECK`: a tabela `files` é recriada com o tipo `sound`, como a
-- `messages` na 0011, fora da transação do sqlx e com as chaves estrangeiras desligadas durante a
-- troca (outras tabelas apontam para `files`). O gatilho da busca que lê `files` sai antes e volta
-- igual depois (o da 0015), como manda a documentação do SQLite.

PRAGMA foreign_keys = OFF;

BEGIN;

CREATE TABLE files_v9 (
    id           TEXT    PRIMARY KEY,
    uploader_id  TEXT    NOT NULL REFERENCES users (id),
    kind         TEXT    NOT NULL CHECK (kind IN ('avatar', 'attachment', 'preview', 'emoji', 'sound')),
    name         TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
    mime         TEXT    NOT NULL,
    size         INTEGER NOT NULL,
    width        INTEGER,
    height       INTEGER,
    duration_ms  INTEGER,
    thumbnail_id TEXT    REFERENCES files (id),
    created_at   INTEGER NOT NULL,
    used_at      INTEGER
);

INSERT INTO files_v9 (id, uploader_id, kind, name, mime, size, width, height, duration_ms,
                      thumbnail_id, created_at, used_at)
SELECT id, uploader_id, kind, name, mime, size, width, height, duration_ms, thumbnail_id,
       created_at, used_at
FROM files;

DROP TRIGGER messages_fts_file;
DROP TABLE files;
ALTER TABLE files_v9 RENAME TO files;

CREATE TRIGGER messages_fts_file AFTER INSERT ON message_files
BEGIN
    UPDATE messages_fts
    SET names = trim(names || ' ' || coalesce((SELECT name FROM files WHERE id = new.file_id), ''))
    WHERE message_id = new.message_id;
END;

CREATE INDEX files_unused ON files (created_at) WHERE used_at IS NULL;
CREATE INDEX files_by_thumbnail ON files (thumbnail_id) WHERE thumbnail_id IS NOT NULL;

-- Um som do grupo: o arquivo (WAV mono, até 5 s e 1 MB), o nome e o emoji. Enviado fica
-- `pending` até alguém com "Aprovar sons" aprovar ou recusar; quem aprova envia direto como
-- `approved`. O `name_key` é o nome em minúsculas: não repete entre os aprovados e os aguardando.
CREATE TABLE sounds (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 24),
    name_key    TEXT    NOT NULL,
    emoji       TEXT    CHECK (emoji IS NULL OR length(emoji) BETWEEN 1 AND 64),
    file_id     TEXT    NOT NULL REFERENCES files (id),
    duration_ms INTEGER NOT NULL,
    uploaded_by TEXT    NOT NULL REFERENCES users (id),
    status      TEXT    NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    reason      TEXT    CHECK (reason IS NULL OR length(reason) <= 200),
    reviewed_by TEXT    REFERENCES users (id),
    reviewed_at INTEGER,
    created_at  INTEGER NOT NULL
);

CREATE UNIQUE INDEX sounds_by_name ON sounds (name_key) WHERE status <> 'rejected';
CREATE INDEX sounds_by_uploader ON sounds (uploaded_by, status);

-- "Enviar sons" vem ligada para todo mundo: quem já está no grupo recebe aqui; quem entrar,
-- no convite.
INSERT OR IGNORE INTO user_permissions (user_id, permission, granted_at)
SELECT id, 'sons.enviar', CAST(strftime('%s', 'now') AS INTEGER) FROM users
WHERE removed_at IS NULL AND is_owner = 0;

-- Bloquear sons é moderação de voz: vale como o silenciar, em todas as salas até liberar.
ALTER TABLE voice_moderation ADD COLUMN sounds_blocked INTEGER NOT NULL DEFAULT 0;

COMMIT;

PRAGMA foreign_keys = ON;
