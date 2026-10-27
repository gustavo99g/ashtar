import { UserPanel } from "./UserPanel";

/** O pé da coluna do servidor: o cartão de quem está usando. */
export function VoiceDock() {
	return (
		<div className="shrink-0 px-2 pb-2">
			<div className="flex flex-col rounded-xl border border-border bg-secondary">
				<UserPanel />
			</div>
		</div>
	);
}
