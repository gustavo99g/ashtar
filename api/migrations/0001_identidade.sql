-- Identidade: usuários, dispositivo, sessão, convites e permissões diretas.
-- Datas em segundos desde 1970 (UTC). Ids são UUID v4 em texto.

CREATE TABLE users (
    id         TEXT    PRIMARY KEY,
    nick       TEXT    NOT NULL CHECK (length(nick) BETWEEN 2 AND 32),
    is_owner   INTEGER NOT NULL DEFAULT 0 CHECK (is_owner IN (0, 1)),
    created_at INTEGER NOT NULL,
    removed_at INTEGER
);

-- Nick único entre os membros ativos, sem diferenciar maiúscula de minúscula.
-- O nick de quem foi removido fica livre de novo.
CREATE UNIQUE INDEX users_nick_active ON users (nick COLLATE NOCASE) WHERE removed_at IS NULL;

-- No máximo um dono.
CREATE UNIQUE INDEX users_single_owner ON users (is_owner) WHERE is_owner = 1;

CREATE TABLE devices (
    id        TEXT    PRIMARY KEY,
    user_id   TEXT    NOT NULL REFERENCES users (id),
    key_hash  TEXT    NOT NULL UNIQUE,
    linked_at INTEGER NOT NULL
);

-- Um dispositivo por usuário. Para liberar mais de um, uma migração nova apaga este índice.
CREATE UNIQUE INDEX devices_one_per_user ON devices (user_id);

-- Uma sessão por dispositivo. Apagar o dispositivo apaga a sessão junto.
CREATE TABLE sessions (
    token_hash   TEXT    PRIMARY KEY,
    device_id    TEXT    NOT NULL UNIQUE REFERENCES devices (id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
);

-- Convites nunca são apagados: a linha e os usos dela são o histórico de quem convidou quem.
CREATE TABLE invites (
    id             TEXT    PRIMARY KEY,
    code_hash      TEXT    NOT NULL UNIQUE,
    kind           TEXT    NOT NULL CHECK (kind IN ('new', 'recovery')),
    target_user_id TEXT    REFERENCES users (id),
    max_uses       INTEGER NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 50),
    created_by     TEXT    NOT NULL REFERENCES users (id),
    created_at     INTEGER NOT NULL,
    expires_at     INTEGER NOT NULL,
    revoked_at     INTEGER,
    -- Só o convite de recuperação aponta para um usuário, e ele vale uma vez só.
    CHECK ((kind = 'recovery') = (target_user_id IS NOT NULL)),
    CHECK (kind = 'new' OR max_uses = 1)
);

-- Quem entrou com cada convite. Um convite com `max_uses = 5` pode ter até 5 linhas aqui.
CREATE TABLE invite_uses (
    invite_id TEXT    NOT NULL REFERENCES invites (id),
    user_id   TEXT    NOT NULL REFERENCES users (id),
    used_at   INTEGER NOT NULL,
    PRIMARY KEY (invite_id, user_id)
);

-- Permissões dadas direto a um usuário. As chaves válidas estão no código (`Permission`).
CREATE TABLE user_permissions (
    user_id    TEXT    NOT NULL REFERENCES users (id),
    permission TEXT    NOT NULL,
    granted_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, permission)
);
