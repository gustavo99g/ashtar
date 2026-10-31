import { useEffect } from "react";
import { applyTheme } from "@/styles/themes";
import { useSettingsStore } from "../stores/settingsStore";

/** Mantém o `data-theme` do `<html>` igual ao tema escolhido. Fica uma vez, no `App`. */
export function useApplyTheme() {
	const theme = useSettingsStore((state) => state.theme);

	useEffect(() => {
		applyTheme(theme);
	}, [theme]);
}
