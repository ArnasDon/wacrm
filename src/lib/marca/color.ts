const HEX = /^#[0-9a-fA-F]{6}$/;

export function esHexColor(v: string): boolean {
  return HEX.test(v);
}

export type TokensDeColor = {
  primary: string;
  primaryForeground: string;
  hover: string;
  soft: string;
  soft2: string;
};

function aLineal(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 3;
}

/** sRGB (#rrggbb) → OKLCH, con la matriz de Björn Ottosson. */
function hexAOklch(hex: string): { l: number; c: number; h: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = aLineal(((n >> 16) & 255) / 255);
  const g = aLineal(((n >> 8) & 255) / 255);
  const b = aLineal((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  const h = c < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

const f = (x: number, d = 3) => String(Number(x.toFixed(d)));

/** Deriva los tokens `--primary*` de un color de marca `#rrggbb`. */
export function tokensDeColor(hex: string): TokensDeColor {
  const { l, c, h } = hexAOklch(hex);
  const base = `${f(l)} ${f(c)} ${f(h, 1)}`;
  const hover = `${f(Math.min(l + 0.07, 0.95))} ${f(c)} ${f(h, 1)}`;
  return {
    primary: `oklch(${base})`,
    // Umbral de legibilidad: sobre colores claros el texto va oscuro.
    primaryForeground:
      l > 0.72 ? `oklch(0.16 0.02 ${f(h, 1)})` : 'oklch(0.985 0 0)',
    hover: `oklch(${hover})`,
    soft: `oklch(${base} / 0.12)`,
    soft2: `oklch(${base} / 0.2)`,
  };
}
