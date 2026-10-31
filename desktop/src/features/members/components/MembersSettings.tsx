import { UserPlusIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Chip, ChipGroup } from "@/components/ui/chip";
import { ErrorState, LoadingState, OfflineState } from "@/components/ui/states";
import { isApiError } from "@/lib/api";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";
import {
	filterCounts,
	filterMembers,
	type MemberFilter,
	memberName,
} from "../members";
import { useMembers, useSetMemberBeta } from "../queries";
import { FirstInvite } from "./FirstInvite";
import { MEMBER_GRID, MemberRow } from "./MemberRow";

/*
 * Configurações › Painel de controle › Membros (quadros "Membros" e "Membros (primeiro uso)"). A
 * lista vem numa chamada só; os chips filtram aqui. Só aparece no menu com `can_view_panel`, e a
 * API responde 403 a quem não pode.
 *
 * A página é um contêiner (`@container`): as colunas se arrumam pela largura que sobra ao lado do
 * menu, e não pela janela.
 */

const CHIPS: { value: MemberFilter; label: string; tone?: "gold" }[] = [
	{ value: "all", label: "Todos" },
	// O beta é dourado em todo o app, como o selo BETA do Aplicativo e a chave ligada.
	{ value: "beta", label: "Beta", tone: "gold" },
	{ value: "noDevice", label: "Sem computador" },
	{ value: "removed", label: "Removidos" },
];

export function MembersSettings() {
	const navigate = useNavigate();
	const members = useMembers();
	const setBeta = useSetMemberBeta();
	const [filter, setFilter] = useState<MemberFilter>("all");
	const [actionError, setActionError] = useState<string | null>(null);

	const all = members.data ?? [];
	// Primeiro uso: só o dono no grupo.
	const solo = all.length === 1;
	const counts = filterCounts(all);
	const shown = solo ? all : filterMembers(all, filter);

	function changeBeta(id: string, name: string, enabled: boolean) {
		setActionError(null);
		setBeta.mutate(
			{ id, enabled },
			{
				onError: (error) =>
					setActionError(
						`Não deu para mudar o beta de ${name}. ${error.message}`,
					),
			},
		);
	}

	return (
		<div className="@container flex w-full flex-col gap-5 py-20 pr-28 pl-32">
			<div className="flex min-h-9 flex-wrap items-center justify-between gap-4">
				<h1 className="text-[22px] leading-tight font-bold text-foreground">
					Membros
				</h1>
				{members.isSuccess && !solo && (
					<Button
						variant="outline"
						className="px-3.5 font-medium text-foreground"
						onClick={() =>
							void navigate(paths.settings.invites, { replace: true })
						}
					>
						<UserPlusIcon className="size-[15px]" />
						Convidar alguém
					</Button>
				)}
			</div>

			{members.isPending ? (
				<LoadingState className="py-16" />
			) : members.isError ? (
				isApiError(members.error, "network") ||
				isApiError(members.error, "timeout") ? (
					<OfflineState
						className="py-16"
						onRetry={() => void members.refetch()}
					/>
				) : (
					<ErrorState
						className="py-16"
						onRetry={() => void members.refetch()}
					/>
				)
			) : (
				<>
					{!solo && (
						<ChipGroup
							aria-label="Filtrar membros"
							value={filter}
							onValueChange={(value) => setFilter(value as MemberFilter)}
						>
							{CHIPS.map((chip) => (
								<Chip
									key={chip.value}
									value={chip.value}
									tone={chip.tone}
									count={counts[chip.value]}
								>
									{chip.label}
								</Chip>
							))}
						</ChipGroup>
					)}

					{actionError && (
						<p role="alert" className="text-[13px] text-destructive-text">
							{actionError}
						</p>
					)}

					<div>
						<div
							aria-hidden="true"
							className={cn(
								MEMBER_GRID,
								"pr-2.5 pb-2.5 pl-3.5 text-[11px] font-bold tracking-[0.06em] text-foreground-subtle uppercase",
							)}
						>
							<span>Membro</span>
							<span className="hidden @3xl:block">Computador</span>
							<span className="hidden @3xl:block">Entrou</span>
							<span>Beta</span>
							<span />
						</div>
						<ul aria-label="Membros" className="border-b border-border">
							{shown.map((member) => (
								<MemberRow
									key={member.id}
									member={member}
									onBetaChange={(enabled) =>
										changeBeta(member.id, memberName(member), enabled)
									}
								/>
							))}
						</ul>
						{shown.length === 0 && (
							<div className="flex flex-col items-center gap-2.5 py-10 text-foreground-subtle">
								<UsersIcon className="size-[22px]" />
								<span className="text-[13px]">Ninguém aqui.</span>
							</div>
						)}
						{solo && <FirstInvite owner={all[0]} />}
					</div>
				</>
			)}
		</div>
	);
}
