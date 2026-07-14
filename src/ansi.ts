/**
 * ANSI output helpers: the default theme, SGR wrapping, and the mapping
 * from resolved inline spans to escaped text. Every emitted fragment is
 * self-contained (opens its own style, closes with a full reset), so any
 * output line survives being cut, reordered or prefixed by other tools.
 */

import type { InlineSpan, RenderOptions, Theme } from "./types.js";

export const ESC = "\x1b";
export const RESET = `${ESC}[0m`;

export const DEFAULT_THEME: Theme = {
  heading: ["1;95", "1;96", "1;94", "1", "1", "1"],
  headingMarker: "2",
  codeSpan: "93",
  codeText: "",
  codeGutter: "90",
  codeInfo: "3;90",
  quoteBar: "90",
  bullet: "96",
  ordinal: "96",
  taskDone: "92",
  taskTodo: "90",
  hr: "90",
  link: "4;94",
  url: "2",
  tableBorder: "90",
};

/** Resolved render context threaded through the block renderer. */
export interface Ctx {
  width: number;
  color: boolean;
  hyperlinks: boolean;
  showUrls: boolean;
  theme: Theme;
}

export function makeCtx(opts: RenderOptions = {}): Ctx {
  const width = Math.max(16, Math.floor(opts.width ?? 80));
  return {
    width,
    color: opts.color ?? true,
    hyperlinks: opts.hyperlinks ?? false,
    showUrls: opts.showUrls ?? false,
    theme: { ...DEFAULT_THEME, ...(opts.theme ?? {}) },
  };
}

/** Wrap text in an SGR sequence when styling is on and params are non-empty. */
export function sgr(text: string, params: string, on: boolean): string {
  if (!on || params === "" || text === "") return text;
  return `${ESC}[${params}m${text}${RESET}`;
}

/** SGR parameter string for one span's attribute set. */
export function spanParams(span: InlineSpan, theme: Theme): string {
  const p: string[] = [];
  if (span.bold) p.push("1");
  if (span.dim) p.push("2");
  if (span.italic) p.push("3");
  if (span.strike) p.push("9");
  if (span.code && theme.codeSpan) p.push(theme.codeSpan);
  if (span.href !== undefined && !span.code && theme.link) p.push(theme.link);
  return p.join(";");
}

/** OSC 8 hyperlink wrapper (only used when opts.hyperlinks is on). */
export function osc8(text: string, href: string): string {
  return `${ESC}]8;;${href}${ESC}\\${text}${ESC}]8;;${ESC}\\`;
}

/** Render one already-wrapped line of spans to a final output string. */
export function spansToAnsi(spans: InlineSpan[], ctx: Ctx): string {
  let out = "";
  for (const span of spans) {
    if (span.hardBreak) continue;
    let piece = sgr(span.text, spanParams(span, ctx.theme), ctx.color);
    if (span.href && ctx.hyperlinks) piece = osc8(piece, span.href);
    out += piece;
  }
  return out;
}
