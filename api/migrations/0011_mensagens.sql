-- no-transaction
-- Chat avançado (ADR 0032): a tabela `messages` refeita e as reações.
--
-- O SQLite não muda um `CHECK`: a tabela é recriada, com o texto podendo ser vazio
-- (uma mensagem só com anexo; a regra "texto ou anexo" fica no Rust), e com as
-- colunas novas da resposta, das fixadas e do encaminhar. Por isso esta migração
-- roda fora da transação do sqlx, com as chaves estrangeiras desligadas durante a
-- troca (o `mentions` aponta para `messages`), como manda a documentação do SQLite.

PRAGMA foreign_keys = OFF;

BEGIN;

CREATE TABLE messages_v7 (
    id         TEXT    PRIMARY KEY,
    channel_id TEXT    NOT NULL REFERENCES channels (id),
    author_id  TEXT    NOT NULL REFERENCES users (id),
    client_id  TEXT    NOT NULL CHECK (length(client_id) BETWEEN 1 AND 64),
    body       TEXT    NOT NULL CHECK (length(body) <= 2000),
    created_at INTEGER NOT NULL,
    edited_at  INTEGER,
    -- Sem uso: a mensagem excluída sai da tabela (ADR 0032). Fica pela história.
    deleted_at INTEGER,
    kind       TEXT    NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'call')),
    call_id    TEXT    REFERENCES calls (id),
    -- A mensagem respondida. Sem chave estrangeira: a original pode ser excluída,
    -- e a resposta mostra "Mensagem original excluída".
    reply_to   TEXT,
    pinned_at  INTEGER,
    pinned_by  TEXT    REFERENCES users (id),
    -- O resumo da original de uma mensagem encaminhada (JSON: autor, canal e hora).
    forwarded  TEXT,
    UNIQUE (author_id, client_id)
);

INSERT INTO messages_v7 (id, channel_id, author_id, client_id, body, created_at, edited_at,
                         deleted_at, kind, call_id)
SELECT id, channel_id, author_id, client_id, body, created_at, edited_at, deleted_at, kind, call_id
FROM messages;

DROP TABLE messages;
ALTER TABLE messages_v7 RENAME TO messages;

CREATE INDEX messages_by_channel ON messages (channel_id, id);
CREATE INDEX messages_pinned ON messages (channel_id, pinned_at) WHERE pinned_at IS NOT NULL;

-- Quem reagiu com o quê. O emoji é o texto Unicode, ou `c:<id>` de um emoji do grupo.
CREATE TABLE reactions (
    message_id TEXT    NOT NULL REFERENCES messages (id),
    user_id    TEXT    NOT NULL REFERENCES users (id),
    emoji      TEXT    NOT NULL CHECK (length(emoji) BETWEEN 1 AND 64),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, emoji, user_id)
);

COMMIT;

PRAGMA foreign_keys = ON;
