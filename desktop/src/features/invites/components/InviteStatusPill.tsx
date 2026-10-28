import { Badge } from "@/components/ui/badge";
import type { InviteStatus } from "@/lib/api";

/** O texto e o tom de cada situação, como no histórico do quadro "Convites". */
const STATUS = {
	pending: { label: "Valendo", tone: "success" },
	exhausted: { label: "Usado", tone: "info" },
	revoked: { label: "Revogado", tone: "danger" },
	expired: { label: "Expirou", tone: "neutral" },
} as const;

function InviteStatusPill({ status }: { status: InviteStatus }) {
	const { label, tone } = STATUS[status];
	return (
		<Badge tone={tone} dot>
			{label}
		</Badge>
	);
}

export { InviteStatusPill };
