import { useParams } from "react-router-dom";
import { InviteFlow } from "@/features/entry";

/** O convite novo (`/entry/invite/:code`): a escolha do nick, que mora na `features/entry`. */
export function InviteRoute() {
	const { code = "" } = useParams();
	return <InviteFlow code={code} />;
}
