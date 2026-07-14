/**
 * Incremental block-level parser. Parses a (possibly incomplete) markdown
 * source into blocks, each carrying a `closed` flag: a closed block can
 * never be changed by future input and is safe for the streaming engine to
 * commit; the (at most one) trailing open block re-renders as it grows.
 *
 * The grammar is a pragmatic CommonMark + GFM subset: ATX and setext
 * headings, paragraphs with hard breaks, fenced code (backtick and tilde),
 * blockquotes with lazy continuation, ordered/unordered/task lists with
 * nesting, thematic breaks, and pipe tables. Indented code blocks and HTML
 * blocks are intentionally out of scope for 0.1.0.
 */

import type {
  Align,
  Block,
  FenceBlock,
  FenceCont,
  HeadingBlock,
  ListBlock,
  ListItem,
  ParagraphBlock,
  ParseOptions,
  QuoteBlock,
  TableBlock,
} from "./types.js";

interface LineRec {
  text: string;
  start: number;
  end: number;
  terminated: boolean;
}

/** Split source into physical lines with offsets; the final line may be
 * unterminated (still streaming). */
export function splitLines(src: string): LineRec[] {
  const out: LineRec[] = [];
  let pos = 0;
  while (pos < src.length) {
    const nl = src.indexOf("\n", pos);
    if (nl < 0) {
      out.push({ text: src.slice(pos), start: pos, end: src.length, terminated: false });
      break;
    }
    out.push({ text: src.slice(pos, nl), start: pos, end: nl + 1, terminated: true });
    pos = nl + 1;
  }
  return out;
}

const BLANK_RE = /^[ \t]*$/;
const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?[ \t]*$/;
const FENCE_OPEN_RE = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/;
const HR_RE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})$/;
const QUOTE_RE = /^ {0,3}>/;
const MARKER_RE = /^( {0,3})(?:([-+*])|(\d{1,9})([.)]))([ \t]+)(.*)$|^( {0,3})(?:([-+*])|(\d{1,9})([.)]))[ \t]*$/;
const SETEXT_RE = /^ {0,3}(=+|-+)[ \t]*$/;

export function isBlank(text: string): boolean {
  return BLANK_RE.test(text);
}

interface Marker {
  indent: number;
  ordered: boolean;
  bulletChar: string;
  num: number;
  /** Column where the item's content starts. */
  contentIndent: number;
  /** Text after the marker on the marker line ("" for an empty item). */
  rest: string;
  /** Marker had no content and no trailing space (bare "-" / "1."). */
  bare: boolean;
}

/**
 * Could this still-streaming line become a list marker once more
 * characters arrive? ("3" → "3. item", "-" → "- item").
 */
function maybeMarkerPrefix(text: string): boolean {
  return /^ {0,3}(?:[-+*]|\d{1,9}[.)]?)$/.test(text);
}

function matchMarker(text: string): Marker | null {
  const m = MARKER_RE.exec(text);
  if (!m) return null;
  if (m[1] !== undefined) {
    const indent = m[1].length;
    const ordered = m[3] !== undefined;
    const markerLen = ordered ? m[3]!.length + 1 : 1;
    const gap = Math.min(m[5]!.length, 4);
    const rest = m[6] ?? "";
    return {
      indent,
      ordered,
      bulletChar: m[2] ?? "",
      num: ordered ? parseInt(m[3]!, 10) : 0,
      contentIndent: indent + markerLen + (rest === "" ? 1 : gap),
      rest,
      bare: false,
    };
  }
  const indent = m[7]!.length;
  const ordered = m[9] !== undefined;
  const markerLen = ordered ? m[9]!.length + 1 : 1;
  return {
    indent,
    ordered,
    bulletChar: m[8] ?? "",
    num: ordered ? parseInt(m[9]!, 10) : 0,
    contentIndent: indent + markerLen + 1,
    rest: "",
    bare: true,
  };
}

/** Split a table row into cells, honoring `\|` escapes. */
export function splitRow(text: string): string[] {
  const cells: string[] = [];
  let cur = "";
  const t = text.trim();
  let i = 0;
  const hasLead = t.startsWith("|");
  if (hasLead) i = 1;
  for (; i < t.length; i++) {
    const ch = t[i]!;
    if (ch === "\\" && t[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (!(t.endsWith("|") && cur.trim() === "")) cells.push(cur.trim());
  return cells;
}

/** Parse a GFM delimiter row (`| :--- | :---: |`); null when it isn't one. */
export function parseDelimRow(text: string): Align[] | null {
  if (!text.includes("|")) return null;
  const cells = splitRow(text);
  if (cells.length === 0) return null;
  const align: Align[] = [];
  for (const c of cells) {
    const m = /^(:?)-+(:?)$/.exec(c);
    if (!m) return null;
    if (m[1] && m[2]) align.push("center");
    else if (m[2]) align.push("right");
    else if (m[1]) align.push("left");
    else align.push(null);
  }
  return align;
}

function hasUnescapedPipe(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "|") return true;
  }
  return false;
}

/**
 * Would this line start a new block (used to end paragraphs, lazy quote
 * continuation and lazy list continuation)? Ambiguous *unterminated*
 * lines — a bare "#", "-" or "1." that may still grow into plain text —
 * do not interrupt.
 */
function startsNewBlock(l: LineRec, atEnd: boolean): boolean {
  const t = l.text;
  if (FENCE_OPEN_RE.test(t)) return true;
  if (QUOTE_RE.test(t)) return true;
  const settled = l.terminated || atEnd;
  const atx = ATX_RE.exec(t);
  if (atx && (settled || atx[2] !== undefined)) return true;
  if (HR_RE.test(t)) return true;
  const m = matchMarker(t);
  if (m && (settled || !m.bare)) return true;
  return false;
}

/** Strip up to `n` leading spaces (fence/list content dedent). */
function dedent(text: string, n: number): string {
  let k = 0;
  while (k < n && text[k] === " ") k++;
  return text.slice(k);
}

/**
 * Join paragraph source lines into logical text: soft breaks become
 * spaces; a line ending in two-plus spaces or a backslash becomes a hard
 * break ("\n"). The trailing (possibly still-streaming) line is kept
 * verbatim.
 */
function joinParagraph(rawLines: string[], lastTerminated: boolean): string {
  const parts: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    let t = rawLines[i]!.replace(/^[ \t]+/, "");
    const last = i === rawLines.length - 1;
    if (last && !lastTerminated) {
      parts.push(t);
      break;
    }
    let hard = false;
    if (/(^|[^\\])\\$/.test(t)) {
      t = t.slice(0, -1);
      hard = true;
    } else if (/ {2,}$/.test(t)) {
      hard = true;
    }
    t = t.replace(/[ \t]+$/, "");
    parts.push(t + (last ? "" : hard ? "\n" : " "));
  }
  return parts.join("");
}

export function parseBlocks(src: string, opts: ParseOptions = {}): Block[] {
  const atEnd = opts.atEnd ?? false;
  const lines = splitLines(src);
  const blocks: Block[] = [];
  let i = 0;

  // ---------- fence ----------
  function parseFence(cont: FenceCont | null): FenceBlock {
    let fenceChar: "`" | "~";
    let fenceLen: number;
    let indent: number;
    let info: string;
    let start: number;
    let headEnd: number;
    let headTerminated: boolean;
    if (cont) {
      fenceChar = cont.fenceChar;
      fenceLen = cont.fenceLen;
      indent = cont.indent;
      info = cont.info;
      start = 0;
      headEnd = 0;
      headTerminated = true;
    } else {
      const open = lines[i]!;
      const m = FENCE_OPEN_RE.exec(open.text)!;
      indent = m[1]!.length;
      fenceChar = m[2]![0] as "`" | "~";
      fenceLen = m[2]!.length;
      info = m[3]!.trim();
      start = open.start;
      headEnd = open.end;
      headTerminated = open.terminated || atEnd;
      i++;
    }
    const closeRe = new RegExp(`^ {0,3}\\${fenceChar}{${fenceLen},}[ \\t]*$`);
    const body: string[] = [];
    const lineEnds: number[] = [];
    let partial: string | null = null;
    let closed = false;
    let end = headEnd;
    while (i < lines.length) {
      const l = lines[i]!;
      if (l.terminated && closeRe.test(l.text)) {
        closed = true;
        end = l.end;
        i++;
        break;
      }
      if (!l.terminated) {
        if (atEnd && closeRe.test(l.text)) {
          closed = true;
        } else {
          partial = dedent(l.text, indent);
        }
        end = l.end;
        i++;
        break;
      }
      body.push(dedent(l.text, indent));
      lineEnds.push(l.end);
      end = l.end;
      i++;
    }
    if (atEnd) closed = true;
    return {
      kind: "fence",
      start,
      end,
      closed,
      info,
      lines: body,
      partial,
      cont: cont !== null,
      fenceChar,
      fenceLen,
      indent,
      headTerminated,
      headEnd,
      lineEnds,
    };
  }

  // ---------- quote ----------
  function parseQuote(): QuoteBlock {
    const start = lines[i]!.start;
    const inner: string[] = [];
    let end = start;
    let closed = false;
    let lastTerminated = false;
    while (i < lines.length) {
      const l = lines[i]!;
      if (QUOTE_RE.test(l.text)) {
        inner.push(l.text.replace(/^ {0,3}> ?/, ""));
      } else if (isBlank(l.text)) {
        closed = l.terminated || atEnd;
        break;
      } else if (!startsNewBlock(l, atEnd) && inner.length > 0 && !isBlank(inner[inner.length - 1]!)) {
        inner.push(l.text); // lazy paragraph continuation
      } else {
        closed = true;
        break;
      }
      end = l.end;
      lastTerminated = l.terminated;
      i++;
    }
    if (i >= lines.length && !closed) closed = atEnd;
    const innerSrc = inner.join("\n") + (lastTerminated ? "\n" : "");
    const children = parseBlocks(innerSrc, { atEnd: closed });
    return { kind: "quote", start, end, closed, children };
  }

  // ---------- list ----------
  function parseList(first: Marker): ListBlock {
    const start = lines[i]!.start;
    const ordered = first.ordered;
    const bulletChar = first.bulletChar;
    const items: ListItem[] = [];
    let loose = false;
    let closed = false;
    let end = start;

    const sameList = (m: Marker): boolean =>
      m.indent <= 3 && m.ordered === ordered && (ordered || m.bulletChar === bulletChar);

    while (i < lines.length) {
      const l = lines[i]!;
      const m = matchMarker(l.text);
      if (!l.terminated && !atEnd && maybeMarkerPrefix(l.text)) {
        // An ambiguous half-typed marker ("-", "3", "3." that may become
        // "- item" / "3. item"): stop collecting but keep the list open —
        // the next chunk decides.
        break;
      }
      if (!m || !sameList(m) || (m.bare && !l.terminated && !atEnd)) {
        closed = true;
        break;
      }
      // Collect this item's lines.
      const itemLines: string[] = [m.rest];
      let itemLastTerminated = l.terminated;
      end = l.end;
      i++;
      let itemDone = false;
      while (i < lines.length && !itemDone) {
        const c = lines[i]!;
        if (isBlank(c.text)) {
          // Look past the blank run: indented content continues the item.
          let j = i;
          while (j < lines.length && isBlank(lines[j]!.text)) j++;
          const nxt = lines[j];
          if (nxt && leadingSpaces(nxt.text) >= m.contentIndent && !isBlank(nxt.text)) {
            loose = true;
            for (; i < j; i++) itemLines.push("");
            continue;
          }
          if (nxt && matchMarker(nxt.text) && sameList(matchMarker(nxt.text)!)) {
            loose = true;
            i = j;
            itemDone = true;
            continue;
          }
          // Blank then something else: the list ends there. A blank run
          // at end of input — or before a half-typed marker — keeps the
          // list open (the next chunk decides).
          itemDone = true;
          if (nxt && !(!nxt.terminated && !atEnd && maybeMarkerPrefix(nxt.text))) {
            closed = true;
          } else if (!nxt) {
            closed = atEnd;
          }
          i = j;
          continue;
        }
        const ind = leadingSpaces(c.text);
        if (ind >= m.contentIndent) {
          itemLines.push(dedent(c.text, m.contentIndent));
        } else if (matchMarker(c.text)) {
          itemDone = true;
          continue;
        } else if (!startsNewBlock(c, atEnd) && !isBlank(itemLines[itemLines.length - 1]!)) {
          itemLines.push(c.text); // lazy continuation
        } else {
          itemDone = true;
          closed = true;
          continue;
        }
        itemLastTerminated = c.terminated;
        end = c.end;
        i++;
      }
      // Task-list marker?
      let task: " " | "x" | null = null;
      const tm = /^\[([ xX])\][ \t]+/.exec(itemLines[0]!);
      if (tm) {
        task = tm[1] === " " ? " " : "x";
        itemLines[0] = itemLines[0]!.slice(tm[0].length);
      }
      // An item is settled once the list moved past it (another item or a
      // terminating line follows), or when the whole input is complete.
      const itemClosed = closed || i < lines.length || atEnd;
      const itemSrc = itemLines.join("\n") + (itemLastTerminated ? "\n" : "");
      items.push({ blocks: parseBlocks(itemSrc, { atEnd: itemClosed }), task });
      if (closed) break;
    }
    if (i >= lines.length && !closed) closed = atEnd;
    return {
      kind: "list",
      start,
      end,
      closed,
      ordered,
      startNo: first.num || 1,
      items,
      loose,
    };
  }

  // ---------- table ----------
  function parseTable(): TableBlock {
    const headLine = lines[i]!;
    const delimLine = lines[i + 1]!;
    const start = headLine.start;
    const header = splitRow(headLine.text);
    const align = parseDelimRow(delimLine.text)!;
    let end = delimLine.end;
    i += 2;
    const rows: string[][] = [];
    let closed = false;
    while (i < lines.length) {
      const l = lines[i]!;
      if (isBlank(l.text)) {
        closed = l.terminated || atEnd;
        break;
      }
      if (startsNewBlock(l, atEnd) && !hasUnescapedPipe(l.text)) {
        closed = true;
        break;
      }
      const cells = splitRow(l.text);
      while (cells.length < header.length) cells.push("");
      rows.push(cells.slice(0, header.length));
      end = l.end;
      i++;
    }
    if (i >= lines.length && !closed) closed = atEnd;
    return { kind: "table", start, end, closed, header, align, rows };
  }

  // ---------- paragraph (and setext headings / deferred tables) ----------
  function parseParagraph(): Block | null {
    const startIdx = i;
    const startLine = lines[i]!;
    const raw: string[] = [startLine.text];
    let end = startLine.end;
    let lastTerminated = startLine.terminated;
    i++;
    let closed = false;
    while (i < lines.length) {
      const l = lines[i]!;
      if (isBlank(l.text)) {
        closed = l.terminated || atEnd;
        break;
      }
      const setext = SETEXT_RE.exec(l.text);
      if (setext) {
        const level = setext[1]![0] === "=" ? 1 : 2;
        const text = joinParagraph(raw, true);
        i++;
        const h: HeadingBlock = {
          kind: "heading",
          start: startLine.start,
          end: l.end,
          closed: l.terminated || atEnd,
          level: level as 1 | 2,
          text,
          setext: true,
        };
        return h;
      }
      // A delimiter row after a pipe-bearing line: that line was a table
      // header, not paragraph text.
      if (
        (l.terminated || atEnd) &&
        hasUnescapedPipe(raw[raw.length - 1]!) &&
        parseDelimRow(l.text) !== null &&
        parseDelimRow(l.text)!.length === splitRow(raw[raw.length - 1]!).length
      ) {
        if (raw.length === 1) {
          i = startIdx;
          return null; // let the dispatcher parse the table from scratch
        }
        i--; // re-dispatch from the header line
        raw.pop();
        const text = joinParagraph(raw, true);
        return {
          kind: "paragraph",
          start: startLine.start,
          end: lines[i - 1]!.end,
          closed: true,
          text,
        } satisfies ParagraphBlock;
      }
      if (startsNewBlock(l, atEnd)) {
        closed = true;
        break;
      }
      raw.push(l.text);
      end = l.end;
      lastTerminated = l.terminated;
      i++;
    }
    if (i >= lines.length && !closed) closed = atEnd;
    const text = joinParagraph(raw, lastTerminated || closed);
    return {
      kind: "paragraph",
      start: startLine.start,
      end,
      closed,
      text,
    } satisfies ParagraphBlock;
  }

  function leadingSpaces(text: string): number {
    let n = 0;
    while (text[n] === " ") n++;
    return n;
  }

  // ---------- main dispatch ----------
  if (opts.cont) {
    blocks.push(parseFence(opts.cont));
  }
  while (i < lines.length) {
    while (i < lines.length && isBlank(lines[i]!.text)) i++;
    if (i >= lines.length) break;
    const l = lines[i]!;
    const settled = l.terminated || atEnd;

    const atx = ATX_RE.exec(l.text);
    if (atx && (settled || atx[2] !== undefined)) {
      let text = (atx[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim();
      if (!l.terminated) text = (atx[2] ?? "").trimStart();
      blocks.push({
        kind: "heading",
        start: l.start,
        end: l.end,
        closed: settled,
        level: atx[1]!.length as HeadingBlock["level"],
        text,
        setext: false,
      });
      i++;
      continue;
    }
    if (FENCE_OPEN_RE.test(l.text)) {
      // A tilde/backtick run alone could still be an hr? No — hr uses -_*.
      blocks.push(parseFence(null));
      continue;
    }
    if (HR_RE.test(l.text)) {
      blocks.push({ kind: "hr", start: l.start, end: l.end, closed: settled });
      i++;
      continue;
    }
    if (QUOTE_RE.test(l.text)) {
      blocks.push(parseQuote());
      continue;
    }
    const m = matchMarker(l.text);
    if (m && (!m.bare || settled)) {
      blocks.push(parseList(m));
      continue;
    }
    if (
      hasUnescapedPipe(l.text) &&
      i + 1 < lines.length &&
      (lines[i + 1]!.terminated || atEnd) &&
      parseDelimRow(lines[i + 1]!.text) !== null &&
      parseDelimRow(lines[i + 1]!.text)!.length === splitRow(l.text).length
    ) {
      blocks.push(parseTable());
      continue;
    }
    const p = parseParagraph();
    if (p) blocks.push(p);
  }
  return blocks;
}
