import { ArchiveIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { TextField } from "@/components/ui/text-field";
import type { CategoryView, ChannelView } from "@/lib/api";
import { paths } from "@/lib/paths";
import {
	useArchiveCategory,
	useArchiveChannel,
	useCreateCategory,
	useCreateChannel,
	useRenameCategory,
	useUpdateChannel,
} from "../queries";
import {
	type ChannelDialog,
	closeChannelDialog,
	useChannelDialog,
} from "../stores/dialogStore";
import { DEFAULT_CHANNEL_ID } from "../stores/lastChannelStore";

/** Os limites da API (Etapa 4). */
const NAME_MAX = 32;
const TOPIC_MAX = 120;

/**
 * Os diálogos de canais e categorias: criar, editar, renomear e arquivar. Montado uma vez no
 * `AppShell`; quem abre chama `openChannelDialog`.
 */
export function ChannelDialogs() {
	const dialog = useChannelDialog((state) => state.dialog);
	return (
		<Dialog
			open={dialog !== null}
			onOpenChange={(open) => !open && closeChannelDialog()}
		>
			<DialogContent>
				{dialog && <Content key={dialogKey(dialog)} dialog={dialog} />}
			</DialogContent>
		</Dialog>
	);
}

function dialogKey(dialog: ChannelDialog): string {
	switch (dialog.kind) {
		case "createChannel":
			return `${dialog.kind}:${dialog.categoryId}`;
		case "editChannel":
		case "archiveChannel":
			return `${dialog.kind}:${dialog.channel.id}`;
		case "renameCategory":
		case "archiveCategory":
			return `${dialog.kind}:${dialog.category.id}`;
		case "createCategory":
			return dialog.kind;
	}
}

function Content({ dialog }: { dialog: ChannelDialog }) {
	switch (dialog.kind) {
		case "createChannel":
			return <CreateChannel categoryId={dialog.categoryId} />;
		case "editChannel":
			return (
				<EditChannel
					channel={dialog.channel}
					focusTopic={dialog.focus === "topic"}
				/>
			);
		case "archiveChannel":
			return <ArchiveChannel channel={dialog.channel} />;
		case "createCategory":
			return <CategoryName />;
		case "renameCategory":
			return <CategoryName category={dialog.category} />;
		case "archiveCategory":
			return <ArchiveCategory category={dialog.category} />;
	}
}

/** O nome como a API vai gravar o de um canal de texto: minúsculas e `-` no lugar de espaço. */
export function previewTextName(name: string): string {
	return name.trim().toLowerCase().split(/\s+/).filter(Boolean).join("-");
}

function Footer({
	pending,
	submit,
	danger = false,
}: {
	pending: boolean;
	submit: string;
	danger?: boolean;
}) {
	return (
		<DialogFooter>
			<DialogClose render={<Button variant="ghost" className="font-medium" />}>
				Cancelar
			</DialogClose>
			<Button
				type="submit"
				variant={danger ? "danger" : "primary"}
				disabled={pending}
			>
				{pending && <Spinner />}
				{submit}
			</Button>
		</DialogFooter>
	);
}

function CreateChannel({ categoryId }: { categoryId: string | null }) {
	const create = useCreateChannel();
	const navigate = useNavigate();
	const [name, setName] = useState("");
	const [topic, setTopic] = useState("");

	function onSubmit(event: FormEvent) {
		event.preventDefault();
		create.mutate(
			{ name, category_id: categoryId ?? undefined, topic: topic || undefined },
			{
				onSuccess: (channel) => {
					closeChannelDialog();
					void navigate(paths.channel(channel.id));
				},
			},
		);
	}

	const shown = previewTextName(name);
	return (
		<form onSubmit={onSubmit} className="flex flex-col gap-5">
			<DialogTitle className="text-base">Criar canal de texto</DialogTitle>
			<TextField
				label="Nome"
				autoFocus
				value={name}
				maxLength={NAME_MAX}
				showCount
				onChange={(event) => setName(event.target.value)}
				description={shown ? `Vai aparecer como #${shown}.` : undefined}
				error={create.error?.message}
			/>
			<TextField
				label="Tópico (opcional)"
				value={topic}
				maxLength={TOPIC_MAX}
				showCount
				onChange={(event) => setTopic(event.target.value)}
			/>
			<Footer pending={create.isPending} submit="Criar canal" />
		</form>
	);
}

function EditChannel({
	channel,
	focusTopic,
}: {
	channel: ChannelView;
	focusTopic: boolean;
}) {
	const update = useUpdateChannel();
	const [name, setName] = useState(channel.name);
	const [topic, setTopic] = useState(channel.topic ?? "");
	const text = channel.kind === "text";

	function onSubmit(event: FormEvent) {
		event.preventDefault();
		update.mutate(
			{ id: channel.id, name, ...(text ? { topic } : {}) },
			{ onSuccess: closeChannelDialog },
		);
	}

	return (
		<form onSubmit={onSubmit} className="flex flex-col gap-5">
			<DialogTitle className="text-base">
				{text ? `Editar #${channel.name}` : `Editar ${channel.name}`}
			</DialogTitle>
			<TextField
				label="Nome"
				autoFocus={!focusTopic}
				value={name}
				maxLength={NAME_MAX}
				showCount
				onChange={(event) => setName(event.target.value)}
				description={
					text ? `Vai aparecer como #${previewTextName(name)}.` : undefined
				}
				error={update.error?.message}
			/>
			{text && (
				<TextField
					label="Tópico"
					autoFocus={focusTopic}
					value={topic}
					maxLength={TOPIC_MAX}
					showCount
					onChange={(event) => setTopic(event.target.value)}
					description="Aparece no cabeçalho do canal. Em branco, some."
				/>
			)}
			<Footer pending={update.isPending} submit="Salvar" />
		</form>
	);
}

function CategoryName({ category }: { category?: CategoryView }) {
	const create = useCreateCategory();
	const rename = useRenameCategory();
	const [name, setName] = useState(category?.name ?? "");
	const mutation = category ? rename : create;

	function onSubmit(event: FormEvent) {
		event.preventDefault();
		if (category)
			rename.mutate(
				{ id: category.id, name },
				{ onSuccess: closeChannelDialog },
			);
		else create.mutate(name, { onSuccess: closeChannelDialog });
	}

	return (
		<form onSubmit={onSubmit} className="flex flex-col gap-5">
			<DialogTitle className="text-base">
				{category ? "Renomear categoria" : "Criar categoria"}
			</DialogTitle>
			<TextField
				label="Nome"
				autoFocus
				value={name}
				maxLength={NAME_MAX}
				showCount
				onChange={(event) => setName(event.target.value)}
				error={mutation.error?.message}
			/>
			<Footer
				pending={mutation.isPending}
				submit={category ? "Salvar" : "Criar categoria"}
			/>
		</form>
	);
}

function ArchiveBody({
	title,
	description,
	error,
	pending,
	onConfirm,
}: {
	title: string;
	description: string;
	error?: string;
	pending: boolean;
	onConfirm: () => void;
}) {
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				onConfirm();
			}}
			className="flex flex-col gap-5"
		>
			<div className="flex gap-3.5">
				<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
					<ArchiveIcon className="size-[19px]" />
				</span>
				<div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
					<DialogTitle className="text-base">{title}</DialogTitle>
					<DialogDescription className="text-[13px] leading-[1.55]">
						{description}
					</DialogDescription>
				</div>
			</div>
			{error && (
				<p role="alert" className="text-[13px] text-destructive-text">
					{error}
				</p>
			)}
			<Footer pending={pending} submit="Arquivar" danger />
		</form>
	);
}

function ArchiveChannel({ channel }: { channel: ChannelView }) {
	const archive = useArchiveChannel();
	const navigate = useNavigate();
	// Arquivando o canal aberto, quem arquivou vai para o #geral em vez de cair no "não existe".
	const open =
		useMatch(paths.channelPattern)?.params.channelId === channel.id;
	return (
		<ArchiveBody
			title={`Arquivar #${channel.name}?`}
			description="O canal some da lista para todo mundo. As mensagens ficam guardadas, e quem gerencia os canais pode desarquivar nas configurações."
			error={archive.error?.message}
			pending={archive.isPending}
			onConfirm={() =>
				archive.mutate(channel.id, {
					onSuccess: () => {
						closeChannelDialog();
						if (open) void navigate(paths.channel(DEFAULT_CHANNEL_ID));
					},
				})
			}
		/>
	);
}

function ArchiveCategory({ category }: { category: CategoryView }) {
	const archive = useArchiveCategory();
	return (
		<ArchiveBody
			title={`Arquivar a categoria ${category.name}?`}
			description="Os canais dela não somem: vão para o topo da lista."
			error={archive.error?.message}
			pending={archive.isPending}
			onConfirm={() =>
				archive.mutate(category.id, { onSuccess: closeChannelDialog })
			}
		/>
	);
}
