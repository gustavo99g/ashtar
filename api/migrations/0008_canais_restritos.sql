-- Canais de texto e salas de voz restritos (ADR 0028): com `restricted`, só
-- quem está em `channel_members` (a mesma tabela das conversas privadas), o
-- dono e quem gerencia os canais veem o canal. Sem, é de todos, como antes.
ALTER TABLE channels ADD COLUMN restricted INTEGER NOT NULL DEFAULT 0
    CHECK (restricted IN (0, 1));
