/**
 * Roda antes de cada arquivo de teste (`setupFiles` no `vite.config.ts`).
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Sem `globals: true`, o Testing Library não desmonta sozinho o que cada teste renderizou.
afterEach(() => {
	cleanup();
});
