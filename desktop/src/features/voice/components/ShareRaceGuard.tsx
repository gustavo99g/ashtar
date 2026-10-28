import { ScreenShareOffIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/components/ui/toast";
import { participantPerson } from "@/features/identity";
import {
	type ScreenShareController,
	useScreenShareState,
	useScreenShares,
} from "@/features/screen-share";
import { paths } from "@/lib/paths";
import { watchShare } from "../roomView";
import { NoticeIcon } from "./NoticeIcon";

/**
 * Quando duas pessoas começam a transmitir juntas, cada app aplica a mesma regra
 * (`shareWinner`): quem perde para a própria transmissão e vê o aviso "<nome> começou a
 * transmitir antes", que dá para dispensar. Não desenha nada; fica montado durante a chamada.
 */
export function ShareRaceGuard({
	controller,
}: {
	controller: ScreenShareController;
}) {
	const navigate = useNavigate();
	const state = useScreenShareState(controller);
	const { shares, winner } = useScreenShares();
	/** A sessão que já perdeu: o fim leva um tempo e as trilhas mudam no meio. */
	const lost = useRef<number | null>(null);

	useEffect(() => {
		if (state.status !== "active" || lost.current === state.sessionId) return;
		// A própria publicação ainda não chegou à lista: espera, para comparar as duas.
		if (!shares.some((share) => share.participant.isLocal)) return;
		if (!winner || winner.participant.isLocal) return;

		lost.current = state.sessionId;
		const first = participantPerson(winner.participant);
		void controller.stop();
		const id = toast.add({
			title: `${first.name} começou a transmitir antes`,
			description: "Uma transmissão por vez. Sua tela não foi compartilhada.",
			data: {
				media: (
					<NoticeIcon tone="gold">
						<ScreenShareOffIcon />
					</NoticeIcon>
				),
			},
			actionProps: {
				children: "Assistir",
				onClick: () => {
					toast.close(id);
					watchShare(first.id);
					void navigate(paths.voiceRoom);
				},
			},
		});
	}, [state, shares, winner, controller, navigate]);

	return null;
}
