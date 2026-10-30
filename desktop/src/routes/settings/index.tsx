import { AppSettings } from "@/features/updater";
import { VoiceSettings } from "@/features/voice";
import { RoutePlaceholder } from "../placeholder";

/*
 * As páginas das configurações, desenhadas dentro do `SettingsLayout` (menu à esquerda).
 */

export function ProfileSettingsRoute() {
	return <RoutePlaceholder title="Perfil" stage={6} />;
}

export function VoiceSettingsRoute() {
	return <VoiceSettings />;
}

export function AppSettingsRoute() {
	return <AppSettings />;
}

export function InvitesSettingsRoute() {
	return <RoutePlaceholder title="Convites" stage={7} />;
}

export function MembersSettingsRoute() {
	return <RoutePlaceholder title="Membros" stage={7} />;
}
