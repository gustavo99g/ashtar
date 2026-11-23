-- O registro do grupo (ADR 0034, decisões 17 a 20 do plano da v0.8): quem fez o quê, em quem e
-- onde, nas ações de voz, membros, convites e canais. Só o dono lê. Os nomes ficam gravados como
-- eram na hora, para quem saiu do grupo continuar aparecendo. Guarda 1 ano.

CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    at          INTEGER NOT NULL,
    kind        TEXT    NOT NULL,
    action      TEXT    NOT NULL,
    actor_id    TEXT    NOT NULL,
    actor_name  TEXT    NOT NULL,
    target_id   TEXT,
    target_name TEXT,
    place       TEXT,
    detail      TEXT
);

CREATE INDEX audit_log_kind ON audit_log (kind, id);
CREATE INDEX audit_log_at ON audit_log (at);
