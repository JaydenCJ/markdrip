// Incremental block parser: block recognition, and — the part that makes
// streaming safe — the `closed` flag. A closed block may never change when
// more input arrives; an open block is the (single, trailing) region the
// streaming engine repaints.
import assert from "node:assert/strict";
import test from "node:test";
import { parseBlocks } from "../dist/index.js";

const kinds = (src, opts) => parseBlocks(src, opts).map((b) => `${b.kind}:${b.closed ? "closed" : "open"}`);

test("ATX headings: level, text, closing hashes stripped", () => {
  const [h] = parseBlocks("### Sub topic\n");
  assert.equal(h.level, 3);
  assert.equal(h.text, "Sub topic");
  assert.equal(parseBlocks("## trimmed ##\n")[0].text, "trimmed");
});

test("a heading closes with its newline; a bare '#' stays a paragraph", () => {
  assert.deepEqual(kinds("# Title\n"), ["heading:closed"]);
  assert.deepEqual(kinds("# Title"), ["heading:open"]);
  // mid-stream "#" could still become "#hashtag" text
  assert.deepEqual(kinds("#"), ["paragraph:open"]);
  assert.deepEqual(kinds("#\n"), ["heading:closed"]);
});

test("setext underlines convert the paragraph above into a heading", () => {
  const [h1] = parseBlocks("Title\n===\n");
  assert.equal(h1.kind, "heading");
  assert.equal(h1.level, 1);
  assert.equal(h1.setext, true);
  const [h2] = parseBlocks("Sub\n---\n");
  assert.equal(h2.level, 2);
});

test("paragraphs join softly, close on blank lines, encode hard breaks", () => {
  assert.deepEqual(kinds("one line\ntwo line\n\n"), ["paragraph:closed"]);
  assert.deepEqual(kinds("still typing"), ["paragraph:open"]);
  assert.equal(parseBlocks("soft\nwrap\n")[0].text, "soft wrap");
  // trailing double-space and backslash become hard breaks
  assert.equal(parseBlocks("a  \nb\n\n")[0].text, "a\nb");
  assert.equal(parseBlocks("a\\\nb\n\n")[0].text, "a\nb");
});

test("atEnd finalizes the trailing block", () => {
  assert.deepEqual(kinds("tail text", { atEnd: true }), ["paragraph:closed"]);
  assert.deepEqual(kinds("```js\ncode", { atEnd: true }), ["fence:closed"]);
});

test("fences collect complete lines; the unterminated tail is `partial`", () => {
  const [f] = parseBlocks("```py\nline1\nline2\nline3");
  assert.equal(f.kind, "fence");
  assert.equal(f.closed, false);
  assert.equal(f.info, "py");
  assert.deepEqual(f.lines, ["line1", "line2"]);
  assert.equal(f.partial, "line3");
});

test("a fence closes only on a terminated closing run of enough length", () => {
  assert.deepEqual(kinds("````\ncode with ``` inside\n````\n"), ["fence:closed"]);
  assert.deepEqual(kinds("```\ncode\n```"), ["fence:open"]); // close still typing
  const [f] = parseBlocks("~~~\ntilde\n~~~\nafter\n\n");
  assert.equal(f.fenceChar, "~");
  assert.equal(f.closed, true);
});

test("fence continuation state resumes mid-fence for partial commits", () => {
  const cont = { fenceChar: "`", fenceLen: 3, indent: 0, info: "js" };
  const [f] = parseBlocks("more()\n```\n", { cont });
  assert.equal(f.kind, "fence");
  assert.equal(f.cont, true);
  assert.equal(f.closed, true);
  assert.deepEqual(f.lines, ["more()"]);
});

test("blockquotes strip markers, support lazy continuation, nest blocks", () => {
  const [q] = parseBlocks("> quoted line\n> more\n\n");
  assert.equal(q.kind, "quote");
  assert.equal(q.closed, true);
  assert.equal(q.children[0].text, "quoted line more");
  const [lazy] = parseBlocks("> starts quoted\nlazily continued\n\n");
  assert.equal(lazy.children[0].text, "starts quoted lazily continued");
});

test("unordered lists collect items; nesting comes from indentation", () => {
  const [l] = parseBlocks("- a\n- b\n  - b1\n- c\n\nx\n");
  assert.equal(l.kind, "list");
  assert.equal(l.closed, true);
  assert.equal(l.items.length, 3);
  assert.equal(l.loose, false);
  const nested = l.items[1].blocks.find((b) => b.kind === "list");
  assert.equal(nested.items.length, 1);
});

test("ordered lists keep their start number and become loose on blank gaps", () => {
  const [l] = parseBlocks("3. three\n4. four\n\n5. five\n\nend\n");
  assert.equal(l.ordered, true);
  assert.equal(l.startNo, 3);
  assert.equal(l.items.length, 3);
  assert.equal(l.loose, true);
});

test("task-list markers are recognized and stripped from item text", () => {
  const [l] = parseBlocks("- [ ] todo\n- [x] done\n\n");
  assert.equal(l.items[0].task, " ");
  assert.equal(l.items[1].task, "x");
  assert.equal(l.items[1].blocks[0].text, "done");
});

test("a list stays open across trailing blanks and half-typed markers", () => {
  assert.deepEqual(kinds("- a\n\n"), ["list:open"]);
  assert.deepEqual(kinds("- a\n\nplain\n"), ["list:closed", "paragraph:open"]);
  // "-" / "3" may still become "- item" / "3. item": don't split the list
  const blocks = parseBlocks("- a\n-");
  assert.equal(blocks[0].kind, "list");
  assert.equal(blocks[0].closed, false);
  assert.equal(parseBlocks("1. a\n2. b\n\n3")[0].closed, false);
});

test("thematic breaks need three markers on a settled line", () => {
  assert.deepEqual(kinds("---\n"), ["hr:closed"]);
  assert.deepEqual(kinds("- - -\n"), ["hr:closed"]);
  assert.deepEqual(kinds("--\n"), ["paragraph:open"]);
});

test("tables need a settled delimiter row; alignment and \\| escapes hold", () => {
  const [t] = parseBlocks("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n\n");
  assert.equal(t.kind, "table");
  assert.equal(t.closed, true);
  assert.deepEqual(t.header, ["a", "b", "c"]);
  assert.deepEqual(t.align, ["left", "center", "right"]);
  assert.deepEqual(t.rows, [["1", "2", "3"]]);
  assert.deepEqual(parseBlocks("| a\\|b | c |\n|---|---|\n| d | e |\n\n")[0].header, ["a|b", "c"]);
  // the header line is a paragraph until the delimiter row settles
  assert.deepEqual(kinds("| a | b |\n"), ["paragraph:open"]);
  assert.deepEqual(kinds("| a | b |\n|---|--"), ["paragraph:open"]);
  assert.deepEqual(kinds("| a | b |\n|---|---|\n"), ["table:open"]);
});

test("offsets cover each block through its terminator", () => {
  const src = "# h\n\npara\n\n";
  const [h, p] = parseBlocks(src);
  assert.equal(src.slice(h.start, h.end), "# h\n");
  assert.equal(src.slice(p.start, p.end), "para\n");
});
