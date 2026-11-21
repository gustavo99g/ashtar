-- Os emojis do grupo (decisão 31 do plano da v0.7): uma imagem (um arquivo `emoji`) com um nome
-- único, de 2 a 32 letras minúsculas, números e `_`. Até 100. A reação guarda `c:<id>`.

CREATE TABLE emojis (
    id         TEXT    PRIMARY KEY,
    name       TEXT    NOT NULL UNIQUE,
    file_id    TEXT    NOT NULL REFERENCES files (id),
    created_by TEXT    NOT NULL REFERENCES users (id),
    created_at INTEGER NOT NULL
);
