// Inline parser: emphasis resolution (including partial-length delimiter
// matches), code spans, links, images, autolinks and escapes. These are
// closed-mode semantics — what a *finished* block renders as.
import assert from "node:assert/strict";
import test from "node:test";
import { parseInline, spansText } from "../dist/index.js";

test("plain text passes through as a single span", () => {
  assert.deepEqual(parseInline("just words"), [{ text: "just words" }]);
});

test("bold, italic and strikethrough resolve to attribute flags", () => {
  assert.deepEqual(parseInline("a **b** c"), [
    { text: "a " },
    { text: "b", bold: true },
    { text: " c" },
  ]);
  assert.deepEqual(parseInline("*i*"), [{ text: "i", italic: true }]);
  assert.deepEqual(parseInline("~~s~~"), [{ text: "s", strike: true }]);
});

test("underscores emphasize at word edges but never intraword", () => {
  assert.deepEqual(parseInline("snake_case_name"), [{ text: "snake_case_name" }]);
  assert.deepEqual(parseInline("_lead_"), [{ text: "lead", italic: true }]);
});

test("triple delimiters produce bold+italic (partial-length matching)", () => {
  assert.deepEqual(parseInline("***x***"), [{ text: "x", bold: true, italic: true }]);
  // Leftover run halves render literally, like CommonMark.
  assert.deepEqual(parseInline("***a**"), [
    { text: "*" },
    { text: "a", bold: true },
  ]);
  assert.deepEqual(parseInline("**a***"), [
    { text: "a", bold: true },
    { text: "*" },
  ]);
});

test("nested emphasis stacks attributes", () => {
  assert.deepEqual(parseInline("**a *b* c**"), [
    { text: "a ", bold: true },
    { text: "b", bold: true, italic: true },
    { text: " c", bold: true },
  ]);
});

test("unmatched delimiters render literally", () => {
  assert.deepEqual(parseInline("a * b"), [{ text: "a * b" }]);
  assert.deepEqual(parseInline("*open forever"), [{ text: "*open forever" }]);
});

test("code spans win over emphasis and keep their content verbatim", () => {
  assert.deepEqual(parseInline("`a ** b`"), [{ text: "a ** b", code: true }]);
  assert.deepEqual(parseInline("x `y` z"), [
    { text: "x " },
    { text: "y", code: true },
    { text: " z" },
  ]);
});

test("backtick runs match by exact length and normalize one symmetric space", () => {
  assert.deepEqual(parseInline("``a ` b``"), [{ text: "a ` b", code: true }]);
  assert.deepEqual(parseInline("` `` `"), [{ text: "``", code: true }]);
  assert.deepEqual(parseInline("a `b"), [{ text: "a `b" }]); // unclosed → literal
});

test("links attach an href to their label spans", () => {
  assert.deepEqual(parseInline("[label](https://example.test/doc)"), [
    { text: "label", href: "https://example.test/doc" },
  ]);
  assert.deepEqual(parseInline("see [**b** t](u) end"), [
    { text: "see " },
    { text: "b", bold: true, href: "u" },
    { text: " t", href: "u" },
    { text: " end" },
  ]);
});

test("link destinations support <angle> form and quoted titles", () => {
  assert.deepEqual(parseInline("[l](<u v> \"title\")"), [{ text: "l", href: "u v" }]);
  assert.deepEqual(parseInline("[l](u 'title')"), [{ text: "l", href: "u" }]);
  // A bracket pair that never becomes a link stays literal.
  assert.deepEqual(parseInline("[not a link] here"), [{ text: "[not a link] here" }]);
});

test("images render as alt text with href; autolinks self-label", () => {
  assert.deepEqual(parseInline("![alt text](pic.png)"), [
    { text: "alt text", href: "pic.png" },
  ]);
  assert.deepEqual(parseInline("go <https://example.test/> now"), [
    { text: "go " },
    { text: "https://example.test/", href: "https://example.test/" },
    { text: " now" },
  ]);
});

test("backslash escapes suppress markdown meaning", () => {
  assert.deepEqual(parseInline("\\*not em\\*"), [{ text: "*not em*" }]);
  assert.deepEqual(parseInline("\\`tick"), [{ text: "`tick" }]);
});

test("spansText flattens a span list back to plain text", () => {
  assert.equal(spansText(parseInline("**a** `b` [c](d)")), "a b c");
});
