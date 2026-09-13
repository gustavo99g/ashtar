import { RoomAudioRenderer } from "@livekit/components-react";
import { type Participant, Room, RoomEvent } from "livekit-client";

import { createContext, type ReactNode, useEffect, useState } from "react";
import { useNavigationStore } from "@/stores/navigation";

interface VoiceContextValue {
	room: Room | null;
	participants: Participant[];
	isConnected: boolean;
	isMuted: boolean;
	voiceChannelId: string | null;

	mute: () => Promise<void>;
	unmute: () => Promise<void>;
	leave: () => Promise<void>;
}

export const VoiceContext = createContext<VoiceContextValue | null>(null);

interface VoiceProviderProps {
	children: ReactNode;
}

const VoiceProvider = ({ children }: VoiceProviderProps) => {
	const voiceChannelId = useNavigationStore((state) => state.voiceChannelId);

	const [room, setRoom] = useState<Room | null>(null);
	const [participants, setParticipants] = useState<Participant[]>([]);
	const [isConnected, setIsConnected] = useState(false);
	const [isMuted, setIsMuted] = useState(false);

	useEffect(() => {
		if (!voiceChannelId) {
			setRoom(null);
			setParticipants([]);
			setIsConnected(false);
			setIsMuted(false);
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

		setRoom(null);
		setParticipants([]);
		setIsConnected(false);
		setIsMuted(false);
	}

	const value: VoiceContextValue = {
		room,
		participants,
		isConnected,
		isMuted,
		voiceChannelId,
		mute,
		unmute,
		leave,
	};

	return (
		<VoiceContext.Provider value={value}>
			{room && <RoomAudioRenderer room={room} />}

			{children}
		</VoiceContext.Provider>
	);
};

export default VoiceProvider;
