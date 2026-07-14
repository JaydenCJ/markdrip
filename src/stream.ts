/**
 * The streaming engine. Feed it chunks of markdown (any split, down to
 * single characters); it maintains two regions:
 *
 *  - committed lines — rendered from closed blocks; emitted exactly once
 *    and never repainted (safe for pipes, logs, scrollback);
 *  - a volatile tail — the one open block at the end of the input,
 *    re-rendered speculatively (with inline repair) on every push.
 *
 * Fenced code is special-cased: each completed code line commits
 * immediately, so a long streaming code block never grows the repaint
 * region. In "live" mode `push()` returns ANSI that erases the previous
 * tail and repaints; in "append" mode it returns only newly committed
 * lines and `end()` flushes the finalized tail.
 */

import { makeCtx, sgr, type Ctx } from "./ansi.js";
import { parseBlocks } from "./blocks.js";
import { closeLike, renderBlocks, renderOne } from "./render.js";
import type { Block, FenceBlock, FenceCont, StreamMode, StreamOptions } from "./types.js";

const CSI = "\x1b[";

export class StreamRenderer {
  private readonly ctx: Ctx;
  private readonly mode: StreamMode;
  private buf = "";
  private pendingCR = false;
  private fence: FenceCont | null = null;
  private committedLines: string[] = [];
  private volatileLines: string[] = [];
  private paintedVolatile = 0;
  private paintedSnapshot = "";
  private ended = false;

  constructor(opts: StreamOptions = {}) {
    this.ctx = makeCtx(opts);
    this.mode = opts.mode ?? "append";
  }

  /** Committed (final, never-repainted) lines so far. */
  get committed(): readonly string[] {
    return this.committedLines;
  }

  /** Current full view: committed lines plus the repaired volatile tail. */
  lines(): string[] {
    return [...this.committedLines, ...this.volatileLines];
  }

  /** Feed one chunk. Returns the text to write to the terminal. */
  push(chunk: string): string {
    if (this.ended) throw new Error("push() after end()");
    // CRLF normalization that survives a chunk split between \r and \n.
    let data = chunk;
    if (this.pendingCR) {
      data = "\r" + data;
      this.pendingCR = false;
    }
    if (data.endsWith("\r")) {
      data = data.slice(0, -1);
      this.pendingCR = true;
    }
    data = data.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    this.buf += data;
    return this.advance(false);
  }

  /** Finalize: the input is complete. Returns the last text to write. */
  end(): string {
    if (this.ended) return "";
    if (this.pendingCR) {
      this.buf += "\n";
      this.pendingCR = false;
    }
    const out = this.advance(true);
    this.ended = true;
    return out;
  }

  private advance(atEnd: boolean): string {
    const blocks = parseBlocks(this.buf, { atEnd, cont: this.fence });
    const newCommitted: string[] = [];
    let consumed = blocks.length === 0 ? this.buf.length : 0;
    let volatileBlock: Block | null = null;
    let volatileFencePartial: string | null = null;

    for (let k = 0; k < blocks.length; k++) {
      const b = blocks[k]!;
      if (b.closed) {
        this.commitBlock(b, newCommitted);
        if (b.kind === "fence") this.fence = null;
        const next = blocks[k + 1];
        consumed = next ? next.start : this.buf.length;
        continue;
      }
      // Open block: at most one, always last.
      if (b.kind === "fence" && b.headTerminated) {
        consumed = this.commitFenceLines(b, newCommitted, consumed);
        if (b.partial !== null && !closeLike(b)) {
          volatileFencePartial = b.partial;
        }
      } else {
        // Includes a fence whose opening line is still being typed: the
        // info string is not final, so nothing commits yet.
        volatileBlock = b;
      }
      break;
    }
    this.buf = this.buf.slice(consumed);
    if (newCommitted.length > 0) {
      this.committedLines.push(...newCommitted);
    }

    // Render the volatile tail.
    const vol: string[] = [];
    if (volatileFencePartial !== null) {
      // A half-typed code line attaches directly under the committed
      // fence lines: no separator, no header.
      const gutter = sgr("│ ", this.ctx.theme.codeGutter, this.ctx.color);
      vol.push(
        gutter +
          sgr(volatileFencePartial.replace(/\t/g, "    "), this.ctx.theme.codeText, this.ctx.color)
      );
    } else if (volatileBlock !== null) {
      const lines = renderOne(volatileBlock, this.ctx);
      if (lines.length > 0) {
        if (this.committedLines.length > 0) vol.push("");
        vol.push(...lines);
      }
    }
    this.volatileLines = vol;
    return this.emit(newCommitted);
  }

  /** Commit a closed block: separator handling + final lines. */
  private commitBlock(b: Block, sink: string[]): void {
    const isCont = b.kind === "fence" && b.cont;
    const lines = renderBlocks([b], this.ctx);
    if (lines.length === 0) return;
    if (this.committedLines.length + sink.length > 0 && !isCont) {
      sink.push("");
    }
    sink.push(...lines);
  }

  /**
   * Partial commit for an open fence: header and every newline-terminated
   * code line become committed output; only the unterminated tail line
   * stays volatile. Returns the new consumed offset.
   */
  private commitFenceLines(b: FenceBlock, sink: string[], consumed: number): number {
    const gutter = sgr("│ ", this.ctx.theme.codeGutter, this.ctx.color);
    let advanced = consumed;
    if (!b.cont) {
      // First sight of this fence: commit its header.
      if (this.committedLines.length + sink.length > 0) sink.push("");
      if (b.info !== "") {
        sink.push(gutter + sgr(b.info, this.ctx.theme.codeInfo, this.ctx.color));
      }
      advanced = b.headEnd;
      this.fence = {
        fenceChar: b.fenceChar,
        fenceLen: b.fenceLen,
        indent: b.indent,
        info: b.info,
      };
    }
    for (let n = 0; n < b.lines.length; n++) {
      sink.push(gutter + sgr(b.lines[n]!.replace(/\t/g, "    "), this.ctx.theme.codeText, this.ctx.color));
      advanced = b.lineEnds[n]!;
    }
    return advanced;
  }

  /** Produce terminal output for this step. */
  private emit(newCommitted: string[]): string {
    if (this.mode === "append") {
      return newCommitted.length > 0 ? newCommitted.join("\n") + "\n" : "";
    }
    // live mode: erase the previously painted tail, print new committed
    // lines, repaint the tail. A push that changes nothing emits nothing.
    const snapshot = this.volatileLines.join("\n");
    if (newCommitted.length === 0 && snapshot === this.paintedSnapshot) return "";
    let out = "";
    if (this.paintedVolatile > 0) {
      out += `${CSI}${this.paintedVolatile}F${CSI}0J`;
    }
    if (newCommitted.length > 0) out += newCommitted.join("\n") + "\n";
    if (this.volatileLines.length > 0) out += this.volatileLines.join("\n") + "\n";
    this.paintedVolatile = this.volatileLines.length;
    this.paintedSnapshot = snapshot;
    return out;
  }
}
