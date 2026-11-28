/** Os aparelhos de transmissão (ADR 0038): parear, listar e desvincular, pela sessão do app. */
import { apiFetch, apiJson, jsonRequest } from "../client";
import type {
	PairCodeResponse,
	RenameStreamDeviceRequest,
	StreamDevice,
} from "../generated";

/** `GET /api/stream-devices`: os aparelhos de quem pede, do mais antigo ao mais novo. */
export function listStreamDevices(): Promise<StreamDevice[]> {
	return apiJson<StreamDevice[]>("/api/stream-devices");
}

/** `POST /api/stream-devices/pair-code`: um código de 10 minutos, que vale uma vez. */
export function createStreamPairCode(): Promise<PairCodeResponse> {
	return apiJson<PairCodeResponse>("/api/stream-devices/pair-code", {
		method: "POST",
	});
}

/** `PATCH /api/stream-devices/{id}`: troca o nome. */
export function renameStreamDevice(
	id: string,
	name: string,
): Promise<StreamDevice> {
	const request: RenameStreamDeviceRequest = { name };
	return apiJson<StreamDevice>(
		`/api/stream-devices/${encodeURIComponent(id)}`,
		jsonRequest("PATCH", request),
	);
}

/** `DELETE /api/stream-devices/{id}`: o aparelho sai, e a transmissão dele cai. */
export async function unlinkStreamDevice(id: string): Promise<void> {
	await apiFetch(`/api/stream-devices/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
}
