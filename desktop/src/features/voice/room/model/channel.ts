/**
 * A única sala de voz da 0.2.2. O id vira o nome da sala no LiveKit (a API confere o formato) e é
 * o mesmo do `GET /api/voice/participants`. Várias salas chegam na 0.5.
 */
export const SALA = { id: "sala", name: "Sala" } as const;
