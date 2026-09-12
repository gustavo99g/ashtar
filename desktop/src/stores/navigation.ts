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
}

export const useNavigationStore = create<NavigationStore>((set) => ({
	currentView: { type: "home" },
	setCurrentView: (view) => set({ currentView: view }),
}));
