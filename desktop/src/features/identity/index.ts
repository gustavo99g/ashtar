export { Avatar, AvatarBadge } from "./components/Avatar";
export { PersonName } from "./components/PersonName";
export { ProfileSettings } from "./components/ProfileSettings";
export { SessionWatcher } from "./components/SessionWatcher";
export { StatusDot } from "./components/StatusDot";
export { avatarInitial, NICK_COLORS, nickColor } from "./model/nickColor";
export { checkNick, NICK_MAX, NICK_MIN, sameNick } from "./model/nickRules";
export {
	nickFromMetadata,
	type ParticipantFields,
	type ParticipantPerson,
	participantPerson,
} from "./model/participant";
export {
	type StatusOption,
	STATUS_OPTIONS,
	statusLabel,
} from "./model/status";
export {
	identityKeys,
	useInvitePreview,
	useMe,
	useMyStatus,
	useRedeemInvite,
	useSetStatus,
} from "./queries";
export { handleIdentityRealtime } from "./realtime";
export {
	redeemInvite,
	type Session,
	startSession,
	useSession,
	useSessionStore,
} from "./stores/sessionStore";
