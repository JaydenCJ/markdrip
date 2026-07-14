/**
 * Width-aware greedy word wrap over styled spans. Layout happens on plain
 * text (spans carry no escapes yet); styling is applied afterwards, which
 * keeps measurement trivial and every wrapped line independently styleable.
 *
 * Greedy wrapping has a property the streaming engine relies on: when text
 * only ever grows at the end, previously produced lines never change.
 */

import { mergeSpans } from "./inline.js";
import type { InlineSpan } from "./types.js";
import { graphemes, graphemeWidth, stringWidth } from "./width.js";

interface Word {
  spans: InlineSpan[];
  width: number;
}

/** Split spans into words at spaces; hard breaks become explicit markers. */
function toWords(spans: InlineSpan[]): Array<Word | "break"> {
  const words: Array<Word | "break"> = [];
  let cur: InlineSpan[] = [];
  let curW = 0;
  const flush = () => {
    if (cur.length > 0) {
      words.push({ spans: cur, width: curW });
      cur = [];
      curW = 0;
    }
  };
  for (const span of spans) {
    if (span.hardBreak) {
      flush();
      words.push("break");
      continue;
    }
    const parts = span.text.split(" ");
    for (let p = 0; p < parts.length; p++) {
      if (p > 0) flush();
      const piece = parts[p]!;
      if (piece === "") continue;
      cur.push({ ...span, text: piece });
      curW += stringWidth(piece);
    }
  }
  flush();
  return words;
}

/** Hard-split one over-long word into width-sized rows (grapheme-safe). */
function splitWord(word: Word, width: number): Word[] {
  const rows: Word[] = [];
  let cur: InlineSpan[] = [];
  let curW = 0;
  for (const span of word.spans) {
    for (const g of graphemes(span.text)) {
      const gw = graphemeWidth(g);
      if (curW + gw > width && curW > 0) {
        rows.push({ spans: mergeSpans(cur), width: curW });
        cur = [];
        curW = 0;
      }
      const last = cur[cur.length - 1];
      if (last && sameStyle(last, span)) last.text += g;
      else cur.push({ ...span, text: g });
      curW += gw;
    }
  }
  if (cur.length > 0) rows.push({ spans: mergeSpans(cur), width: curW });
  return rows;
}

function sameStyle(a: InlineSpan, b: InlineSpan): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.strike === !!b.strike &&
    !!a.code === !!b.code &&
    !!a.dim === !!b.dim &&
    a.href === b.href
  );
}

/**
 * Wrap spans to `width` columns. Returns lines of spans; inter-word
 * whitespace is normalized to single spaces (a space span inherits the
 * style of the word before it so styled runs stay visually contiguous).
 */
export function wrapSpans(spans: InlineSpan[], width: number): InlineSpan[][] {
  const w = Math.max(1, width);
  const lines: InlineSpan[][] = [];
  let line: InlineSpan[] = [];
  let lineW = 0;
  const flush = () => {
    lines.push(mergeSpans(line));
    line = [];
    lineW = 0;
  };
  for (const word of toWords(spans)) {
    if (word === "break") {
      flush();
      continue;
    }
    const pieces = word.width > w ? splitWord(word, w) : [word];
    for (const piece of pieces) {
      const sep = lineW > 0 ? 1 : 0;
      if (lineW + sep + piece.width > w && lineW > 0) flush();
      if (lineW > 0) {
        const prev = line[line.length - 1]!;
        const first = piece.spans[0]!;
        // The joining space adopts the style shared by its neighbors, so
        // "**two words**" underlines/bolds as one run, not two islands.
        if (sameStyle(prev, first)) prev.text += " ";
        else line.push({ text: " " });
        lineW += 1;
      }
      for (const s of piece.spans) line.push({ ...s });
      lineW += piece.width;
    }
  }
  if (line.length > 0 || lines.length === 0) flush();
  return lines.map(mergeSpans);
}

/** Plain-text width of a span line (for table cells, tests). */
export function spansWidth(spans: InlineSpan[]): number {
  let w = 0;
  for (const s of spans) if (!s.hardBreak) w += stringWidth(s.text);
  return w;
}
