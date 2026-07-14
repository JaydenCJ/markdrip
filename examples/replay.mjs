// Replay a markdown file through the streaming engine in small chunks —
// exactly what an AI CLI does with model tokens. Deterministic and
// offline; set DELAY_MS>0 to watch it type on a real terminal:
//
//   node examples/replay.mjs                 # instant, pipe-safe
//   DELAY_MS=15 node examples/replay.mjs     # animated on a TTY
//
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StreamRenderer } from "../dist/index.js";

// Exit quietly when the reader (`head`, a pager) closes the pipe early.
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

const here = dirname(fileURLToPath(import.meta.url));
const doc = readFileSync(join(here, "tour.md"), "utf8");

const delay = Number(process.env.DELAY_MS ?? "0");
const tty = process.stdout.isTTY === true;
const r = new StreamRenderer({
  width: 72,
  color: tty || process.env.FORCE_COLOR === "1",
  mode: tty ? "live" : "append",
});

// Chunk like a token stream: a few characters at a time.
const CHUNK = 4;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

for (let i = 0; i < doc.length; i += CHUNK) {
  const out = r.push(doc.slice(i, i + CHUNK));
  if (out !== "") process.stdout.write(out);
  if (delay > 0) await sleep(delay);
}
process.stdout.write(r.end());
