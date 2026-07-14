// The streaming engine and its two contracts:
//  1. chunk-split invariance — feeding a document char-by-char, in odd
//     chunks or all at once produces byte-identical final output;
//  2. commit stability — a line, once committed, is never changed or
//     repainted (append output is a strict prefix of the final render).
import assert from "node:assert/strict";
import test from "node:test";
import { render, StreamRenderer } from "../dist/index.js";
import { ESC, chunks, playLive } from "./helpers.mjs";

const OPTS = { width: 40, color: false };

const FIXTURES = [
  "# Title\n\nA paragraph with **bold** and `code`.\n\n- one\n- two\n  - nested\n\n> quoted\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n---\n\ndone.\n",
  "Setext\n===\n\nhard  \nbreak, then [a link](https://example.test/p).\n",
  "1. first\n2. second\n\n3. loose third\n",
  "para\n```py\nprint(1)\n```\ntail without newline",
  "> **quote\n> across** lines\n\n- [x] task\n- [ ] task2\n",
  "汉字の段落 with wide text that wraps 🎉 and more\n\n~~~\nfence\n~~~\n",
];

test("chunk-split invariance: 1, 3, 7-char chunks and whole-doc all agree", () => {
  for (const md of FIXTURES) {
    const expected = render(md, OPTS);
    for (const size of [1, 3, 7, md.length]) {
      const r = new StreamRenderer({ ...OPTS, mode: "append" });
      let out = "";
      for (const c of chunks(md, size)) out += r.push(c);
      out += r.end();
      assert.equal(out, expected, `size=${size} doc=${JSON.stringify(md.slice(0, 24))}`);
    }
  }
});

test("append output at any moment is a prefix of the final output", () => {
  for (const md of FIXTURES) {
    const expected = render(md, OPTS);
    const r = new StreamRenderer({ ...OPTS, mode: "append" });
    let out = "";
    for (const ch of md) {
      out += r.push(ch);
      assert.ok(expected.startsWith(out), `not a prefix after ${JSON.stringify(out)}`);
    }
  }
});

test("committed lines only ever grow, never mutate", () => {
  const md = FIXTURES[0];
  const r = new StreamRenderer(OPTS);
  let prev = [];
  for (const ch of md) {
    r.push(ch);
    const cur = [...r.committed];
    assert.ok(cur.length >= prev.length);
    for (let i = 0; i < prev.length; i++) assert.equal(cur[i], prev[i]);
    prev = cur;
  }
});

test("live mode replays to exactly the one-shot render on a screen model", () => {
  for (const md of FIXTURES) {
    const expected = render(md, OPTS);
    for (const size of [1, 5]) {
      const r = new StreamRenderer({ ...OPTS, mode: "live" });
      const pieces = chunks(md, size).map((c) => r.push(c));
      pieces.push(r.end());
      const screen = playLive(pieces);
      assert.equal(screen.join("\n") + (screen.length ? "\n" : ""), expected);
    }
  }
});

test("live mode erases the previous tail with cursor-up + erase-below", () => {
  const r = new StreamRenderer({ ...OPTS, mode: "live" });
  r.push("streaming para");
  const out = r.push(" grows");
  assert.ok(out.startsWith(`${ESC}[1F${ESC}[0J`), JSON.stringify(out));
});

test("a push that changes nothing emits nothing", () => {
  const r = new StreamRenderer({ ...OPTS, mode: "live" });
  r.push("hello");
  assert.equal(r.push(""), "");
});

test("lines() shows the repaired tail: unclosed bold renders styled", () => {
  const r = new StreamRenderer({ width: 40, color: true, mode: "append" });
  r.push("start **bol");
  const view = r.lines().join("\n");
  assert.ok(view.includes(`${ESC}[1mbol${ESC}[0m`), JSON.stringify(view));
  assert.ok(!view.includes("**"), "raw markers must not show");
});

test("a half-typed link label stays literal until ]( arrives", () => {
  const r = new StreamRenderer({ ...OPTS, mode: "append" });
  r.push("see [docs");
  assert.deepEqual(r.lines(), ["see [docs"]);
  r.push("](https://example.test/d");
  assert.deepEqual(r.lines(), ["see docs"]);
});

test("paragraphs commit on the blank line, not before", () => {
  const r = new StreamRenderer({ ...OPTS, mode: "append" });
  assert.equal(r.push("a paragraph\n"), "");
  assert.equal(r.committed.length, 0);
  assert.equal(r.push("\n"), "a paragraph\n");
  assert.deepEqual([...r.committed], ["a paragraph"]);
});

test("fence code lines commit one by one while the fence is open", () => {
  const r = new StreamRenderer({ ...OPTS, mode: "append" });
  r.push("```js\n");
  assert.deepEqual([...r.committed], ["│ js"]);
  r.push("const x = 1;\n");
  assert.deepEqual([...r.committed], ["│ js", "│ const x = 1;"]);
  r.push("half");
  assert.deepEqual([...r.committed], ["│ js", "│ const x = 1;"]);
  assert.deepEqual(r.lines(), ["│ js", "│ const x = 1;", "│ half"]);
});

test("the fence header waits for its newline (info may still be typing)", () => {
  const r = new StreamRenderer({ ...OPTS, mode: "append" });
  r.push("```ja");
  assert.equal(r.committed.length, 0);
  r.push("vascript\n");
  assert.deepEqual([...r.committed], ["│ javascript"]);
});

test("a close-looking partial fence line is hidden, then resolved", () => {
  const r = new StreamRenderer({ ...OPTS, mode: "append" });
  r.push("```\ncode\n``");
  assert.deepEqual(r.lines(), ["│ code"]); // maybe-closing run not shown
  const out = r.push("`\n");
  assert.equal(out, ""); // fence body already committed line-by-line
  assert.equal(r.end(), "");
  assert.deepEqual(r.lines(), ["│ code"]);
});

test("end() finalizes with strict semantics: a lone opener becomes literal", () => {
  const r = new StreamRenderer({ ...OPTS, mode: "append" });
  let out = r.push("ends with *dangler");
  assert.equal(out, ""); // still volatile
  out = r.end();
  assert.equal(out, "ends with *dangler\n"); // CommonMark-literal at EOF
});

test("CRLF input normalizes even when \\r\\n is split across chunks", () => {
  const md = "# h\r\n\r\npara\r\n";
  const r = new StreamRenderer({ ...OPTS, mode: "append" });
  let out = "";
  out += r.push("# h\r");
  out += r.push("\n\r\npara\r");
  out += r.push("\n");
  out += r.end();
  assert.equal(out, render(md, OPTS));
});

test("lifecycle: push after end() throws, end() idempotent, empty stream silent", () => {
  const r = new StreamRenderer(OPTS);
  r.push("x");
  r.end();
  assert.equal(r.end(), "");
  assert.throws(() => r.push("y"), /after end/);
  const empty = new StreamRenderer({ ...OPTS, mode: "append" });
  assert.equal(empty.end(), "");
  assert.deepEqual(empty.lines(), []);
});

test("live tail repaint keeps committed content untouched (screen model)", () => {
  const md = "intro paragraph\n\n- alpha\n- beta\n\noutro\n";
  const r = new StreamRenderer({ ...OPTS, mode: "live" });
  const pieces = [];
  const seenScreens = [];
  for (const ch of md) {
    pieces.push(r.push(ch));
    seenScreens.push(playLive(pieces));
  }
  pieces.push(r.end());
  // The first committed line, once on screen, is on every later screen.
  const withIntro = seenScreens.filter((s) => s[0] === "intro paragraph");
  assert.ok(withIntro.length > 0);
  const firstAt = seenScreens.findIndex((s) => s[0] === "intro paragraph");
  for (let i = firstAt; i < seenScreens.length; i++) {
    assert.equal(seenScreens[i][0], "intro paragraph");
  }
});

test("a long streaming list stays correct while volatile", () => {
  const md = "- one\n- two\n- three\n- four\n";
  const r = new StreamRenderer({ ...OPTS, mode: "append" });
  for (const ch of md) r.push(ch);
  assert.deepEqual(r.lines(), ["• one", "• two", "• three", "• four"]);
  assert.equal(r.committed.length, 0); // still open: next chunk may extend it
  r.push("\ntail\n");
  assert.deepEqual([...r.committed], ["• one", "• two", "• three", "• four"]);
});
