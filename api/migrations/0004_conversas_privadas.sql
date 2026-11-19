-- Conversas privadas (ADR 0021): a conversa entre duas pessoas é um canal de
-- tipo `dm`, que usa a tabela `messages` e as rotas de mensagem de sempre.
--
-- O SQLite não altera um CHECK, então a `channels` é refeita. As mensagens
-- apontam para ela, e apagar a tabela com as chaves estrangeiras ligadas conta
-- uma violação para cada mensagem. Com as chaves adiadas, a conta só é cobrada
-- no fim da transação da migração, e cada canal copiado de volta para a tabela
-- nova, que tem o MESMO nome, desconta as mensagens dele. Por isso a ordem é
-- copiar para fora, apagar, criar com o mesmo nome e copiar de volta: renomear
-- uma `channels_new` no fim não desconta nada, e o COMMIT falha.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE channels_old AS SELECT * FROM channels;

DROP TABLE channels;

-- Um canal de texto, uma sala de voz ou uma conversa privada (`dm`).
--
-- A `dm` não tem nome, tópico, categoria nem posição, não é arquivada e nunca
-- aparece na lista de canais: toda consulta da lista pede
-- `kind IN ('text', 'voice')`. Uma consulta que esqueça disso quebra ao ler o
-- nome nulo, em vez de mostrar a conversa de alguém.
CREATE TABLE channels (
    id          TEXT    PRIMARY KEY,
    kind        TEXT    NOT NULL CHECK (kind IN ('text', 'voice', 'dm')),
    name        TEXT    CHECK (length(name) BETWEEN 1 AND 32),
    topic       TEXT    CHECK (length(topic) BETWEEN 1 AND 120),
    category_id TEXT    REFERENCES categories (id),
    position    INTEGER,
    created_at  INTEGER NOT NULL,
    archived_at INTEGER,
    -- Só na `dm`: os ids das duas pessoas em ordem, `menor:maior`. Único: um
    -- par de pessoas tem uma conversa só.
    dm_key      TEXT    UNIQUE,
    CHECK ((kind = 'dm') = (dm_key IS NOT NULL)),
    CHECK (kind = 'dm' OR (name IS NOT NULL AND position IS NOT NULL)),
    CHECK (kind <> 'dm' OR (name IS NULL AND topic IS NULL AND category_id IS NULL
                            AND position IS NULL AND archived_at IS NULL))
);

INSERT INTO channels (id, kind, name, topic, category_id, position, created_at, archived_at)
SELECT id, kind, name, topic, category_id, position, created_at, archived_at
FROM channels_old;

DROP TABLE channels_old;

-- Quem é de cada conversa. Hoje só as `dm` têm linhas aqui, duas cada; é a
-- mesma tabela que o canal que só algumas pessoas veem vai usar.
CREATE TABLE channel_members (
    channel_id TEXT NOT NULL REFERENCES channels (id),
    user_id    TEXT NOT NULL REFERENCES users (id),
    PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX channel_members_by_user ON channel_members (user_id);
