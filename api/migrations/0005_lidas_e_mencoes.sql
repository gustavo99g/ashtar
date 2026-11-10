-- Lidas, menções e silenciar (ADR 0022).

-- O que cada pessoa guarda sobre cada canal ou conversa: até onde leu e se
-- silenciou. Sem linha é o mesmo que nada lido e sem silenciar.
CREATE TABLE channel_state (
    user_id      TEXT    NOT NULL REFERENCES users (id),
    channel_id   TEXT    NOT NULL REFERENCES channels (id),
    -- O id da última mensagem lida. Os ids são UUID v7: comparar o texto é
    -- comparar a ordem de envio. NULL = não leu nada.
    last_read_id TEXT,
    muted        INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0, 1)),
    PRIMARY KEY (user_id, channel_id)
);

-- Quem foi mencionado em cada mensagem. O canal vai junto para a contagem
-- por canal não precisar passar pela `messages`.
CREATE TABLE mentions (
    message_id TEXT NOT NULL REFERENCES messages (id),
    user_id    TEXT NOT NULL REFERENCES users (id),
    channel_id TEXT NOT NULL REFERENCES channels (id),
    PRIMARY KEY (message_id, user_id)
);

CREATE INDEX mentions_by_user ON mentions (user_id, channel_id, message_id);

-- Todo membro ativo começa com todo canal de texto lido até a última
-- mensagem: ninguém abre a versão nova com o histórico inteiro como não lido.
-- Os arquivados entram também, para o caso de voltarem. As conversas privadas
-- ficam de fora: o que chegou nelas e ninguém viu é não lido de verdade.
INSERT INTO channel_state (user_id, channel_id, last_read_id)
SELECT u.id, c.id, (SELECT MAX(m.id) FROM messages m WHERE m.channel_id = c.id)
FROM users u
CROSS JOIN channels c
WHERE u.removed_at IS NULL AND c.kind = 'text';
