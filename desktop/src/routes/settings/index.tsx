import { ArchivedSettings } from "@/features/channels";
import { ProfileSettings } from "@/features/identity";
import { InvitesSettings } from "@/features/invites";
import { MembersSettings } from "@/features/members";
import { AppSettings } from "@/features/updater";
import { useVoice, VoiceSettings } from "@/features/voice";

/*
 * As páginas das configurações, desenhadas dentro do `SettingsLayout` (menu à esquerda).
 */

export function ProfileSettingsRoute() {
	// A rota diz se há chamada: a identidade não importa a voz.
	const { connectionState } = useVoice();
	const inCall =
		connectionState !== "disconnected" && connectionState !== "error";
	return <ProfileSettings inCall={inCall} />;
}

export function VoiceSettingsRoute() {
	return <VoiceSettings />;
}

export function AppSettingsRoute() {
	return <AppSettings />;
}

export function InvitesSettingsRoute() {
	return <InvitesSettings />;
}

export function MembersSettingsRoute() {
	return <MembersSettings />;
}
export function ArchivedSettingsRoute() {
	return <ArchivedSettings />;
}
