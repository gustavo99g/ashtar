/*
 * Quem é um participante da sala de voz, pelo que o token da API (`POST /api/voice/token`) põe
 * nele: a identidade é o id do usuário, o nome é o nome visível (ou o nick, sem ele) e o nick vem
 * nos metadados, como `{"nick":"kid"}`. Do nick saem a cor e a letra do avatar; do nome, a letra.
 */

/** Os campos do `Participant` do LiveKit que importam aqui. */
export interface ParticipantFields {
	identity: string;
	name?: string;
	metadata?: string;
}

export interface ParticipantPerson {
	/** O id do usuário na API (a identidade no LiveKit). */
	id: string;
	nick: string;
	/** O nome visível; quem não tem um aparece pelo nick. */
	name: string;
}

/** O nick que a API pôs nos metadados (`{"nick":"kid"}`), ou `null` se não houver um. */
export function nickFromMetadata(metadata: string | undefined): string | null {
	if (!metadata) return null;
	try {
		const parsed: unknown = JSON.parse(metadata);
		if (typeof parsed === "object" && parsed !== null && "nick" in parsed) {
			const { nick } = parsed;
			if (typeof nick === "string" && nick.trim() !== "") return nick;
		}
	} catch {
		// Metadados que não são JSON: fica sem nick, como um participante sem metadados.
	}
	return null;
}

/**
 * O nick e o nome de um participante. Sem nick nos metadados (um token antigo), o nome faz as
 * vezes de nick, e sem nome, a identidade: a cor sai igual nos dois lados da chamada.
 */
export function participantPerson(
	participant: ParticipantFields,
): ParticipantPerson {
	const name = participant.name?.trim() ?? "";
	const nick =
		nickFromMetadata(participant.metadata) ?? (name || participant.identity);
	return { id: participant.identity, nick, name: name || nick };
}
