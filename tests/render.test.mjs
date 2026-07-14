// One-shot rendering: layout (wrapping, prefixes, tables) is asserted in
// --no-color mode where the output is exact text; color mode is asserted
// structurally (every styled fragment opens and closes its own SGR).
import assert from "node:assert/strict";
import test from "node:test";
import { render, wrapSpans, parseInline, stringWidth } from "../dist/index.js";
import { ESC, RESET, stripAnsi } from "./helpers.mjs";

const plain = (md, opts = {}) => render(md, { color: false, width: 40, ...opts });

test("headings keep their hash marker and level", () => {
  assert.equal(plain("# One\n"), "# One\n");
  assert.equal(plain("##### Five\n"), "##### Five\n");
});

test("paragraphs wrap at the requested width with single spaces", () => {
  const out = plain("the quick brown fox jumps over the lazy dog again\n", { width: 20 });
  assert.equal(out, "the quick brown fox\njumps over the lazy\ndog again\n");
});

test("hard breaks force a new line without a blank between", () => {
  assert.equal(plain("first  \nsecond\n"), "first\nsecond\n");
});

test("blocks separate with one blank line; hr spans the full width", () => {
  assert.equal(plain("# H\n\npara\n\n---\n"), "# H\n\npara\n\n" + "─".repeat(40) + "\n");
  assert.equal(plain("---\n", { width: 24 }), "─".repeat(24) + "\n");
});

test("fenced code: gutter prefix, info header, no wrapping, tabs expanded", () => {
  const out = plain("```\na very long code line that would exceed the width limit\n\tindented\n```\n", { width: 20 });
  assert.equal(out, "│ a very long code line that would exceed the width limit\n│     indented\n");
  assert.equal(plain("```rust\nfn x() {}\n```\n"), "│ rust\n│ fn x() {}\n");
});

test("blockquotes prefix every line and re-wrap their content", () => {
  const out = plain("> alpha beta gamma delta epsilon zeta\n", { width: 20 });
  for (const line of out.trimEnd().split("\n")) {
    assert.ok(line.startsWith("▌ "), line);
  }
});

test("list bullets rotate by depth and wrapped lines hang-indent", () => {
  const out = plain("- top level item that wraps around here\n  - nested\n", { width: 24 });
  assert.equal(out, "• top level item that\n  wraps around here\n  ◦ nested\n");
});

test("ordered lists number from startNo; loose gaps; task-list markers", () => {
  assert.equal(plain("3. c\n4. d\n"), "3. c\n4. d\n");
  assert.equal(plain("1. a\n\n2. b\n"), "1. a\n\n2. b\n");
  assert.equal(plain("- [x] shipped\n- [ ] pending\n"), "✔ shipped\n☐ pending\n");
});

test("tables pad cells to column width and honor alignment", () => {
  const out = plain("| name | n |\n|:-----|--:|\n| a | 1 |\n| bbb | 22 |\n");
  // Columns are at least 3 wide; the numeric column right-aligns.
  assert.equal(out, "name │   n\n─────┼────\na    │   1\nbbb  │  22\n");
});

test("table cell widths measure CJK as two display columns", () => {
  const out = plain("| h | x |\n|---|---|\n| 汉字 | y |\n");
  const cols = out
    .trimEnd()
    .split("\n")
    .map((l) => stringWidth(l.replace("┼", "│").split("│")[0].replace(/─/g, "x")));
  assert.ok(cols.every((c) => c === cols[0]), out);
});

test("styled fragments are self-contained SGR; headings recolor + dim marker", () => {
  const out = render("**b** and `c`\n", { width: 40 });
  assert.equal(out, `${ESC}[1mb${RESET} and ${ESC}[93mc${RESET}\n`);
  const h = render("# Title\n", { width: 40 });
  assert.equal(h, `${ESC}[2m# ${RESET}${ESC}[1;95mTitle${RESET}\n`);
});

test("no-color output has zero escape bytes; color strips back to it", () => {
  const md = "# h\n\n**b** *i* `c` [l](u)\n\n> q\n\n- x\n\n| a |\n|---|\n| b |\n";
  const out = plain(md);
  assert.ok(!out.includes("\x1b"), JSON.stringify(out));
  assert.equal(stripAnsi(render(md, { width: 40 })), out);
});

test("--show-urls appends dimmed destinations after labels", () => {
  const out = plain("[docs](https://example.test/docs)\n", { showUrls: true });
  assert.equal(out, "docs (https://example.test/docs)\n");
  // Self-labelled autolinks do not repeat themselves.
  const auto = plain("<https://example.test/>\n", { showUrls: true });
  assert.equal(auto, "https://example.test/\n");
});

test("hyperlinks mode wraps labels in OSC 8", () => {
  const out = render("[docs](https://example.test/d)\n", { hyperlinks: true, width: 40 });
  assert.ok(out.startsWith(`${ESC}]8;;https://example.test/d${ESC}\\`), out);
  assert.ok(out.includes(`${ESC}]8;;${ESC}\\`), out);
});

test("wrapSpans hard-splits an overlong word at grapheme boundaries", () => {
  const lines = wrapSpans(parseInline("汉字汉字汉字"), 5).map((l) => l.map((s) => s.text).join(""));
  assert.deepEqual(lines, ["汉字", "汉字", "汉字"]);
});

test("empty input renders to an empty string", () => {
  assert.equal(render(""), "");
  assert.equal(render("\n\n\n", { color: false }), "");
});
