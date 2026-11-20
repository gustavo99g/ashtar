-- Os logs que os membros mandam pelo "Enviar logs" (v0.6, decisão 16). O arquivo fica em
-- `data/logs/{id}.zip`; aqui, quem mandou, quando e o que escreveu. Só o dono vê.
CREATE TABLE log_reports (
    id          TEXT    PRIMARY KEY,
    user_id     TEXT    NOT NULL REFERENCES users (id),
    created_at  INTEGER NOT NULL,
    app_version TEXT    NOT NULL,
    -- O "O que aconteceu?", opcional.
    note        TEXT    CHECK (note IS NULL OR length(note) <= 1000),
    size        INTEGER NOT NULL
);

CREATE INDEX log_reports_user ON log_reports (user_id, created_at);
