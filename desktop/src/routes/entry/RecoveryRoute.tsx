import { useParams } from "react-router-dom";
import { RecoveryFlow } from "@/features/entry";

/** A recuperação (`/entry/recovery/:code`): trocar de computador, que mora na `features/entry`. */
export function RecoveryRoute() {
	const { code = "" } = useParams();
	return <RecoveryFlow code={code} />;
}
