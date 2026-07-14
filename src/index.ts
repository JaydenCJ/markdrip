/**
 * markdrip — streaming markdown renderer for terminals.
 *
 * Two entry points:
 *  - `render(markdown, opts)` — one-shot: parse a complete document and
 *    return styled terminal text.
 *  - `new StreamRenderer(opts)` — incremental: `push()` chunks as they
 *    arrive (token-by-token is fine); closed blocks commit as stable
 *    lines, the open tail re-renders with mid-stream repair.
 *
 * The lower-level pieces (block parser, inline parser, repair pass, wrap
 * engine) are exported for embedding in other TUIs.
 */

import { makeCtx } from "./ansi.js";
import { parseBlocks } from "./blocks.js";
import { renderBlocks } from "./render.js";
import type { RenderOptions } from "./types.js";

export { DEFAULT_THEME, ESC, RESET, makeCtx, sgr, spansToAnsi } from "./ansi.js";
export { isBlank, parseBlocks, parseDelimRow, splitLines, splitRow } from "./blocks.js";
export { mergeSpans, parseInline, spansText } from "./inline.js";
export { renderBlocks, renderOne } from "./render.js";
export { repairInline } from "./repair.js";
export { StreamRenderer } from "./stream.js";
export type {
  Align,
  Block,
  FenceBlock,
  FenceCont,
  HeadingBlock,
  HrBlock,
  InlineSpan,
  ListBlock,
  ListItem,
  ParagraphBlock,
  ParseOptions,
  QuoteBlock,
  RenderOptions,
  StreamMode,
  StreamOptions,
  TableBlock,
  Theme,
} from "./types.js";
export { VERSION } from "./version.js";
export { graphemes, stringWidth } from "./width.js";
export { spansWidth, wrapSpans } from "./wrap.js";

/** Render a complete markdown document to styled terminal text. */
export function render(markdown: string, opts: RenderOptions = {}): string {
  const src = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = parseBlocks(src, { atEnd: true });
  const lines = renderBlocks(blocks, makeCtx(opts));
  return lines.length > 0 ? lines.join("\n") + "\n" : "";
}
