import { FileArchiveIcon } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/components/ui/toast";
import { paths } from "@/lib/paths";
import { onLogsReceived } from "../realtime";

/**
 * O aviso no canto para o dono quando chegam logs de alguém (v0.6, decisão 17), com Ver logs. Fica
 * montado com a moldura, como o de quem entrou. Não desenha nada.
 */
export function LogsNotices() {
	const navigate = useNavigate();
	useEffect(
		() =>
			onLogsReceived((report) => {
				const name = report.display_name ?? report.nick;
				const id = toast.add({
					title: (
						<>
							<strong className="font-bold">{name}</strong> mandou os logs
						</>
					),
					description: report.note ?? "Sem descrição.",
					data: {
						media: (
							<span className="flex size-9 items-center justify-center rounded-full bg-gold-subtle text-gold [&_svg]:size-[18px]">
								<FileArchiveIcon aria-hidden="true" />
							</span>
						),
					},
					actionProps: {
						children: "Ver logs",
						onClick: () => {
							toast.close(id);
							void navigate(paths.settings.logs);
						},
					},
				});
			}),
		[navigate],
	);
	return null;
}
