-- O status Ausente (ADR 0027). O SQLite não altera um CHECK, então a `users`
-- é refeita, do mesmo jeito que a 0004 refez a `channels`: com as chaves
-- adiadas, copiar para fora, apagar, criar com o MESMO nome e copiar de volta.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE users_old AS SELECT * FROM users;

DROP TABLE users;

CREATE TABLE users (
    id         TEXT    PRIMARY KEY,
    nick       TEXT    NOT NULL CHECK (length(nick) BETWEEN 2 AND 32),
    -- Nome visível: pode repetir o de outra pessoa. NULL = aparece o nick.
    display_name TEXT  CHECK (length(display_name) BETWEEN 1 AND 32),
    is_owner   INTEGER NOT NULL DEFAULT 0 CHECK (is_owner IN (0, 1)),
    created_at INTEGER NOT NULL,
    removed_at INTEGER,
    -- O status que a pessoa escolheu (ADR 0022 e 0027). O Ausente automático
    -- não passa por aqui: é da conexão, e some com ela.
    status     TEXT    NOT NULL DEFAULT 'available'
                CHECK (status IN ('available', 'away', 'busy', 'invisible'))
);

INSERT INTO users (id, nick, display_name, is_owner, created_at, removed_at, status)
SELECT id, nick, display_name, is_owner, created_at, removed_at, status
FROM users_old;

DROP TABLE users_old;

CREATE UNIQUE INDEX users_nick_active ON users (nick COLLATE NOCASE) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX users_single_owner ON users (is_owner) WHERE is_owner = 1;
