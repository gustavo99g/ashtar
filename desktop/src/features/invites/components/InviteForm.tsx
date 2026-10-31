import {
	CircleAlertIcon,
	ClockIcon,
	MinusIcon,
	PlusIcon,
	SlidersHorizontalIcon,
	TicketIcon,
	UserPlusIcon,
	UsersIcon,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceCard, ChoiceCardGroup } from "@/components/ui/choice-card";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import type { CreatedInviteView, CreateInviteRequest, Preset } from "@/lib/api";
import { dayAndTime, peopleText } from "../model/format";
import {
	CUSTOM_TTLS,
	type CustomTtl,
	MAX_USES,
	MIN_USES,
	PRESET_LIMITS,
	PRESETS,
} from "../model/presets";
import { useCreateInvite } from "../queries";
import { useNow } from "../hooks/useNow";

/*
 * O "Novo convite" dos quadros "Convites" e "Convites (do seu jeito)": os três modelos, os campos
 * do "Do seu jeito" e o rodapé com o resumo e o Criar convite. O app manda só o `preset`; no "Do
 * seu jeito", também a validade e as pessoas.
 */

const ICONS: Record<Preset, ReactNode> = {
	person: <UserPlusIcon />,
	group: <UsersIcon />,
	custom: <SlidersHorizontalIcon />,
};

export function InviteForm({
	onCreated,
}: {
	onCreated: (invite: CreatedInviteView) => void;
}) {
	const [preset, setPreset] = useState<Preset>("person");
	const [ttl, setTtl] = useState<CustomTtl>("1d");
	const [uses, setUses] = useState(4);
	const createInvite = useCreateInvite();
	// O resumo diz até quando vale contando de agora: anda com o relógio.
	const now = useNow(30_000);

	const custom =
		CUSTOM_TTLS.find((option) => option.value === ttl) ?? CUSTOM_TTLS[1];
	const limits =
		preset === "custom"
			? { ttlSecs: custom.secs, maxUses: uses }
			: PRESET_LIMITS[preset];
	const summary = `Vale até ${dayAndTime(now / 1000 + limits.ttlSecs, now)} · ${peopleText(limits.maxUses)}`;

	function create() {
		const request: CreateInviteRequest =
			preset === "custom"
				? { preset, ttl_secs: custom.secs, max_uses: uses }
				: { preset };
		createInvite.mutate(request, { onSuccess: onCreated });
	}

	return (
		<div className="flex flex-col gap-5 rounded-xl border border-border bg-card p-5">
			<ChoiceCardGroup
				aria-label="Tipo de convite"
				value={preset}
				onValueChange={(value) => setPreset(value as Preset)}
				className="grid-cols-1 @2xl:grid-cols-3"
			>
				{(Object.keys(PRESETS) as Preset[]).map((key) => (
					<ChoiceCard
						key={key}
						value={key}
						icon={ICONS[key]}
						title={PRESETS[key].title}
						description={PRESETS[key].summary}
					/>
				))}
			</ChoiceCardGroup>

			{preset === "custom" && (
				<CustomFields
					ttl={ttl}
					onTtlChange={setTtl}
					uses={uses}
					onUsesChange={setUses}
				/>
			)}

			<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-border pt-4">
				{createInvite.isError ? (
					<>
						<span
							role="alert"
							className="flex items-center gap-2 text-[13px] text-destructive-text"
						>
							<CircleAlertIcon className="size-[15px] shrink-0" />
							Não deu para criar o convite. Tente de novo.
						</span>
						<Button onClick={create}>
							<TicketIcon className="size-[15px]" />
							Tentar de novo
						</Button>
					</>
				) : (
					<>
						<span className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
							<ClockIcon className="size-3.5 shrink-0" />
							{summary}
						</span>
						<Button onClick={create} disabled={createInvite.isPending}>
							{createInvite.isPending ? (
								<Spinner />
							) : (
								<TicketIcon className="size-[15px]" />
							)}
							Criar convite
						</Button>
					</>
				)}
			</div>
		</div>
	);
}

interface CustomFieldsProps {
	ttl: CustomTtl;
	onTtlChange: (ttl: CustomTtl) => void;
	uses: number;
	onUsesChange: (uses: number) => void;
}

/** "Vale por" e "Quantas pessoas", com o mesmo limite da API (de 1 a 50). */
function CustomFields({
	ttl,
	onTtlChange,
	uses,
	onUsesChange,
}: CustomFieldsProps) {
	const usesLabel = useId();
	return (
		<div className="flex flex-wrap items-end gap-x-8 gap-y-4 duration-280 animate-in fade-in-0 slide-in-from-bottom-2">
			<div className="flex flex-col gap-2">
				<span className="text-xs font-semibold text-muted-foreground">
					Vale por
				</span>
				<Segmented
					aria-label="Vale por"
					value={ttl}
					onValueChange={(value) => onTtlChange(value as CustomTtl)}
				>
					{CUSTOM_TTLS.map((option) => (
						<SegmentedItem key={option.value} value={option.value}>
							{option.label}
						</SegmentedItem>
					))}
				</Segmented>
			</div>
			<div className="flex flex-col gap-2">
				<span
					id={usesLabel}
					className="text-xs font-semibold text-muted-foreground"
				>
					Quantas pessoas
				</span>
				<div className="flex items-center gap-8">
					<div
						role="group"
						aria-labelledby={usesLabel}
						className="flex h-[38px] items-center rounded-[9px] border border-border bg-rail px-0.5"
					>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Menos pessoas"
							disabled={uses <= MIN_USES}
							onClick={() => onUsesChange(Math.max(MIN_USES, uses - 1))}
						>
							<MinusIcon className="size-[15px]" strokeWidth={2.5} />
						</Button>
						<span
							aria-live="polite"
							className="min-w-10 text-center text-[15px] font-semibold text-foreground tabular-nums"
						>
							{uses}
						</span>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Mais pessoas"
							disabled={uses >= MAX_USES}
							onClick={() => onUsesChange(Math.min(MAX_USES, uses + 1))}
						>
							<PlusIcon className="size-[15px]" strokeWidth={2.5} />
						</Button>
					</div>
					<span className="text-xs text-foreground-subtle">De 1 a 50.</span>
				</div>
			</div>
		</div>
	);
}
