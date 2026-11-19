import type { TrackReference } from "@livekit/components-react";
import { useEffect, useState } from "react";
import {
	type InboundSample,
	type InboundSummary,
	readInbound,
	summarize,
} from "../model/inboundHealth";

/** De quanto em quanto tempo o popover lê os números. */
const INTERVAL_MS = 2000;

/**
 * Como a transmissão `share` está chegando (`inboundHealth.ts`): lê o `getRTCStatsReport` da trilha a
 * cada 2 s, e só com `open` (o popover aberto). Fechado, nada é lido, e o resumo volta a `null`.
 */
export function useInboundShareStats(
	share: TrackReference,
	open: boolean,
): InboundSummary | null {
	const track = share.publication.track;
	const [summary, setSummary] = useState<InboundSummary | null>(null);

	useEffect(() => {
		if (!open || !track) {
			setSummary(null);
			return;
		}
		let previous: InboundSample | null = null;
		let cancelled = false;
		const read = async () => {
			const report = await track.getRTCStatsReport().catch(() => undefined);
			if (cancelled || !report) return;
			const sample = readInbound(report, Date.now());
			if (!sample) return;
			setSummary(summarize(previous, sample));
			previous = sample;
		};
		void read();
		const timer = window.setInterval(read, INTERVAL_MS);
		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
	}, [open, track]);

	return summary;
}
