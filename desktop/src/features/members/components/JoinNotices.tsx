import { KeyRoundIcon, TicketIcon } from "lucide-react";
import { Fragment, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "@/components/ui/toast";
import { Avatar, AvatarBadge } from "@/features/identity";
import type { MemberView } from "@/lib/api";
import { paths } from "@/lib/paths";
import { type JoinNotice, joinNotices, noticeText } from "../model/joinNotices";
import { useMembersWatch } from "../queries";

/*
 * O observador do aviso de quem entrou. Fica montado com a moldura do app (`AppShell`), enquanto
 * a sessão vive, e não desenha nada: a cada resposta nova da lista de membros, compara com a
 * anterior e mostra um aviso no canto para cada mudança. A primeira resposta depois de abrir só
 * serve de base. Quem estava com o app fechado não recebe aviso; a lista de Membros mostra quem
 * entrou.
 */

/** Quantos rostos o aviso mostra lado a lado. */
const MAX_FACES = 3;

export function JoinNotices() {
	const members = useMembersWatch();
	const navigate = useNavigate();
	const location = useLocation();
	const previous = useRef<MemberView[] | null>(null);
	// O clique em "Ver membros" acontece depois: lê onde a pessoa está naquela hora.
	const inSettings = useRef(false);
	inSettings.current = location.pathname.startsWith(paths.settings.root);

	useEffect(() => {
		const current = members.data;
		if (!current) return;
		const before = previous.current;
		previous.current = current;
		if (!before) return;

		for (const notice of joinNotices(before, current)) {
			const { names, title, description } = noticeText(notice);
			const id = toast.add({
				title: (
					<>
						{names.map((name, index) => (
							<Fragment key={name}>
								{index > 0 && (index === names.length - 1 ? " e " : ", ")}
								<strong className="font-bold">{name}</strong>
							</Fragment>
						))}{" "}
						{title}
					</>
				),
				description,
				data: { media: <NoticeFaces notice={notice} /> },
				actionProps: {
					children: "Ver membros",
					// Já nas configurações, troca a página; fora delas, abre por cima de onde está.
					onClick: () => {
						toast.close(id);
						void navigate(paths.settings.members, {
							replace: inSettings.current,
						});
					},
				},
			});
		}
	}, [members.data, navigate]);

	return null;
}

/** O rosto (ou os rostos) de quem entrou, com o selo do convite ou a chave da recuperação. */
function NoticeFaces({ notice }: { notice: JoinNotice }) {
	const people = notice.kind === "recovered" ? [notice.person] : notice.people;
	return (
		<span className="relative flex">
			{people.slice(0, MAX_FACES).map((person, index) => (
				<Avatar
					key={person.id}
					nick={person.nick}
					displayName={person.display_name}
					className={index > 0 ? "-ml-3 border-2 border-popover" : undefined}
					style={{ zIndex: MAX_FACES - index }}
				/>
			))}
			<AvatarBadge className="z-10">
				{notice.kind === "recovered" ? <KeyRoundIcon /> : <TicketIcon />}
			</AvatarBadge>
		</span>
	);
}
