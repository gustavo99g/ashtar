import {
	moveToCategory,
	useCanManageChannels,
	useChannelLayout,
	useSetLayout,
} from "@/features/channels";
import { CategoryRow } from "./CategoryRow";
import { type ChannelManage, ChannelRow } from "./ChannelRow";

/*
 * A coluna do servidor (ADRs 0016 e 0020): os canais do topo e as categorias, cada uma com os seus
 * canais de texto e salas de voz. Clicar num canal de texto abre a conversa; clicar numa sala entra
 * na chamada (quem já está nela só volta para a chamada).
 *
 * A categoria recolhe pelo nome (fica neste computador). Recolhida, ainda mostra o canal aberto, a
 * sala em que a pessoa está e as salas com gente, só com os avatares.
 *
 * A lista não tem ferramentas fixas. Quem gerencia os canais (`can_manage_channels`) vê, com o
 * mouse na linha, o + da categoria e a engrenagem do canal, e abre os mesmos menus pelo botão
 * direito. Criar canal e categoria, organizar e os arquivados ficam no menu do servidor
 * (`ServerMenu`).
 */
export function ChannelNav() {
	const { data: layout } = useChannelLayout();
	const canManage = useCanManageChannels();
	const setLayout = useSetLayout();

	if (!layout) return <div className="min-h-0 flex-1" />;

	const manage: ChannelManage | null = canManage
		? {
				categories: layout.categories,
				moveTo(channelId, categoryId) {
					// Com uma ordem ainda sendo gravada, a seguinte sairia com a versão velha e levaria
					// 409, mesmo sem ninguém ter mexido.
					if (setLayout.isPending) return;
					const next = moveToCategory(layout, channelId, categoryId);
					if (next) setLayout.mutate(next);
				},
			}
		: null;

	return (
		<nav
			aria-label="Canais"
			className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-2 pb-2"
		>
			<ul
				aria-label="Canais fora de categoria"
				className="flex min-h-1 flex-col gap-0.5"
			>
				{layout.top.map((channel) => (
					<ChannelRow
						key={channel.id}
						channel={channel}
						collapsed={false}
						manage={manage}
					/>
				))}
			</ul>
			{layout.categories.map((category) => (
				<CategoryRow key={category.id} category={category} manage={manage} />
			))}
		</nav>
	);
}
