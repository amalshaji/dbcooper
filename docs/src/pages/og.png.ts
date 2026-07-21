import sharp from "sharp";
import appIconDataUrl from "../../../icon.png?inline";

export const prerender = true;

const ogMarkup = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M32 0H0V32" fill="none" stroke="#45c9e8" stroke-opacity="0.08"/>
    </pattern>
    <radialGradient id="glow" cx="72%" cy="28%" r="58%">
      <stop offset="0" stop-color="#167a99" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#04131d" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#020b11"/>
  <rect width="1200" height="630" fill="url(#grid)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <path d="M28 54V28H54M1146 28H1172V54M28 576V602H54M1146 602H1172V576" fill="none" stroke="#45c9e8" stroke-opacity="0.5" stroke-width="2"/>
  <image href="${appIconDataUrl}" x="76" y="68" width="80" height="80"/>
  <text x="178" y="122" fill="#f6f1e8" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="700">DBcooper</text>
  <text x="78" y="267" fill="#f6f1e8" font-family="Arial, Helvetica, sans-serif" font-size="76" font-weight="700" letter-spacing="-3">Talk to your</text>
  <text x="78" y="351" fill="#45c9e8" font-family="Arial, Helvetica, sans-serif" font-size="76" font-weight="700" letter-spacing="-3">databases</text>
  <text x="78" y="422" fill="#a2b5bd" font-family="Menlo, Consolas, monospace" font-size="24">PostgreSQL  ·  SQLite  ·  Redis  ·  ClickHouse</text>
  <text x="78" y="552" fill="#617e8a" font-family="Menlo, Consolas, monospace" font-size="19">Native macOS database client</text>
  <text x="1122" y="552" text-anchor="end" fill="#ff7569" font-family="Menlo, Consolas, monospace" font-size="19">Free &amp; open source</text>
</svg>`;

export async function GET() {
	const image = await sharp(Buffer.from(ogMarkup)).png().toBuffer();

	return new Response(new Uint8Array(image), {
		headers: {
			"Content-Type": "image/png",
			"Cache-Control": "public, max-age=31536000, immutable",
		},
	});
}
