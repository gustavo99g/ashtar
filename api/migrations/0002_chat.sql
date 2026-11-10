-- Chat: categorias, canais (de texto e de voz) e mensagens (ADRs 0015 e 0016).
-- Datas em segundos desde 1970 (UTC), como na 0001.

-- Uma categoria agrupa canais de qualquer tipo. A ordem é a `position`.
CREATE TABLE categories (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 32),
    position    INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    archived_at INTEGER
);

-- Um canal de texto ou uma sala de voz. Sem categoria, fica no topo. O id de
-- uma sala de voz é o nome da sala no LiveKit.
CREATE TABLE channels (
    id          TEXT    PRIMARY KEY,
    kind        TEXT    NOT NULL CHECK (kind IN ('text', 'voice')),
    name        TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 32),
    topic       TEXT    CHECK (length(topic) BETWEEN 1 AND 120),
    category_id TEXT    REFERENCES categories (id),
    position    INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    archived_at INTEGER
);

-- Mensagens nunca são apagadas por enquanto: `edited_at` e `deleted_at`
-- ficam nulos até a v0.7. O id é um UUID v7, que já vem em ordem de tempo.
CREATE TABLE messages (
    id         TEXT    PRIMARY KEY,
    channel_id TEXT    NOT NULL REFERENCES channels (id),
    author_id  TEXT    NOT NULL REFERENCES users (id),
    -- Gerado pelo app antes de enviar: repetir o envio não duplica.
    client_id  TEXT    NOT NULL CHECK (length(client_id) BETWEEN 1 AND 64),
    body       TEXT    NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
    created_at INTEGER NOT NULL,
    edited_at  INTEGER,
    deleted_at INTEGER,
    UNIQUE (author_id, client_id)
);

CREATE INDEX messages_by_channel ON messages (channel_id, id);

-- O que todo grupo já tem: o #geral e a Sala de voz, que até a v0.2.2 era
-- só uma constante no app (o id continua o mesmo).
INSERT INTO categories (id, name, position, created_at)
VALUES ('texto', 'Texto', 0, strftime('%s', 'now')),
       ('voz', 'Voz', 1, strftime('%s', 'now'));

INSERT INTO channels (id, kind, name, topic, category_id, position, created_at)
VALUES ('geral', 'text', 'geral', 'Conversa geral do grupo', 'texto', 0, strftime('%s', 'now')),
       ('sala', 'voice', 'Sala', NULL, 'voz', 0, strftime('%s', 'now'));
