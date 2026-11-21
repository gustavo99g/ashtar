-- A foto de perfil (ADR 0031): o arquivo `avatar` de cada membro. Sem foto, a letra e a cor do nick.
ALTER TABLE users ADD COLUMN avatar_id TEXT REFERENCES files (id);
