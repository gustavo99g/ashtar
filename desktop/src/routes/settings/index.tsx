import {
	AuditSettings,
	LogsSettings,
	ServerStatusSettings,
} from "@/features/admin";
import { ArchivedSettings } from "@/features/channels";
import { EmojiSettings } from "@/features/emojis";
import { SoundSettings } from "@/features/sounds";
import { ProfileSettings } from "@/features/identity";
import { ShortcutsSettings } from "@/features/settings";
import { ActivitySettings } from "@/features/activity";
import { InvitesSettings } from "@/features/invites";
import { MembersSettings } from "@/features/members";
import { NotificationsSettings } from "@/features/notifications";
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

export function ShortcutsSettingsRoute() {
	return <ShortcutsSettings />;
}

export function ActivitySettingsRoute() {
	return <ActivitySettings />;
}

export function NotificationsSettingsRoute() {
	return <NotificationsSettings />;
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

export function SoundsSettingsRoute() {
	return <SoundSettings />;
}

export function EmojisSettingsRoute() {
	return <EmojiSettings />;
}

export function LogsSettingsRoute() {
	return <LogsSettings />;
}

export function AuditSettingsRoute() {
	return <AuditSettings />;
}

export function ServerSettingsRoute() {
	return <ServerStatusSettings />;
}
