/**
 * As categorias recolhidas neste computador. Recolher é de quem olha, não do grupo: fica no
 * `localStorage`, e cada um recolhe as suas.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface CollapsedState {
	collapsed: Record<string, true>;
}

export const useCollapsed = create<CollapsedState>()(
	persist(() => ({ collapsed: {} }), {
		name: "ashtar-collapsed-categories",
		version: 1,
	}),
);

export function useIsCollapsed(categoryId: string): boolean {
	return useCollapsed((state) => state.collapsed[categoryId] === true);
}

export function toggleCategory(categoryId: string): void {
	useCollapsed.setState((state) => {
		const collapsed = { ...state.collapsed };
		if (collapsed[categoryId]) delete collapsed[categoryId];
		else collapsed[categoryId] = true;
		return { collapsed };
	});
}
