-- A busca (ADR 0032): o FTS5 sobre o texto das mensagens e os nomes dos anexos, sem acento
-- (`remove_diacritics`: "voce" acha "você"), mantido por gatilhos.
--
-- A tabela liga pelo `message_id` (e não pelo `rowid` da `messages`, que um VACUUM pode trocar).
-- Editar e excluir procuram por ele sem índice, mas são raros; o que precisa ser rápido é o MATCH.

CREATE VIRTUAL TABLE messages_fts USING fts5(
    message_id UNINDEXED,
    body,
    names,
    tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO messages_fts (message_id, body, names)
SELECT m.id, m.body,
       coalesce((SELECT group_concat(f.name, ' ')
                 FROM message_files mf JOIN files f ON f.id = mf.file_id
                 WHERE mf.message_id = m.id), '')
FROM messages m
WHERE m.kind = 'text';

CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages WHEN new.kind = 'text'
BEGIN
    INSERT INTO messages_fts (message_id, body, names) VALUES (new.id, new.body, '');
END;

CREATE TRIGGER messages_fts_update AFTER UPDATE OF body ON messages
BEGIN
    UPDATE messages_fts SET body = new.body WHERE message_id = new.id;
END;

CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages
BEGIN
    DELETE FROM messages_fts WHERE message_id = old.id;
END;

CREATE TRIGGER messages_fts_file AFTER INSERT ON message_files
BEGIN
    UPDATE messages_fts
    SET names = trim(names || ' ' || coalesce((SELECT name FROM files WHERE id = new.file_id), ''))
    WHERE message_id = new.message_id;
END;
