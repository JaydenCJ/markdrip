#!/usr/bin/env node
/**
 * The markdrip CLI. A file argument renders one-shot; stdin renders
 * incrementally through the streaming engine, so `curl ... | markdrip`
 * or an AI CLI piping tokens shows formatted output while it arrives.
 * Fully offline: the only I/O is the given file / stdin and stdout.
 */

import { readFileSync } from "node:fs";
import { render } from "./index.js";
import { parseArgs, USAGE, UsageError, type CliOptions } from "./cliargs.js";
import { StreamRenderer } from "./stream.js";
import type { RenderOptions, StreamMode } from "./types.js";
import { VERSION } from "./version.js";

function resolveOptions(opts: CliOptions): RenderOptions & { mode: StreamMode } {
  const tty = process.stdout.isTTY === true;
  const noColorEnv = (process.env["NO_COLOR"] ?? "") !== "";
  // On a TTY, follow the terminal but cap at 100 columns — a readable
  // measure for prose, and live repaints stay cheap on very wide windows.
  const width = opts.width ?? (tty && process.stdout.columns ? Math.min(process.stdout.columns, 100) : 80);
  return {
    width,
    color: opts.color ?? (tty && !noColorEnv),
    hyperlinks: opts.hyperlinks,
    showUrls: opts.showUrls,
    mode: opts.mode ?? (tty ? "live" : "append"),
  };
}

async function streamStdin(opts: RenderOptions & { mode: StreamMode }): Promise<void> {
  const r = new StreamRenderer(opts);
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    const out = r.push(chunk);
    if (out !== "") process.stdout.write(out);
  }
  const out = r.end();
  if (out !== "") process.stdout.write(out);
}

// A downstream pager or `head` closing its end of the pipe is a normal
// way for a stream session to finish — exit quietly instead of dumping
// an EPIPE stack trace. Any other stdout error is fatal but still gets
// a one-line diagnostic, never a raw stack.
process.stdout.on("error", (err: Error & { code?: string }) => {
  if (err.code === "EPIPE") process.exit(0);
  process.stderr.write(`markdrip: ${err.message}\n`);
  process.exit(1);
});

async function main(): Promise<void> {
  let opts: CliOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`markdrip: ${err.message}\n`);
      process.stderr.write(`try: markdrip --help\n`);
      process.exitCode = 2;
      return;
    }
    throw err;
  }
  if (opts.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (opts.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  const resolved = resolveOptions(opts);
  if (opts.file !== null && opts.file !== "-") {
    let src: string;
    try {
      src = readFileSync(opts.file, "utf8");
    } catch {
      process.stderr.write(`markdrip: cannot read ${opts.file}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(render(src, resolved));
    return;
  }
  await streamStdin(resolved);
}

main().catch((err: unknown) => {
  process.stderr.write(`markdrip: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
