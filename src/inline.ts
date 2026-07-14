/**
 * Inline markdown parser: code spans, emphasis/strong, strikethrough,
 * links, images and autolinks, resolved to a flat list of styled spans.
 *
 * This is a pragmatic CommonMark subset tuned for terminal rendering and
 * streaming stability: delimiter runs are matched with a stack (including
 * partial-length matches, so `***x***` resolves to bold+italic), unmatched
 * delimiters fall back to literal text, and hard breaks arrive pre-encoded
 * as "\n" characters by the block parser.
 */

import type { InlineSpan } from "./types.js";

type DelimChar = "*" | "_" | "~";

interface TextTok {
  kind: "text";
  text: string;
}
interface CodeTok {
  kind: "code";
  text: string;
}
interface LinkTok {
  kind: "link";
  spans: InlineSpan[];
}
interface BreakTok {
  kind: "break";
}
interface DelimTok {
  kind: "delim";
  char: DelimChar;
  len: number;
  rem: number;
  canOpen: boolean;
  canClose: boolean;
  opens: Array<"bold" | "italic" | "strike">;
  closes: Array<"bold" | "italic" | "strike">;
}
type Tok = TextTok | CodeTok | LinkTok | BreakTok | DelimTok;

const PUNCT = new Set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~");

function isWs(ch: string | undefined): boolean {
  return ch === undefined || ch === " " || ch === "\t" || ch === "\n";
}
function isAlnum(ch: string | undefined): boolean {
  return ch !== undefined && !isWs(ch) && !PUNCT.has(ch);
}

/** Length of the character run starting at `i`. */
function runLen(src: string, i: number, ch: string): number {
  let n = 0;
  while (src[i + n] === ch) n++;
  return n;
}

/**
 * Find the closing backtick run of exactly `len` after `from`.
 * Returns the index of the run start, or -1.
 */
function findCodeClose(src: string, from: number, len: number): number {
  let i = from;
  while (i < src.length) {
    if (src[i] === "`") {
      const n = runLen(src, i, "`");
      if (n === len) return i;
      i += n;
    } else {
      i++;
    }
  }
  return -1;
}

/** CommonMark code-span content normalization. */
function normalizeCode(raw: string): string {
  let s = raw.replace(/\n/g, " ");
  if (s.length >= 2 && s.startsWith(" ") && s.endsWith(" ") && s.trim() !== "") {
    s = s.slice(1, -1);
  }
  return s;
}

const AUTOLINK_RE = /^<([a-z][a-z0-9+.-]{1,31}:[^\s<>]*)>/i;

/**
 * Try to parse a link starting at `[` (index `i`). Returns the label
 * bounds, destination and total consumed length, or null.
 */
function tryLink(
  src: string,
  i: number
): { label: string; dest: string; len: number } | null {
  // Match the label: brackets nest, backslash escapes are honored.
  let depth = 0;
  let j = i;
  let close = -1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        close = j;
        break;
      }
    }
    j++;
  }
  if (close < 0 || src[close + 1] !== "(") return null;
  const label = src.slice(i + 1, close);
  // Destination: <...> form or a paren-balanced run; optional "title".
  let k = close + 2;
  while (src[k] === " ") k++;
  let dest = "";
  if (src[k] === "<") {
    const gt = src.indexOf(">", k + 1);
    if (gt < 0 || src.slice(k + 1, gt).includes("\n")) return null;
    dest = src.slice(k + 1, gt);
    k = gt + 1;
  } else {
    let pdepth = 0;
    const start = k;
    while (k < src.length) {
      const ch = src[k];
      if (ch === "\\") {
        k += 2;
        continue;
      }
      if (ch === "(") pdepth++;
      else if (ch === ")") {
        if (pdepth === 0) break;
        pdepth--;
      } else if (ch === " " || ch === "\n") break;
      k++;
    }
    dest = src.slice(start, k);
  }
  // Optional title, then the closing paren.
  while (src[k] === " " || src[k] === "\n") k++;
  const quote = src[k];
  if (quote === '"' || quote === "'") {
    let q = k + 1;
    while (q < src.length && src[q] !== quote) q += src[q] === "\\" ? 2 : 1;
    if (q >= src.length) return null;
    k = q + 1;
    while (src[k] === " ") k++;
  }
  if (src[k] !== ")") return null;
  return { label, dest, len: k + 1 - i };
}

/** Tokenize inline source. Links/images/code are consumed whole. */
function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let text = "";
  const flush = () => {
    if (text !== "") {
      toks.push({ kind: "text", text });
      text = "";
    }
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\\" && i + 1 < src.length && PUNCT.has(src[i + 1]!)) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "\n") {
      flush();
      toks.push({ kind: "break" });
      i++;
      continue;
    }
    if (ch === "`") {
      const len = runLen(src, i, "`");
      const close = findCodeClose(src, i + len, len);
      if (close >= 0) {
        flush();
        toks.push({ kind: "code", text: normalizeCode(src.slice(i + len, close)) });
        i = close + len;
      } else {
        text += "`".repeat(len);
        i += len;
      }
      continue;
    }
    if (ch === "<") {
      const m = AUTOLINK_RE.exec(src.slice(i));
      if (m) {
        flush();
        toks.push({ kind: "link", spans: [{ text: m[1]!, href: m[1]! }] });
        i += m[0].length;
        continue;
      }
      text += ch;
      i++;
      continue;
    }
    if (ch === "[" || (ch === "!" && src[i + 1] === "[")) {
      const at = ch === "!" ? i + 1 : i;
      const link = tryLink(src, at);
      if (link) {
        flush();
        const inner = parseInline(link.label);
        const spans = inner.map((s) => ({ ...s, href: link.dest }));
        toks.push({ kind: "link", spans });
        i = at + link.len;
        continue;
      }
      text += ch;
      i++;
      continue;
    }
    if (ch === "*" || ch === "_" || ch === "~") {
      const len = runLen(src, i, ch);
      const prev = src[i - 1];
      const next = src[i + len];
      if (ch === "~" && len !== 2) {
        text += ch.repeat(len);
        i += len;
        continue;
      }
      let canOpen = !isWs(next);
      let canClose = !isWs(prev);
      if (ch === "_") {
        // No intraword emphasis with underscores.
        canOpen = canOpen && !isAlnum(prev);
        canClose = canClose && !isAlnum(next);
      }
      if (!canOpen && !canClose) {
        text += ch.repeat(len);
        i += len;
        continue;
      }
      flush();
      toks.push({ kind: "delim", char: ch, len, rem: len, canOpen, canClose, opens: [], closes: [] });
      i += len;
      continue;
    }
    text += ch;
    i++;
  }
  flush();
  return toks;
}

/**
 * Match delimiter runs into style pairs. Partial-length matches are
 * supported: a `***` opener can serve a `**` closer and keep one `*`
 * available, which is how `***x***` becomes bold + italic.
 */
function resolveEmphasis(toks: Tok[]): void {
  const stack: DelimTok[] = [];
  for (const t of toks) {
    if (t.kind !== "delim") continue;
    if (t.canClose) {
      while (t.rem > 0) {
        let opener: DelimTok | null = null;
        for (let s = stack.length - 1; s >= 0; s--) {
          const cand = stack[s]!;
          if (cand.char === t.char && cand.rem > 0) {
            opener = cand;
            break;
          }
        }
        if (!opener) break;
        const take = Math.min(opener.rem, t.rem);
        const use = take >= 2 ? 2 : 1;
        opener.rem -= use;
        t.rem -= use;
        const style = t.char === "~" ? "strike" : use === 2 ? "bold" : "italic";
        opener.opens.push(style);
        t.closes.push(style);
        if (opener.rem === 0) stack.splice(stack.indexOf(opener), 1);
      }
    }
    if (t.rem > 0 && t.canOpen) stack.push(t);
  }
}

/** Merge adjacent spans with identical attributes. */
export function mergeSpans(spans: InlineSpan[]): InlineSpan[] {
  const out: InlineSpan[] = [];
  for (const s of spans) {
    if (s.text === "" && !s.hardBreak) continue;
    const last = out[out.length - 1];
    if (
      last &&
      !last.hardBreak &&
      !s.hardBreak &&
      !!last.bold === !!s.bold &&
      !!last.italic === !!s.italic &&
      !!last.strike === !!s.strike &&
      !!last.code === !!s.code &&
      !!last.dim === !!s.dim &&
      last.href === s.href
    ) {
      last.text += s.text;
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/**
 * Parse inline markdown to resolved spans. Input is assumed complete;
 * for a still-streaming tail, run `repairInline()` on the text first.
 */
export function parseInline(src: string): InlineSpan[] {
  const toks = tokenize(src);
  resolveEmphasis(toks);
  const spans: InlineSpan[] = [];
  let bold = 0;
  let italic = 0;
  let strike = 0;
  const attrs = (extra?: Partial<InlineSpan>): Partial<InlineSpan> => ({
    ...(bold > 0 ? { bold: true } : {}),
    ...(italic > 0 ? { italic: true } : {}),
    ...(strike > 0 ? { strike: true } : {}),
    ...extra,
  });
  for (const t of toks) {
    switch (t.kind) {
      case "text":
        spans.push({ text: t.text, ...attrs() });
        break;
      case "code":
        spans.push({ text: t.text, ...attrs({ code: true }) });
        break;
      case "break":
        spans.push({ text: "\n", hardBreak: true });
        break;
      case "link":
        for (const inner of t.spans) {
          spans.push({
            ...inner,
            ...(bold > 0 ? { bold: true } : {}),
            ...(italic > 0 ? { italic: true } : {}),
            ...(strike > 0 ? { strike: true } : {}),
          });
        }
        break;
      case "delim": {
        for (const st of t.closes) {
          if (st === "bold") bold--;
          else if (st === "italic") italic--;
          else strike--;
        }
        if (t.rem > 0) spans.push({ text: t.char.repeat(t.rem), ...attrs() });
        for (const st of t.opens) {
          if (st === "bold") bold++;
          else if (st === "italic") italic++;
          else strike++;
        }
        break;
      }
    }
  }
  return mergeSpans(spans);
}

/** Plain text of a span list (layout measurements, tests). */
export function spansText(spans: InlineSpan[]): string {
  return spans.map((s) => s.text).join("");
}
