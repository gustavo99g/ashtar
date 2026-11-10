-- A versão da lista de canais (ADR 0016). Toda mudança na lista (criar,
-- renomear, arquivar, reordenar) soma 1. O `PUT /api/channels/layout` manda a
-- versão que o app viu; se ela já mudou, outra pessoa mexeu antes e a API
-- responde 409 em vez de desfazer o que a outra fez.
CREATE TABLE channel_layout (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL
);

INSERT INTO channel_layout (id, version) VALUES (1, 1);
