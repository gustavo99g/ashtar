-- A prévia de links (ADR 0032): o cache por endereço e os cartões de cada mensagem.

-- Uma página buscada: o que ela diz de si, ou `ok = 0` se não deu prévia. Vale 24 horas.
CREATE TABLE link_previews (
    url         TEXT    PRIMARY KEY,
    site        TEXT,
    title       TEXT,
    description TEXT,
    image_id    TEXT    REFERENCES files (id),
    fetched_at  INTEGER NOT NULL,
    ok          INTEGER NOT NULL
);

-- Os cartões de uma mensagem, na ordem dos links do texto.
CREATE TABLE message_previews (
    message_id TEXT    NOT NULL REFERENCES messages (id),
    url        TEXT    NOT NULL REFERENCES link_previews (url),
    position   INTEGER NOT NULL,
    PRIMARY KEY (message_id, url)
);

-- O autor tirou as prévias (o X no cartão): a mensagem não ganha de novo, nem editada.
ALTER TABLE messages ADD COLUMN previews_hidden INTEGER NOT NULL DEFAULT 0;
