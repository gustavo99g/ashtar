-- O estado imposto pela moderação na voz (ADR 0034, decisão 11 do plano da v0.8): silenciado e
-- surdo valem em todas as salas de voz do grupo até alguém com "Moderar voz" liberar. Trocar de sala
-- ou reiniciar o app não solta. Sem nenhum dos dois, a linha é apagada.

CREATE TABLE voice_moderation (
    user_id    TEXT    PRIMARY KEY REFERENCES users (id),
    mic_muted  INTEGER NOT NULL DEFAULT 0,
    deafened   INTEGER NOT NULL DEFAULT 0,
    by_user_id TEXT    NOT NULL REFERENCES users (id),
    updated_at INTEGER NOT NULL
);
