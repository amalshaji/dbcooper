import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!globalThis.document) GlobalRegistrator.register();

const duckDbHelper = await import("../lib/duckdbHelper");
mock.module("@/lib/duckdbHelper", () => duckDbHelper);

const { cleanup, render, screen } = await import("@testing-library/react");
const { DuckDbHelperProgress } = await import("./DuckDbHelperProgress");

afterEach(cleanup);

test("keeps progress metadata on two fixed single-line rows", () => {
	render(
		<DuckDbHelperProgress
			progress={{
				stage: "downloading",
				downloadedBytes: 17_825_792,
				totalBytes: 17_825_792,
			}}
		/>,
	);

	const metadata = screen.getByTestId("duckdb-progress-metadata");
	expect(metadata.className).toContain("grid-rows-2");
	expect(screen.getByTestId("duckdb-progress-detail").className).toContain(
		"whitespace-nowrap",
	);
});

test("uses separate indeterminate motion and transform-only determinate progress", () => {
	const { rerender } = render(
		<DuckDbHelperProgress
			progress={{
				stage: "downloading",
				downloadedBytes: 0,
				totalBytes: null,
			}}
		/>,
	);

	expect(screen.getByTestId("duckdb-progress-indeterminate")).not.toBeNull();

	rerender(
		<DuckDbHelperProgress
			progress={{
				stage: "downloading",
				downloadedBytes: 25,
				totalBytes: 100,
			}}
		/>,
	);

	const fill = screen.getByTestId("duckdb-progress-determinate");
	expect(fill.style.transform).toBe("scaleX(0.25)");
	expect(fill.style.width).toBe("");
});

test("keeps the same progress shell through every download stage", () => {
	const states = [
		{
			progress: {
				stage: "downloading" as const,
				downloadedBytes: 0,
				totalBytes: null,
			},
			detail: "Preparing download",
			percent: null,
		},
		{
			progress: {
				stage: "downloading" as const,
				downloadedBytes: 524_288,
				totalBytes: null,
			},
			detail: "512 KB downloaded",
			percent: null,
		},
		{
			progress: {
				stage: "downloading" as const,
				downloadedBytes: 9_804_186,
				totalBytes: 17_825_792,
			},
			detail: "9.4 MB of 17.0 MB · 55%",
			percent: 55,
		},
		{
			progress: {
				stage: "verifying" as const,
				downloadedBytes: 17_825_792,
				totalBytes: 17_825_792,
			},
			detail: "17.0 MB of 17.0 MB · 100%",
			percent: 100,
		},
		{
			progress: {
				stage: "installing" as const,
				downloadedBytes: 0,
				totalBytes: null,
			},
			detail: "Finalizing setup",
			percent: null,
		},
		{
			progress: {
				stage: "ready" as const,
				downloadedBytes: 0,
				totalBytes: null,
			},
			detail: "100%",
			percent: 100,
		},
	];

	const { rerender } = render(
		<DuckDbHelperProgress progress={states[0].progress} />,
	);
	for (const state of states) {
		rerender(<DuckDbHelperProgress progress={state.progress} />);
		expect(screen.getByTestId("duckdb-progress-detail").textContent).toBe(
			state.detail,
		);
		expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
			state.percent === null ? null : String(state.percent),
		);
	}
});
