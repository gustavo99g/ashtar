/**
 * Configurações › Dispositivos (ADR 0038): os aparelhos de transmissão, como o Odin 3, que
 * transmitem a tela deles para a sala ou a ligação em que você está. Aqui você pareia um aparelho
 * novo (o código e o endereço que o Ashtar Transmissor pede), renomeia e desvincula os pareados.
 *
 * O menu só mostra a página para quem tem "Transmitir de um aparelho" (`can_stream_from_device`);
 * quem decide de verdade é a API.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CheckIcon,
	CopyIcon,
	GamepadIcon,
	LogOutIcon,
	MonitorSmartphoneIcon,
	PencilIcon,
	RadioIcon,
} from "lucide-react";
import {
	type FormEvent,
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useId,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { useMe } from "@/features/identity";
import {
	apiUrl,
	createStreamPairCode,
	isApiError,
	listStreamDevices,
	type PairCodeResponse,
	renameStreamDevice,
	type StreamDevice,
	unlinkStreamDevice,
} from "@/lib/api";
import { shortDate } from "@/lib/date";
import { cn } from "@/lib/utils";
import { DevicePicture } from "./DevicePicture";

const devicesKey = ["stream-devices"] as const;

/** Quantos aparelhos cada pessoa pode ter (a API recusa o quarto). */
export const MAX_DEVICES = 3;

/** Quanto o código vale, em segundos: a barra do tempo sai daqui. */
const CODE_TTL = 180;

/** "042917" → "042 917": mais fácil de ler e digitar. */
export function spacedCode(code: string): string {
	return /^\d{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** "9:41": quanto falta para o código vencer. */
export function remaining(expiresAt: number, now: number): string {
	const left = Math.max(0, expiresAt - Math.floor(now / 1000));
	const minutes = Math.floor(left / 60);
	const seconds = String(left % 60).padStart(2, "0");
	return `${minutes}:${seconds}`;
}

/** O endereço do servidor que o aparelho pede, sem barra no fim. */
export function serverAddress(): string {
	return apiUrl("");
}

/** O endereço só vale neste computador (o desenvolvimento): o aparelho precisa do IP da rede. */
export function isLocalAddress(address: string): boolean {
	try {
		const { hostname } = new URL(address);
		return hostname === "localhost" || hostname.startsWith("127.");
	} catch {
		return false;
	}
}

function errorText(error: unknown): string {
	return isApiError(error)
		? error.message
		: "Não deu certo. Tente de novo em instantes.";
}

export function StreamDevicesSettings() {
	const me = useMe();
	const allowed = me.data?.can_stream_from_device === true;
	if (me.data && !allowed) {
		return (
			<Page>
				<Header count={null} />
				<EmptyState
					className="py-16"
					icon={<GamepadIcon />}
					title="Sem a permissão para transmitir de um aparelho"
					description="Peça ao dono do grupo para liberar em Membros."
				/>
			</Page>
		);
	}
	return <Devices />;
}

function Devices() {
	const client = useQueryClient();
	const devices = useQuery({ queryKey: devicesKey, queryFn: listStreamDevices });
	const [code, setCode] = useState<PairCodeResponse | null>(null);
	// Quantos aparelhos havia quando o código saiu: um a mais quer dizer que ele foi usado.
	const [baseline, setBaseline] = useState(0);
	const list = devices.data ?? [];
	const count = list.length;
	const full = count >= MAX_DEVICES;
	const pair = useMutation({
		mutationFn: createStreamPairCode,
		onSuccess: (next) => {
			setBaseline(count);
			setCode(next);
		},
	});

	// Enquanto o código está na tela, a lista se atualiza: o aparelho novo aparece sozinho.
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!code) return;
		const clock = setInterval(() => setNow(Date.now()), 1000);
		const poll = setInterval(
			() => void client.invalidateQueries({ queryKey: devicesKey }),
			3000,
		);
		return () => {
			clearInterval(clock);
			clearInterval(poll);
		};
	}, [code, client]);
	const expired = code !== null && code.expires_at * 1000 <= now;

	// O código usado some: o aparelho que acabou de entrar está na lista, em destaque.
	const [fresh, setFresh] = useState<string | null>(null);
	useEffect(() => {
		if (code && count > baseline) {
			setCode(null);
			setFresh(list[list.length - 1]?.id ?? null);
		}
	}, [code, count, baseline, list]);

	return (
		<Page>
			<Header
				count={devices.data ? count : null}
				action={
					<Button
						disabled={full || pair.isPending || (code !== null && !expired)}
						title={
							full
								? `Você já tem ${MAX_DEVICES} aparelhos. Desvincule um para parear outro.`
								: undefined
						}
						onClick={() => pair.mutate()}
					>
						<GamepadIcon aria-hidden="true" />
						Parear um aparelho
					</Button>
				}
			/>
			{pair.error && (
				<p role="alert" className="-mt-2 text-[13px] text-destructive-text">
					{errorText(pair.error)}
				</p>
			)}

			{code && (
				<PairingCard
					code={code}
					now={now}
					expired={expired}
					onAgain={() => pair.mutate()}
					onClose={() => setCode(null)}
				/>
			)}

			<Section title="Pareados">
				{devices.isPending ? (
					<LoadingState className="py-10" />
				) : devices.isError ? (
					<p role="alert" className="text-[13px] text-destructive-text">
						{errorText(devices.error)}
					</p>
				) : count === 0 ? (
					<EmptyState
						className="rounded-xl border border-dashed border-border py-10"
						icon={<GamepadIcon />}
						title="Nenhum aparelho pareado"
						description="Pareie um portátil Android, como o Odin 3, para transmitir a tela dele no Ashtar."
					/>
				) : (
					<ul
						aria-label="Aparelhos pareados"
						className="overflow-hidden rounded-xl border border-border bg-card"
					>
						{list.map((device) => (
							<DeviceRow
								key={device.id}
								device={device}
								fresh={device.id === fresh}
							/>
						))}
					</ul>
				)}
			</Section>

			<Section title="Como funciona">
				<ul className="overflow-hidden rounded-xl border border-border bg-card">
					<Fact icon={<RadioIcon />} title="Vai para onde você está">
						Tocou em Transmitir no aparelho, a tela entra na sala ou na ligação
						em que você estiver no Ashtar.
					</Fact>
					<Fact icon={<MonitorSmartphoneIcon />} title="Junto com o computador">
						O aparelho é outra transmissão: dá para transmitir do PC e dele ao
						mesmo tempo. Na sala, ele aparece com o nome dele.
					</Fact>
					<Fact icon={<LogOutIcon />} title="Sai junto com você">
						Saiu da sala, a transmissão do aparelho cai. Desvincular também
						derruba na hora.
					</Fact>
				</ul>
			</Section>
		</Page>
	);
}

function Page({ children }: { children: ReactNode }) {
	return (
		<div className="@container flex w-full flex-col gap-8 py-20 pr-28 pl-32">
			{children}
		</div>
	);
}

function Header({
	count,
	action,
}: {
	count: number | null;
	action?: ReactNode;
}) {
	return (
		<div className="flex items-end gap-4">
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<h1 className="text-[22px] leading-tight font-bold text-foreground">
					Dispositivos
				</h1>
				<p className="text-[13px] text-muted-foreground">
					Portáteis que transmitem a tela para o Ashtar, pelo app Ashtar
					Transmissor.
					{count !== null && ` ${count} de ${MAX_DEVICES}.`}
				</p>
			</div>
			{action}
		</div>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	const id = useId();
	return (
		<section aria-labelledby={id} className="flex flex-col gap-3">
			<h2
				id={id}
				className="text-xs leading-tight font-bold tracking-[0.06em] text-muted-foreground uppercase"
			>
				{title}
			</h2>
			{children}
		</section>
	);
}

/**
 * O pareamento em andamento: os passos no aparelho à esquerda, o código grande à direita, com a
 * barra do tempo que falta. Vencido, o código fica apagado e o botão gera outro.
 */
function PairingCard({
	code,
	now,
	expired,
	onAgain,
	onClose,
}: {
	code: PairCodeResponse;
	now: number;
	expired: boolean;
	onAgain: () => void;
	onClose: () => void;
}) {
	const address = serverAddress();
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 2000);
		return () => clearTimeout(timer);
	}, [copied]);
	function copy() {
		navigator.clipboard.writeText(address).then(
			() => setCopied(true),
			() => setCopied(false),
		);
	}
	const left = Math.max(0, code.expires_at - Math.floor(now / 1000));
	return (
		<section
			aria-label="Parear um aparelho"
			className="grid gap-6 rounded-xl border border-gold-border bg-gold-wash p-6 @2xl:grid-cols-[1fr_auto]"
		>
			<ol className="flex flex-col gap-4">
				<Step n={1} title="Abra o Ashtar Transmissor no aparelho">
					Na primeira vez, ele pede o endereço do servidor e o código.
				</Step>
				<Step n={2} title="Digite o endereço do servidor">
					<span className="mt-1 flex items-center gap-2">
						<code className="truncate rounded-md bg-background px-2 py-1 font-mono text-[13px] text-foreground">
							{address}
						</code>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={copied ? "Endereço copiado" : "Copiar o endereço"}
							onClick={copy}
						>
							{copied ? <CheckIcon /> : <CopyIcon />}
						</Button>
					</span>
					{isLocalAddress(address) && (
						<span className="mt-1 block text-xs text-muted-foreground">
							Esse endereço só vale neste computador: no aparelho, troque pelo
							IP dele na rede.
						</span>
					)}
				</Step>
				<Step n={3} title="Digite o código de 6 números e toque em Parear">
					O aparelho aparece aqui embaixo assim que entrar.
				</Step>
			</ol>
			<div className="flex min-w-[260px] flex-col items-center justify-center gap-3 rounded-lg bg-card px-6 py-5">
				<span className="text-xs font-semibold text-muted-foreground">
					Código de pareamento
				</span>
				<span
					aria-label={`Código ${code.code}`}
					className={cn(
						"font-mono text-[28px] leading-none font-semibold tracking-[0.12em] text-foreground",
						expired && "text-foreground-subtle line-through",
					)}
				>
					{spacedCode(code.code)}
				</span>
				{expired ? (
					<>
						<span className="text-xs text-muted-foreground">
							O código venceu.
						</span>
						<Button size="sm" onClick={onAgain}>
							Gerar outro código
						</Button>
					</>
				) : (
					<>
						<div
							role="progressbar"
							aria-label="Tempo do código"
							aria-valuemin={0}
							aria-valuemax={CODE_TTL}
							aria-valuenow={left}
							className="h-1 w-full overflow-hidden rounded-full bg-secondary"
						>
							<div
								className="h-full rounded-full bg-gold transition-[width] duration-1000 ease-linear"
								style={{ width: `${Math.min(100, (left / CODE_TTL) * 100)}%` }}
							/>
						</div>
						<span className="text-xs text-muted-foreground">
							Vale por {remaining(code.expires_at, now)}, uma vez só
						</span>
					</>
				)}
				<Button variant="ghost" size="sm" onClick={onClose}>
					{expired ? "Fechar" : "Cancelar"}
				</Button>
			</div>
		</section>
	);
}

function Step({
	n,
	title,
	children,
}: {
	n: number;
	title: string;
	children: ReactNode;
}) {
	return (
		<li className="flex gap-3">
			<span
				aria-hidden="true"
				className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gold text-xs font-bold text-gold-foreground"
			>
				{n}
			</span>
			<div className="flex min-w-0 flex-col gap-0.5">
				<span className="text-sm font-semibold text-foreground">{title}</span>
				<span className="text-[13px] text-muted-foreground">{children}</span>
			</div>
		</li>
	);
}

function Fact({
	icon,
	title,
	children,
}: {
	icon: ReactNode;
	title: string;
	children: ReactNode;
}) {
	return (
		<li className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
			<span
				aria-hidden="true"
				className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground [&_svg]:size-4"
			>
				{icon}
			</span>
			<div className="flex min-w-0 flex-col gap-0.5">
				<span className="text-sm font-semibold text-foreground">{title}</span>
				<span className="text-[13px] text-muted-foreground">{children}</span>
			</div>
		</li>
	);
}

/**
 * Um aparelho pareado: o nome (Renomear troca na própria linha), quando foi pareado e usado, e o
 * Desvincular, que pede confirmação porque derruba a transmissão dele na hora.
 */
function DeviceRow({ device, fresh }: { device: StreamDevice; fresh: boolean }) {
	const client = useQueryClient();
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(device.name);
	const [confirming, setConfirming] = useState(false);
	const refresh = () => client.invalidateQueries({ queryKey: devicesKey });
	const rename = useMutation({
		mutationFn: (next: string) => renameStreamDevice(device.id, next),
		onSuccess: () => {
			setEditing(false);
			void refresh();
		},
	});
	const unlink = useMutation({
		mutationFn: () => unlinkStreamDevice(device.id),
		onSuccess: () => void refresh(),
	});

	function save(event: FormEvent) {
		event.preventDefault();
		const next = name.trim();
		if (!next || next === device.name) {
			setEditing(false);
			setName(device.name);
			return;
		}
		rename.mutate(next);
	}

	function onKeyDown(event: KeyboardEvent) {
		// O ESC cancela a edição, sem fechar as configurações.
		if (event.key !== "Escape") return;
		event.preventDefault();
		setEditing(false);
		setName(device.name);
		rename.reset();
	}

	const error = rename.error ?? unlink.error;
	return (
		<li
			className={cn(
				"flex flex-col gap-1 border-b border-border px-4 py-3 last:border-b-0",
				fresh && "bg-gold-wash",
			)}
		>
			<div className="flex items-center gap-3">
				<span className="flex w-16 shrink-0 items-center justify-center">
					<DevicePicture name={device.name} size={40} />
				</span>
				{editing ? (
					<form onSubmit={save} className="flex min-w-0 flex-1 items-center gap-2">
						<Input
							aria-label="Nome do aparelho"
							value={name}
							maxLength={32}
							autoFocus
							onChange={(event) => setName(event.target.value)}
							onKeyDown={onKeyDown}
							className="h-9 text-sm"
						/>
						<Button type="submit" size="sm" disabled={rename.isPending}>
							Salvar
						</Button>
					</form>
				) : (
					<div className="flex min-w-0 flex-1 flex-col">
						<span className="flex items-center gap-2 truncate text-sm font-semibold text-foreground">
							{device.name}
							{fresh && (
								<span className="rounded bg-gold px-1.5 py-px text-[10px] font-bold text-gold-foreground">
									NOVO
								</span>
							)}
						</span>
						<span className="text-xs text-muted-foreground">
							Pareado em {shortDate(device.paired_at)} · usado em{" "}
							{shortDate(device.last_seen_at)}
						</span>
					</div>
				)}
				{!editing && !confirming && (
					<>
						<Button
							variant="ghost"
							size="sm"
							aria-label={`Renomear ${device.name}`}
							onClick={() => setEditing(true)}
						>
							<PencilIcon aria-hidden="true" />
							Renomear
						</Button>
						<Button
							variant="ghost"
							size="sm"
							aria-label={`Desvincular ${device.name}`}
							onClick={() => setConfirming(true)}
						>
							Desvincular
						</Button>
					</>
				)}
				{confirming && (
					<span className="flex items-center gap-2">
						<span className="text-xs text-muted-foreground">
							Desvincular? A transmissão dele cai.
						</span>
						<Button
							variant="danger"
							size="sm"
							disabled={unlink.isPending}
							onClick={() => unlink.mutate()}
						>
							Desvincular
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setConfirming(false)}
						>
							Cancelar
						</Button>
					</span>
				)}
			</div>
			{error && (
				<p role="alert" className="pl-13 text-xs text-destructive-text">
					{errorText(error)}
				</p>
			)}
		</li>
	);
}
