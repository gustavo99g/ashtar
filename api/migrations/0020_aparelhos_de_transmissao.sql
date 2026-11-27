-- Os aparelhos de transmissão (ADR 0038): um portátil, como o Odin 3, que só transmite a tela para
-- onde o dono está. Não é um dispositivo do membro (`devices`): não entra no app, não tem chat nem
-- voz, e a sessão dele só passa nas rotas `/api/stream-devices/self/*`.

-- O código de pareamento que o desktop mostra (texto e QR). Vale 10 minutos e uma vez só.
CREATE TABLE stream_pair_codes (
    code_hash  TEXT    PRIMARY KEY,
    user_id    TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX stream_pair_codes_user ON stream_pair_codes (user_id);

-- O aparelho pareado. O token da sessão fica só como SHA-256, como o das sessões do app; ele não
-- expira sozinho: cai quando o dono desvincula o aparelho ou é removido.
CREATE TABLE stream_devices (
    id           TEXT    PRIMARY KEY,
    user_id      TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name         TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 32),
    token_hash   TEXT    NOT NULL UNIQUE,
    paired_at    INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
);

CREATE INDEX stream_devices_user ON stream_devices (user_id, paired_at);
