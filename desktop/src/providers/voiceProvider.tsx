import { RoomAudioRenderer } from "@livekit/components-react";
import { type Participant, Room, RoomEvent } from "livekit-client";

import { createContext, type ReactNode, useEffect, useState } from "react";
import { useNavigationStore } from "@/stores/navigation";

interface VoiceContextValue {
	room: Room | null;
	voiceChannelId: string | null;
	participants: Participant[];
	isConnected: boolean;
	isMuted: boolean;
	isDeafened: boolean;
	isScreenSharing: boolean;
	mute: () => Promise<void>;
	unmute: () => Promise<void>;
	leave: () => Promise<void>;
	deafen: () => void;
	undeafen: () => void;
	startScreenShare: () => Promise<void>;
	stopScreenShare: () => Promise<void>;
}

export const VoiceContext = createContext<VoiceContextValue | null>(null);

interface VoiceProviderProps {
	children: ReactNode;
}

const VoiceProvider = ({ children }: VoiceProviderProps) => {
	const voiceChannelId = useNavigationStore((state) => state.voiceChannelId);
	const leaveVoiceChannel = useNavigationStore(
		(state) => state.leaveVoiceChannel,
	);

	const [room, setRoom] = useState<Room | null>(null);
	const [participants, setParticipants] = useState<Participant[]>([]);
	const [isConnected, setIsConnected] = useState(false);
	const [isMuted, setIsMuted] = useState(false);
	const [isDeafened, setIsDeafened] = useState(false);
	const [isScreenSharing, setIsScreenSharing] = useState(false);

	useEffect(() => {
		if (!voiceChannelId) {
			resetVoiceState();
			return;
		}

		let cancelled = false;

		const nextRoom = new Room();

		async function connect() {
			try {
				const random = crypto.randomUUID();

				const res = await fetch("http://127.0.0.1:3000/api/voice/join", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						channel_id: voiceChannelId,
						user_id: "idiot-" + random,
						display_name: "Idiota-" + random,
					}),
				});
				if (!res.ok) {
					throw new Error("Não foi possível entrar no canal de voz.");
				}
				const data: { token: string; url: string } = await res.json();

				if (cancelled) {
					return;
				}

				nextRoom.on(RoomEvent.ParticipantConnected, updateParticipants);

				nextRoom.on(RoomEvent.ParticipantDisconnected, updateParticipants);

				nextRoom.on(RoomEvent.LocalTrackPublished, updateParticipants);

				nextRoom.on(RoomEvent.LocalTrackUnpublished, updateParticipants);

				nextRoom.on(RoomEvent.TrackMuted, updateParticipants);

				nextRoom.on(RoomEvent.TrackUnmuted, updateParticipants);

				nextRoom.on(RoomEvent.Disconnected, handleDisconnected);
				nextRoom.on(RoomEvent.ActiveSpeakersChanged, updateParticipants);

				nextRoom.on(RoomEvent.LocalTrackPublished, updateParticipants);

				nextRoom.on(RoomEvent.LocalTrackUnpublished, updateParticipants);

				nextRoom.on(RoomEvent.TrackPublished, updateParticipants);

				nextRoom.on(RoomEvent.TrackUnpublished, updateParticipants);

				nextRoom.on(RoomEvent.TrackSubscribed, updateParticipants);

				nextRoom.on(RoomEvent.TrackUnsubscribed, updateParticipants);

				await nextRoom.connect(data.url, data.token);
				await nextRoom.localParticipant.setMicrophoneEnabled(true);
				if (cancelled) {
					await nextRoom.disconnect();
					return;
				}

				setRoom(nextRoom);
				setIsConnected(true);
				updateParticipants();
				setIsMuted(false);
			} catch (error) {
				console.error("Erro ao conectar na voz:", error);

				if (!cancelled) {
					setRoom(null);
					setParticipants([]);
					setIsConnected(false);
				}
			}
		}

		function updateParticipants() {
			const remoteParticipants = Array.from(
				nextRoom.remoteParticipants.values(),
			);
			setParticipants([nextRoom.localParticipant, ...remoteParticipants]);
		}

		function handleDisconnected() {
			setRoom(null);
			setParticipants([]);
			setIsConnected(false);
			setIsMuted(false);
		}

		void connect();

		return () => {
			cancelled = true;
			nextRoom.removeAllListeners();
			void nextRoom.disconnect();
		};
	}, [voiceChannelId]);

	async function mute() {
		if (!room) {
			return;
		}

		await room.localParticipant.setMicrophoneEnabled(false);
		setIsMuted(true);
	}

	async function unmute() {
		if (!room) {
			return;
		}

		await room.localParticipant.setMicrophoneEnabled(true);
		setIsMuted(false);
	}

	async function leave() {
		if (!room) {
			return;
		}
		await room.disconnect();

		if (isScreenSharing) {
			await stopScreenShare();
		}

		resetVoiceState();
		leaveVoiceChannel();
	}

	function deafen() {
		if (!room) {
			return;
		}

		for (const participant of room.remoteParticipants.values()) {
			for (const publication of participant.audioTrackPublications.values()) {
				publication.setSubscribed(false);
			}
		}

		setIsDeafened(true);
		mute();
	}

	function undeafen() {
		if (!room) {
			return;
		}

		for (const participant of room.remoteParticipants.values()) {
			for (const publication of participant.audioTrackPublications.values()) {
				publication.setSubscribed(true);
			}
		}

		setIsDeafened(false);
		unmute();
	}

	function resetVoiceState() {
		setRoom(null);
		setParticipants([]);
		setIsConnected(false);
		setIsMuted(false);
		setIsDeafened(false);
	}

	async function startScreenShare() {
		if (!room) {
			return;
		}

		try {
			await room.localParticipant.setScreenShareEnabled(true);

			setIsScreenSharing(true);
		} catch (error) {
			console.error("Erro ao iniciar compartilhamento de tela:", error);
		}
	}

	async function stopScreenShare() {
		if (!room) {
			return;
		}

		try {
			await room.localParticipant.setScreenShareEnabled(false);

			setIsScreenSharing(false);
		} catch (error) {
			console.error("Erro ao parar compartilhamento de tela:", error);
		}
	}

	const value: VoiceContextValue = {
		room,
		participants,
		isConnected,
		isScreenSharing,
		isDeafened,
		isMuted,
		voiceChannelId,
		mute,
		unmute,
		leave,
		deafen,
		undeafen,
		startScreenShare,
		stopScreenShare,
	};

	return (
		<VoiceContext.Provider value={value}>
			{room && <RoomAudioRenderer room={room} />}

			{children}
		</VoiceContext.Provider>
	);
};

export default VoiceProvider;
