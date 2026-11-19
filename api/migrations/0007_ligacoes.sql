-- Ligações privadas (ADR 0023): a ligação entre as duas pessoas de uma `dm`.

-- Cada ligação, do toque ao fim. `outcome` diz onde ela está:
--   `ringing`   tocando, ainda sem fim;
--   `answered`  atendida: em andamento sem `ended_at`, encerrada com ele;
--   `missed`, `declined` e `cancelled`  terminaram sem conversa (o tempo
--   limite, quem recebeu recusou, quem ligou desistiu).
CREATE TABLE calls (
    id          TEXT    PRIMARY KEY,
    channel_id  TEXT    NOT NULL REFERENCES channels (id),
    caller_id   TEXT    NOT NULL REFERENCES users (id),
    created_at  INTEGER NOT NULL,
    answered_at INTEGER,
    ended_at    INTEGER,
    outcome     TEXT    NOT NULL DEFAULT 'ringing'
                CHECK (outcome IN ('ringing', 'answered', 'missed', 'declined', 'cancelled')),
    CHECK ((outcome = 'answered') = (answered_at IS NOT NULL)),
    CHECK ((outcome = 'ringing') = (ended_at IS NULL AND answered_at IS NULL)
           OR outcome = 'answered')
);

-- No máximo uma ligação sem fim por conversa: é o que junta os dois ligando
-- ao mesmo tempo numa ligação só.
CREATE UNIQUE INDEX calls_open_by_channel ON calls (channel_id) WHERE ended_at IS NULL;

-- O registro da ligação no histórico é uma mensagem de quem ligou, com o tipo
-- `call` e a ligação. O texto dela é "Ligação", que é o que um app antigo
-- mostra.
ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'
    CHECK (kind IN ('text', 'call'));
ALTER TABLE messages ADD COLUMN call_id TEXT REFERENCES calls (id);
