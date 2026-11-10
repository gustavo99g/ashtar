-- O status de cada pessoa (ADR 0022): Disponível, Ocupado ou Invisível.
-- Fica no servidor, e não no app: vale em qualquer computador e é a API que
-- esconde dos outros quem está invisível.
ALTER TABLE users
    ADD COLUMN status TEXT NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'busy', 'invisible'));
