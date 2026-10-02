import type { Ref } from "react";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Line,
	LineChart,
	Pie,
	PieChart,
	Scatter,
	ScatterChart,
	XAxis,
	YAxis,
} from "recharts";
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import {
	buildChartData,
	type ChartData,
	type ChartSpec,
	type Dataset,
	formatNumber,
	metricValue,
	type TimeAxisFormat,
	timeAxisFormat,
} from "@/lib/aiChat/chartData";

const MAX_DOTTED_POINTS = 24;

interface ResultChartProps {
	spec: ChartSpec;
	dataset: Dataset;
	containerRef?: Ref<HTMLDivElement>;
}

function chartTitle(spec: ChartSpec) {
	if (spec.title) return spec.title;
	const values = spec.y.join(", ");
	if (spec.type === "metric") return values;
	return spec.series
		? `${values} by ${spec.x}, split by ${spec.series}`
		: `${values} by ${spec.x}`;
}

function chartConfig(data: ChartData): ChartConfig {
	return Object.fromEntries(
		data.series.map((series, index) => [
			series.key,
			{ label: series.label, color: `var(--series-${index + 1})` },
		]),
	);
}

function CartesianFrame({ time }: { time: TimeAxisFormat | null }) {
	return (
		<>
			<CartesianGrid vertical={false} />
			<XAxis
				dataKey="x"
				type="category"
				tickLine={false}
				axisLine={false}
				tickMargin={8}
				minTickGap={24}
				tickFormatter={time?.tick}
			/>
			<YAxis
				type="number"
				tickLine={false}
				axisLine={false}
				width={48}
				tickFormatter={formatNumber}
			/>
		</>
	);
}

function Plot({ spec, data }: { spec: ChartSpec; data: ChartData }) {
	const legend =
		data.series.length > 1 ? (
			<ChartLegend content={<ChartLegendContent />} />
		) : null;
	const time = spec.type === "scatter" ? null : timeAxisFormat(data.points.map((point) => point.x));
	const tooltip = (
		<ChartTooltip
			content={
				<ChartTooltipContent
					labelFormatter={time ? (label) => time.tooltip(label) : undefined}
				/>
			}
		/>
	);

	switch (spec.type) {
		case "line":
			return (
				<LineChart data={data.points} accessibilityLayer>
					<CartesianFrame time={time} />
					{tooltip}
					{legend}
					{data.series.map((series) => (
						<Line
							key={series.key}
							dataKey={series.key}
							type="linear"
							stroke={`var(--color-${series.key})`}
							strokeWidth={2}
							strokeLinecap="round"
							strokeLinejoin="round"
							dot={data.points.length <= MAX_DOTTED_POINTS ? { r: 4 } : false}
							activeDot={{ r: 5 }}
							connectNulls
						/>
					))}
				</LineChart>
			);
		case "area":
			return (
				<AreaChart data={data.points} accessibilityLayer>
					<CartesianFrame time={time} />
					{tooltip}
					{legend}
					{data.series.map((series) => (
						<Area
							key={series.key}
							dataKey={series.key}
							type="linear"
							stroke={`var(--color-${series.key})`}
							strokeWidth={2}
							fill={`var(--color-${series.key})`}
							fillOpacity={0.1}
							connectNulls
						/>
					))}
				</AreaChart>
			);
		case "scatter":
			return (
				<ScatterChart accessibilityLayer>
					<CartesianGrid vertical={false} />
					<XAxis
						dataKey="x"
						type="number"
						name={spec.x ?? undefined}
						tickLine={false}
						axisLine={false}
						tickMargin={8}
						tickFormatter={formatNumber}
					/>
					<YAxis
						dataKey="y"
						type="number"
						name={spec.y[0]}
						tickLine={false}
						axisLine={false}
						width={48}
						tickFormatter={formatNumber}
					/>
					{tooltip}
					{legend}
					{data.series.map((series) => (
						<Scatter
							key={series.key}
							name={series.key}
							data={data.points
								.filter((point) => typeof point[series.key] === "number")
								.map((point) => ({ x: point.x, y: point[series.key] }))}
							fill={`var(--color-${series.key})`}
						/>
					))}
				</ScatterChart>
			);
		case "pie":
			return (
				<PieChart accessibilityLayer>
					<ChartTooltip
						content={<ChartTooltipContent nameKey="key" hideLabel />}
					/>
					<Pie
						data={data.points}
						dataKey="value"
						nameKey="key"
						innerRadius="55%"
						strokeWidth={2}
						stroke="var(--card)"
					>
						{data.points.map((point) => (
							<Cell
								key={String(point.key)}
								fill={`var(--color-${point.key})`}
							/>
						))}
					</Pie>
					<ChartLegend content={<ChartLegendContent nameKey="key" />} />
				</PieChart>
			);
		default:
			return (
				<BarChart data={data.points} accessibilityLayer barGap={2}>
					<CartesianFrame time={time} />
					{tooltip}
					{legend}
					{data.series.map((series) => (
						<Bar
							key={series.key}
							dataKey={series.key}
							fill={`var(--color-${series.key})`}
							radius={[4, 4, 0, 0]}
							maxBarSize={24}
						/>
					))}
				</BarChart>
			);
	}
}

export function ResultChart({ spec, dataset, containerRef }: ResultChartProps) {
	if (spec.type === "metric") {
		const value = metricValue(spec, dataset);
		return (
			<div ref={containerRef} className="ai-chart rounded-md bg-card p-4">
				<p className="text-xs text-muted-foreground">{chartTitle(spec)}</p>
				<p className="mt-1 text-4xl font-semibold tracking-tight">
					{value === null ? "—" : formatNumber(value)}
				</p>
			</div>
		);
	}

	const data = buildChartData(spec, dataset);
	return (
		<figure ref={containerRef} className="ai-chart rounded-md bg-card p-3">
			<figcaption className="mb-2 text-xs font-medium">
				{chartTitle(spec)}
			</figcaption>
			<ChartContainer config={chartConfig(data)} className="aspect-auto h-60 w-full">
				<Plot spec={spec} data={data} />
			</ChartContainer>
			{data.folded > 0 ? (
				<p className="mt-2 text-[11px] text-muted-foreground">
					{spec.type === "scatter"
						? `${data.folded} more groups hidden; see the table.`
						: `${data.folded} smaller groups combined into Other.`}
				</p>
			) : null}
		</figure>
	);
}

export default ResultChart;
