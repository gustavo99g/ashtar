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
	voiceChannelId: string | null;
	lastTextChannelId: string | null;
	setCurrentView: (view: Appview) => void;
	joinVoiceChannel: (channelId: string) => void;
	leaveVoiceChannel: () => void;
}

export const useNavigationStore = create<NavigationStore>((set) => ({
	currentView: { type: "home" },
	lastTextChannelId: null,
	setCurrentView: (view) =>
		set((state) => ({
			currentView: view,
			lastTextChannelId:
				view.type === "text" ? view.channelId : state.lastTextChannelId,
		})),
	voiceChannelId: null,
	joinVoiceChannel: (channelId) =>
		set({
			voiceChannelId: channelId,
			currentView: {
				type: "voice",
				channelId,
			},
		}),
	leaveVoiceChannel: () =>
		set((state) => ({
			voiceChannelId: null,

			currentView: state.lastTextChannelId
				? {
						type: "text",
						channelId: state.lastTextChannelId,
					}
				: {
						type: "home",
					},
		})),
}));
