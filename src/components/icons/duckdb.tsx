import type { SVGProps } from "react";

export function DuckdbIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg viewBox="0 0 64 64" fill="none" aria-hidden="true" {...props}>
			<circle cx="32" cy="32" r="30" fill="#FFF100" />
			<circle cx="25" cy="32" r="11" fill="#111111" />
			<circle cx="48" cy="32" r="4" fill="#111111" />
		</svg>
	);
}
