/**
 * Block renderer: turns parsed blocks into styled terminal lines. Open
 * (still-streaming) blocks render speculatively — their trailing inline
 * text goes through `repairInline()` first — while closed blocks render
 * with strict (CommonMark-literal) semantics. Code lines are never
 * wrapped; everything else wraps to the context width.
 */

import { spansToAnsi, sgr, type Ctx } from "./ansi.js";
import { parseInline, spansText } from "./inline.js";
import { repairInline } from "./repair.js";
import type {
  Block,
  FenceBlock,
  HeadingBlock,
  InlineSpan,
  ListBlock,
  ParagraphBlock,
  QuoteBlock,
  TableBlock,
} from "./types.js";
import { stringWidth } from "./width.js";
import { spansWidth, wrapSpans } from "./wrap.js";

/** Inline text → spans, repairing the tail when the block is still open. */
function inlineSpans(text: string, closed: boolean): InlineSpan[] {
  return parseInline(closed ? text : repairInline(text));
}

/** Append dimmed destinations after link labels when requested. */
function withUrls(spans: InlineSpan[], ctx: Ctx): InlineSpan[] {
  if (!ctx.showUrls) return spans;
  const out: InlineSpan[] = [];
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i]!;
    out.push(s);
    const next = spans[i + 1];
    const endOfLink = s.href !== undefined && (next === undefined || next.href !== s.href);
    if (endOfLink && s.href !== "" && s.href !== spansText([s])) {
      out.push({ text: ` (${s.href})`, dim: true });
    }
  }
  return out;
}

function renderParagraph(b: ParagraphBlock, ctx: Ctx): string[] {
  if (b.text.trim() === "") return [];
  const spans = withUrls(inlineSpans(b.text, b.closed), ctx);
  return wrapSpans(spans, ctx.width).map((line) => spansToAnsi(line, ctx));
}

function renderHeading(b: HeadingBlock, ctx: Ctx): string[] {
  const t = ctx.theme;
  const marker = "#".repeat(b.level) + " ";
  const spans = inlineSpans(b.text, b.closed).map((s) => ({ ...s, bold: true }));
  const style = t.heading[b.level - 1]!;
  const lines = wrapSpans(spans, Math.max(1, ctx.width - marker.length));
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const prefix =
      i === 0 ? sgr(marker, t.headingMarker, ctx.color) : " ".repeat(marker.length);
    const body = lines[i]!.map((s) => spansToAnsi([s], ctx)).join("");
    // Headings restyle their whole text with the level color on top of
    // any inline styling the author wrote.
    const styled = ctx.color && style !== "" ? recolor(lines[i]!, style, ctx) : body;
    out.push(prefix + styled);
  }
  return out.length > 0 ? out : [sgr(marker.trimEnd(), t.headingMarker, ctx.color)];
}

/** Re-render heading spans with the heading color merged in. */
function recolor(spans: InlineSpan[], params: string, ctx: Ctx): string {
  let out = "";
  for (const s of spans) {
    if (s.hardBreak) continue;
    const extra: string[] = [params];
    if (s.italic) extra.push("3");
    if (s.strike) extra.push("9");
    if (s.code && ctx.theme.codeSpan) extra.push(ctx.theme.codeSpan);
    out += sgr(s.text, extra.join(";"), ctx.color);
  }
  return out;
}

/** True when a partial fence line looks like the closing fence being typed. */
export function closeLike(b: FenceBlock): boolean {
  if (b.partial === null) return false;
  const re = new RegExp(`^ {0,3}\\${b.fenceChar}{1,}[ \\t]*$`);
  return re.test(b.partial);
}

const TAB_AS = "    ";

function renderFence(b: FenceBlock, ctx: Ctx): string[] {
  const t = ctx.theme;
  const gutter = sgr("│ ", t.codeGutter, ctx.color);
  const out: string[] = [];
  if (!b.cont && b.info !== "") {
    out.push(gutter + sgr(b.info, t.codeInfo, ctx.color));
  }
  for (const line of b.lines) {
    out.push(gutter + sgr(line.replace(/\t/g, TAB_AS), t.codeText, ctx.color));
  }
  if (b.partial !== null && !closeLike(b)) {
    out.push(gutter + sgr(b.partial.replace(/\t/g, TAB_AS), t.codeText, ctx.color));
  }
  return out;
}

function renderQuote(b: QuoteBlock, ctx: Ctx): string[] {
  const inner = renderBlocks(b.children, { ...ctx, width: Math.max(8, ctx.width - 2) });
  const bar = sgr("▌ ", ctx.theme.quoteBar, ctx.color);
  return inner.map((l) => bar + l);
}

const BULLETS = ["•", "◦", "▪"];

function renderList(b: ListBlock, ctx: Ctx, depth: number): string[] {
  const t = ctx.theme;
  const out: string[] = [];
  let n = b.startNo;
  for (let idx = 0; idx < b.items.length; idx++) {
    const item = b.items[idx]!;
    let markerText: string;
    let markerStyle: string;
    if (item.task !== null) {
      markerText = item.task === "x" ? "✔ " : "☐ ";
      markerStyle = item.task === "x" ? t.taskDone : t.taskTodo;
    } else if (b.ordered) {
      markerText = `${n}. `;
      markerStyle = t.ordinal;
    } else {
      markerText = `${BULLETS[depth % BULLETS.length]} `;
      markerStyle = t.bullet;
    }
    const pad = " ".repeat(stringWidth(markerText));
    const inner = renderBlocksInner(
      item.blocks,
      { ...ctx, width: Math.max(8, ctx.width - stringWidth(markerText)) },
      depth + 1,
      // Tight lists pack an item's child blocks (text + nested list)
      // without blank separators; loose lists keep them.
      b.loose
    );
    if (inner.length === 0) inner.push("");
    for (let li = 0; li < inner.length; li++) {
      if (li === 0) out.push(sgr(markerText, markerStyle, ctx.color) + inner[li]);
      else out.push(inner[li] === "" ? "" : pad + inner[li]);
    }
    if (b.loose && idx < b.items.length - 1) out.push("");
    n++;
  }
  return out;
}

function padCell(text: string, rendered: string, width: number, align: TableBlock["align"][number]): string {
  const gap = Math.max(0, width - stringWidth(text));
  if (align === "right") return " ".repeat(gap) + rendered;
  if (align === "center") {
    const left = gap >> 1;
    return " ".repeat(left) + rendered + " ".repeat(gap - left);
  }
  return rendered + " ".repeat(gap);
}

function renderTable(b: TableBlock, ctx: Ctx): string[] {
  const t = ctx.theme;
  const cols = b.header.length;
  const cellSpans = (raw: string, head: boolean): InlineSpan[] => {
    const spans = inlineSpans(raw, true);
    return head ? spans.map((s) => ({ ...s, bold: true })) : spans;
  };
  const headSpans = b.header.map((h) => cellSpans(h, true));
  const rowSpans = b.rows.map((r) => r.map((c) => cellSpans(c, false)));
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) {
    let w = Math.max(3, spansWidth(headSpans[c]!));
    for (const r of rowSpans) w = Math.max(w, spansWidth(r[c]!));
    widths.push(w);
  }
  const border = (s: string) => sgr(s, t.tableBorder, ctx.color);
  const renderRow = (cells: InlineSpan[][]): string =>
    cells
      .map((spans, c) =>
        padCell(spansText(spans), spansToAnsi(spans, ctx), widths[c]!, b.align[c] ?? null)
      )
      .join(border(" │ "));
  const out: string[] = [renderRow(headSpans)];
  out.push(border(widths.map((w) => "─".repeat(w)).join("─┼─")));
  for (const r of rowSpans) out.push(renderRow(r));
  return out;
}

function renderBlock(b: Block, ctx: Ctx, depth: number): string[] {
  switch (b.kind) {
    case "paragraph":
      return renderParagraph(b, ctx);
    case "heading":
      return renderHeading(b, ctx);
    case "fence":
      return renderFence(b, ctx);
    case "quote":
      return renderQuote(b, ctx);
    case "list":
      return renderList(b, ctx, depth);
    case "hr":
      return [sgr("─".repeat(ctx.width), ctx.theme.hr, ctx.color)];
    case "table":
      return renderTable(b, ctx);
  }
}

function renderBlocksInner(blocks: Block[], ctx: Ctx, depth: number, sep = true): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    const lines = renderBlock(b, ctx, depth);
    if (lines.length === 0) continue;
    if (out.length > 0 && sep && !(b.kind === "fence" && b.cont)) out.push("");
    out.push(...lines);
  }
  return out;
}

/**
 * Render blocks to output lines, blocks separated by one blank line.
 * A continuation fence (streaming) attaches without a separator.
 */
export function renderBlocks(blocks: Block[], ctx: Ctx): string[] {
  return renderBlocksInner(blocks, ctx, 0);
}

/** Render a single block (used by the streaming engine). */
export function renderOne(b: Block, ctx: Ctx): string[] {
  return renderBlock(b, ctx, 0);
}
