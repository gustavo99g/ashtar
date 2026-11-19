/**
 * Se a própria câmera está ligada na conexão de agora, e se está ligando ou desligando. Quem muda é o
 * `useLocalCamera` (no `VoiceProvider`), pelos eventos da sala; o botão Câmera só lê e pede.
 */
import { create } from "zustand";

interface CameraState {
	on: boolean;
	/** Abrindo ou fechando a câmera: o botão espera. */
	busy: boolean;
}

export const useCameraState = create<CameraState>()(() => ({
	on: false,
	busy: false,
}));
