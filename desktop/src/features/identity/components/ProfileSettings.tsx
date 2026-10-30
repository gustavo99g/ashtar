/**
 * Configurações › Perfil (quadro "Perfil"): o nome visível, o nick fixo e a prévia do nome no
 * chat e na sala.
 *
 * O nome só vai para a API no Salvar da barra de baixo (ou no Enter). Quem decide se ele vale é
 * a API: o `invalid_display_name` aparece no campo, com a mensagem dela. Em branco, o grupo vê o
 * nick. Numa chamada, o nome novo só aparece na sala na próxima entrada (o LiveKit guarda o nome
 * de quando a pessoa entrou), e uma linha avisa isso. Quem diz se há chamada é a rota (`inCall`):
 * a voz importa a identidade, então a identidade não importa a voz.
 */
import { InfoIcon, LockIcon } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isApiError, type UserView } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useMe, useUpdateMe } from "../queries";
import { Avatar } from "./Avatar";

/** O limite da API (`DISPLAY_NAME_MAX`), em caracteres. */
const MAX_LENGTH = 32;

const titleClass =
	"text-xs leading-tight font-bold tracking-[0.06em] text-muted-foreground uppercase";
const smallTitleClass =
	"text-[11px] leading-tight font-bold tracking-[0.06em] text-muted-foreground uppercase";
const helpClass = "text-xs leading-normal text-muted-foreground";

/** A prévia: o cartão de quem clica no nome, uma mensagem no chat e a linha na sala de voz. */
function Preview({ nick, name }: { nick: string; name: string | null }) {
	const id = useId();
	const shown = name ?? nick;

	return (
		<section aria-labelledby={id} className="flex flex-col gap-3">
			<h2 id={id} className={titleClass}>
				Prévia
			</h2>
			<div className="overflow-hidden rounded-2xl border border-border bg-card">
				<div
					aria-hidden="true"
					className="h-16 bg-linear-135 from-selected to-primary"
				/>
				<div className="flex flex-col gap-3.5 px-[18px] pb-[18px]">
					<div className="relative -mt-9 size-[72px]">
						<Avatar
							nick={nick}
							displayName={name}
							size={64}
							className="box-content border-4 border-card"
						/>
						<span
							role="img"
							aria-label="Disponível"
							className="absolute -right-0.5 -bottom-0.5 box-content size-3.5 rounded-full border-4 border-card bg-status-online"
						/>
					</div>
					<div className="flex min-w-0 flex-col gap-0.5">
						<span className="truncate text-lg leading-tight font-bold text-gold">
							{shown}
						</span>
						<span className="text-[13px] leading-tight text-muted-foreground">
							{nick}
						</span>
					</div>
					<span aria-hidden="true" className="h-px bg-border" />
					<div className="flex flex-col gap-2">
						<span className={smallTitleClass}>No chat</span>
						<div className="flex gap-2.5">
							<Avatar nick={nick} displayName={name} size={32} />
							<div className="flex min-w-0 flex-col gap-0.5">
								<span className="flex min-w-0 items-baseline gap-1.5">
									<span className="truncate text-sm leading-tight font-semibold text-gold">
										{shown}
									</span>
									<span className="shrink-0 text-[11px] leading-tight text-muted-foreground">
										21:02
									</span>
								</span>
								<span className="text-sm leading-tight text-secondary-foreground">
									Vai me negar um prato de comida?
								</span>
							</div>
						</div>
					</div>
					<div className="flex flex-col gap-2">
						<span className={smallTitleClass}>Na sala de voz</span>
						<div className="flex min-w-0 items-center gap-2">
							<Avatar nick={nick} displayName={name} size={22} />
							<span className="truncate text-sm leading-tight text-gold">
								{shown}
							</span>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

function ProfileForm({ user, inCall }: { user: UserView; inCall: boolean }) {
	const nameId = useId();
	const nickId = useId();
	const saved = user.display_name ?? "";
	const [name, setName] = useState(saved);
	const [fieldError, setFieldError] = useState<string | null>(null);
	const [saveFailed, setSaveFailed] = useState(false);
	const update = useUpdateMe();

	const trimmed = name.trim();
	const changed = trimmed !== saved;

	function type(value: string) {
		setName(Array.from(value).slice(0, MAX_LENGTH).join(""));
		setFieldError(null);
		setSaveFailed(false);
	}

	function undo() {
		setName(saved);
		setFieldError(null);
		setSaveFailed(false);
	}

	function save(event: FormEvent) {
		event.preventDefault();
		if (!changed || update.isPending) return;
		setFieldError(null);
		setSaveFailed(false);
		update.mutate(trimmed === "" ? null : trimmed, {
			onSuccess: (me) => setName(me.user.display_name ?? ""),
			onError: (error) => {
				if (isApiError(error, "invalid_display_name")) {
					setFieldError(error.message);
				} else {
					setSaveFailed(true);
				}
			},
		});
	}

	return (
		<form onSubmit={save} className="flex flex-1 flex-col gap-14">
			<div className="grid items-start gap-14 @2xl:grid-cols-[minmax(0,1fr)_340px]">
				<div className="flex flex-col gap-8">
					<section className="flex flex-col gap-2">
						<div className="flex items-baseline justify-between">
							<label htmlFor={nameId} className={titleClass}>
								Nome visível
							</label>
							<span
								aria-hidden="true"
								className="font-mono text-[11px] leading-tight text-muted-foreground"
							>
								{Array.from(name).length}/{MAX_LENGTH}
							</span>
						</div>
						<Input
							id={nameId}
							value={name}
							onChange={(event) => type(event.target.value)}
							maxLength={MAX_LENGTH}
							autoComplete="off"
							spellCheck={false}
							placeholder={user.nick}
							aria-invalid={fieldError ? true : undefined}
							aria-describedby={`${nameId}-help`}
							className="border-border bg-rail"
						/>
						<p
							id={`${nameId}-help`}
							className={cn(helpClass, fieldError && "text-destructive-text")}
						>
							{fieldError ??
								(trimmed === ""
									? "Em branco, aparece o seu nick."
									: "É o que o grupo vê. Pode ser igual ao de outra pessoa.")}
						</p>
						{inCall && (
							<p className={cn(helpClass, "flex items-start gap-1.5")}>
								<InfoIcon
									aria-hidden="true"
									className="mt-0.5 size-3.5 shrink-0 text-info-text"
								/>
								Você está numa chamada: na sala, o nome novo vale na próxima
								entrada.
							</p>
						)}
					</section>

					<section className="flex flex-col gap-2">
						<span id={nickId} className={titleClass}>
							Nick
						</span>
						<div
							role="textbox"
							aria-readonly="true"
							aria-labelledby={nickId}
							aria-describedby={`${nickId}-help`}
							className="flex h-11 items-center justify-between rounded-lg border border-border bg-card px-3.5 text-[15px] text-secondary-foreground"
						>
							{user.nick}
							<LockIcon
								aria-hidden="true"
								className="size-4 text-foreground-subtle"
							/>
						</div>
						<p id={`${nickId}-help`} className={helpClass}>
							Único e fixo, não pode ser trocado.
						</p>
					</section>
				</div>

				<Preview nick={user.nick} name={trimmed === "" ? null : trimmed} />
			</div>

			{changed && (
				<div
					role="region"
					aria-label="Alterações não salvas"
					className={cn(
						"sticky bottom-8 mt-auto flex items-center gap-3 rounded-xl border py-2.5 pr-2.5 pl-[18px] shadow-toast",
						saveFailed
							? "border-destructive-border bg-destructive-subtle"
							: "border-border-strong bg-rail",
					)}
				>
					<span
						role="status"
						className={cn(
							"flex-1 text-sm",
							saveFailed ? "text-destructive-text" : "text-foreground",
						)}
					>
						{saveFailed
							? "Não deu para salvar. Tente de novo."
							: "Você tem alterações que não foram salvas."}
					</span>
					<Button
						variant="ghost"
						className="px-3.5 text-sm font-medium"
						onClick={undo}
					>
						Desfazer
					</Button>
					<Button
						type="submit"
						className="px-[18px] text-sm"
						disabled={update.isPending}
					>
						{saveFailed ? "Tentar de novo" : "Salvar"}
					</Button>
				</div>
			)}
		</form>
	);
}

export function ProfileSettings({ inCall }: { inCall: boolean }) {
	const user = useMe().data?.user;

	return (
		<div className="@container flex min-h-full w-full flex-col gap-9 py-20 pr-28 pl-32">
			<h1 className="text-[22px] leading-tight font-bold text-foreground">
				Perfil
			</h1>
			{/* A chave recomeça o formulário se a conta mudar (outra pessoa neste computador). */}
			{user && <ProfileForm key={user.id} user={user} inCall={inCall} />}
		</div>
	);
}
