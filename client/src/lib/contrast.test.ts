import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import fs from "node:fs";
import path from "node:path";

/**
 * The contrast of the palette.
 *
 * The colours are written in OKLCH, which is the right way to write
 * them — but nothing in the build or the tests could tell that a
 * colour had drifted under the line. So the ratios are computed here,
 * from the stylesheet itself: a palette change that breaks a pairing
 * fails the test rather than the user's eyes.
 */

/** An OKLCH colour, as it is written in the stylesheet. */
type Colour = { L: number; C: number; h: number };

/** The OKLCH colour of a name, in the light theme or the dark one. */
function readColour(css: string, name: string, theme: "light" | "dark"): Colour {
  // The dark theme is the block that starts at `.dark`.
  const darkStart = css.indexOf(".dark {");
  const light = css.slice(0, darkStart > 0 ? darkStart : css.length);
  const dark = darkStart > 0 ? css.slice(darkStart) : "";
  const scope = theme === "dark" ? dark : light;
  const match = new RegExp(`--color-${name}:\\s*oklch\\(([^)]+)\\)`).exec(scope);
  if (!match) throw new Error(`The colour "${name}" is not in the ${theme} theme`);
  const [L, C, h] = match[1].split(/\s+/).map(Number);
  return { L, C, h };
}

/** The sRGB channels of an OKLCH colour, between 0 and 1. */
function toSrgb({ L, C, h: hDeg }: Colour): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const encode = (c: number) =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
  return [
    Math.min(1, Math.max(0, encode(lr))),
    Math.min(1, Math.max(0, encode(lg))),
    Math.min(1, Math.max(0, encode(lb))),
  ];
}

/** The relative luminance of a colour. */
function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio between two colours. */
function ratio(a: Colour, b: Colour): number {
  const la = luminance(toSrgb(a));
  const lb = luminance(toSrgb(b));
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const CSS = readFileSync(
  path.resolve(__dirname, "..", "index.css"),
  "utf-8",
);

/**
 * The opacity variants.
 *
 * The palette's own colours are checked above — but the interface
 * also dims the muted foreground with an opacity ("text-muted-foreground
 * /40"), and an opacity variant of a colour on a light background can
 * never reach the line: at 40% it was 1.76:1, at 60% 2.46:1.
 *
 * Twenty-eight places used them — the "today" marker, the heatmap's
 * legend, the weekday headings, the calendar's day numbers, the
 * relative timestamps, the placeholders in the shared input and
 * textarea.
 */
describe("the dimmed text", () => {
  it("uses no opacity variant of the muted foreground", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(tsx|ts)$/.test(entry.name)) continue;
        if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) continue;
        const source = readFileSync(full, "utf-8");
        const match = /text-muted-foreground\/(\d+)/.exec(source);
        if (match) offenders.push(`${path.relative(dir, full)}: ${match[0]}`);
      }
    };
    walk(path.resolve(__dirname, ".."));
    expect(offenders).toEqual([]);
  });
});

describe("the palette", () => {
  for (const theme of ["light", "dark"] as const) {
    describe(`in the ${theme} theme`, () => {
      it("reads the body text clearly", () => {
        const background = readColour(CSS, "background", theme);
        const foreground = readColour(CSS, "foreground", theme);
        expect(ratio(foreground, background)).toBeGreaterThanOrEqual(4.5);
      });

      it("reads the secondary text clearly", () => {
        const background = readColour(CSS, "background", theme);
        const muted = readColour(CSS, "muted-foreground", theme);
        expect(ratio(muted, background)).toBeGreaterThanOrEqual(4.5);
      });

      it("reads the quieter text clearly", () => {
        // It used to be the muted foreground at a lower opacity, and an
        // opacity variant on a light background can never reach 4.5:1 —
        // at 70% it was 3.06:1.
        const background = readColour(CSS, "background", theme);
        const subtle = readColour(CSS, "muted-subtle", theme);
        expect(ratio(subtle, background)).toBeGreaterThanOrEqual(4.5);
      });

      it("reads the accent colour clearly", () => {
        // The brick orange is used for real text: the landing page's
        // headings, the "read more" control, the sign-up link.
        const background = readColour(CSS, "background", theme);
        const cinnabar = readColour(CSS, "cinnabar", theme);
        expect(ratio(cinnabar, background)).toBeGreaterThanOrEqual(4.5);
      });

      it("reads the text on a focused option clearly", () => {
        // The accent is the background of a focused option.
        const accent = readColour(CSS, "accent", theme);
        const onAccent = readColour(CSS, "accent-foreground", theme);
        expect(ratio(onAccent, accent)).toBeGreaterThanOrEqual(4.5);
      });
    });
  }
});
