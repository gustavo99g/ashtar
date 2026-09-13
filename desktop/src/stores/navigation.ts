import { create } from "zustand";

export type Appview =
	| {
			type: "home";
	  }
	| {
			type: "text";
			channelId: string;
	  }
	| {
			type: "voice";
			channelId: string;
	  };

interface NavigationStore {
	currentView: Appview;
	setCurrentView: (view: Appview) => void;
	voiceChannelId: string | null;
	joinVoiceChannel: (channelId: string) => void;
	leaveVoiceChannel: () => void;
}

export const useNavigationStore = create<NavigationStore>((set) => ({
	currentView: { type: "home" },
	setCurrentView: (view) => set({ currentView: view }),
	voiceChannelId: null,
	joinVoiceChannel: (channelId) =>
		set({
			voiceChannelId: channelId,
			currentView: { type: "voice", channelId },
		}),
	leaveVoiceChannel: () => set({ voiceChannelId: null }),
}));
