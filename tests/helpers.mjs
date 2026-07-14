// Shared test helpers: a runner for the compiled CLI, a chunker for
// streaming tests, and a minimal screen model that interprets exactly the
// two escape sequences the live mode emits (cursor-up-N + erase-below).
// Everything is offline and deterministic.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = join(ROOT, "dist", "cli.js");

export const ESC = "\x1b";
export const RESET = `${ESC}[0m`;

/**
 * Run the compiled CLI. Returns { stdout, stderr, code }; never throws on
 * non-zero exit so tests can assert usage-error paths.
 */
export function runCli(args, { input = "" } = {}) {
  try {
    const stdout = execFileSync("node", [CLI, ...args], { input, encoding: "utf8" });
    return { stdout, stderr: "", code: 0 };
  } catch (err) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      code: err.status ?? 1,
    };
  }
}

/** Split `text` into chunks of `size` characters. */
export function chunks(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/**
 * Minimal terminal model for live-mode output: lines plus a partial
 * current line; `\x1b[NF\x1b[0J` removes the last N lines. Anything else
 * escape-like would be a bug, so it throws.
 */
export function playLive(pieces) {
  const screen = [];
  let cur = "";
  for (const piece of pieces) {
    let i = 0;
    while (i < piece.length) {
      if (piece[i] === "\x1b" && piece[i + 1] === "[") {
        const m = /^\x1b\[(\d+)F\x1b\[0J/.exec(piece.slice(i));
        if (m) {
          if (cur !== "") throw new Error("erase while mid-line");
          screen.splice(screen.length - Number(m[1]), Number(m[1]));
          i += m[0].length;
          continue;
        }
        // SGR sequences pass through as content (tests strip or assert them).
      }
      const nl = piece.indexOf("\n", i);
      if (nl < 0) {
        cur += piece.slice(i);
        break;
      }
      screen.push(cur + piece.slice(i, nl));
      cur = "";
      i = nl + 1;
    }
  }
  if (cur !== "") screen.push(cur);
  return screen;
}

/** Strip SGR + OSC 8 sequences (test-side inspection only). */
export function stripAnsi(text) {
  return text
    .replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "")
    .replace(/\x1b\[[0-9;]*m/g, "");
}
