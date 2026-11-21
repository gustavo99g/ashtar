import { FileArchiveIcon, HardDriveIcon } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/components/ui/toast";
import { paths } from "@/lib/paths";
import { size } from "../model/format";
import { onDiskAlert, onLogsReceived } from "../realtime";

/**
 * O aviso no canto para o dono quando chegam logs de alguém (v0.6, decisão 17), com Ver logs, e
 * quando o disco do servidor passa de 80% (ADR 0031), com Ver servidor. Fica montado com a moldura,
 * como o de quem entrou. Não desenha nada.
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
	useEffect(
		() =>
			onDiskAlert((alert) => {
				const id = toast.add({
					title: "O disco do servidor está quase cheio",
					description: `Sobram ${size(alert.free_bytes)} de ${size(alert.total_bytes)}. Com menos de 1 GB, ninguém consegue mandar arquivos.`,
					data: {
						media: (
							<span className="flex size-9 items-center justify-center rounded-full bg-warning/20 text-warning [&_svg]:size-[18px]">
								<HardDriveIcon aria-hidden="true" />
							</span>
						),
					},
					actionProps: {
						children: "Ver servidor",
						onClick: () => {
							toast.close(id);
							void navigate(paths.settings.server);
						},
					},
				});
			}),
		[navigate],
	);
	return null;
}
