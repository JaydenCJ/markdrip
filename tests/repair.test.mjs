// Mid-stream inline repair — the module that lets an unfinished paragraph
// render sensibly on every keystroke. Each case documents the repair
// policy: speculative styling for unclosed constructs, hidden markers for
// just-opened ones, literal fallbacks where linkhood is unproven.
import assert from "node:assert/strict";
import test from "node:test";
import { parseInline, repairInline } from "../dist/index.js";

test("complete or non-markdown text is returned unchanged", () => {
  for (const s of ["plain", "**done**", "`code`", "[l](u)", "a *b* c ~~d~~"]) {
    assert.equal(repairInline(s), s);
  }
  // Delimiters that cannot open (whitespace on both sides) never repair.
  assert.equal(repairInline("3 * 4 = 12"), "3 * 4 = 12");
  assert.equal(repairInline("a * b * c"), "a * b * c");
});

test("unclosed bold/italic/strike are closed at the end", () => {
  assert.equal(repairInline("a **bold"), "a **bold**");
  assert.equal(repairInline("a *ital"), "a *ital*");
  assert.equal(repairInline("a ~~gone"), "a ~~gone~~");
  assert.equal(repairInline("a __strong"), "a __strong__");
});

test("nested unclosed emphasis closes innermost-first", () => {
  assert.equal(repairInline("**a *b"), "**a *b***");
  assert.deepEqual(parseInline(repairInline("**a *b")), [
    { text: "a ", bold: true },
    { text: "b", bold: true, italic: true },
  ]);
});

test("closers land before trailing whitespace so the style shows", () => {
  assert.equal(repairInline("a *b "), "a *b* ");
  assert.deepEqual(parseInline(repairInline("a *b ")), [
    { text: "a " },
    { text: "b", italic: true },
    { text: " " },
  ]);
});

test("just-opened markers at the very end are hidden, not closed", () => {
  assert.equal(repairInline("text **"), "text ");
  assert.equal(repairInline("text *"), "text ");
  assert.equal(repairInline("text ~~"), "text ");
  assert.equal(repairInline("text `"), "text ");
  assert.equal(repairInline("text ``"), "text ");
  assert.equal(repairInline("see ["), "see ");
  assert.equal(repairInline("see !["), "see ");
  assert.equal(repairInline("wow!"), "wow!"); // a real exclamation stays
});

test("an unclosed backtick run swallows the rest as code, delimiters and all", () => {
  assert.equal(repairInline("run `npm tes"), "run `npm tes`");
  assert.deepEqual(parseInline(repairInline("run `npm tes")), [
    { text: "run " },
    { text: "npm tes", code: true },
  ]);
  assert.equal(repairInline("`a ** b"), "`a ** b`");
  assert.deepEqual(parseInline(repairInline("`a ** b")), [{ text: "a ** b", code: true }]);
});

test("double-backtick spans repair with a matching run", () => {
  assert.equal(repairInline("``a ` b"), "``a ` b``");
});

test("emphasis opened before an unclosed code span closes after it", () => {
  assert.equal(repairInline("**bold `co"), "**bold `co`**");
});

test("a pending destination completes: label styles, URL suppressed later", () => {
  assert.equal(repairInline("[label](https://exa"), "[label](https://exa)");
  assert.deepEqual(parseInline(repairInline("[label](https://exa")), [
    { text: "label", href: "https://exa" },
  ]);
  assert.equal(repairInline("[label]("), "[label]()");
  assert.equal(repairInline("[l](<u v"), "[l](<u v>)");
});

test("a bare open label stays literal until ]( proves linkhood", () => {
  assert.equal(repairInline("see [maybe"), "see [maybe");
  assert.deepEqual(parseInline("see [maybe"), [{ text: "see [maybe" }]);
});

test("emphasis opened inside a link label closes before ](", () => {
  assert.equal(repairInline("[a **b](u"), "[a **b**](u)");
  assert.deepEqual(parseInline(repairInline("[a **b](u")), [
    { text: "a ", href: "u" },
    { text: "b", bold: true, href: "u" },
  ]);
  // An empty run right before "](" is left literal, not force-closed.
  assert.equal(repairInline("[a **](u"), "[a **](u)");
});

test("a trailing lone backslash is dropped (it escapes nothing yet)", () => {
  assert.equal(repairInline("wait \\"), "wait ");
  assert.equal(repairInline("kept \\\\"), "kept \\\\"); // escaped backslash stays
});

test("repaired output always parses without unmatched styled runs", () => {
  const tails = [
    "**a `b ~~c",
    "[x **y](http://e",
    "*a **b ~~c `d",
    "text with [half",
    "auto <https://exa",
  ];
  for (const t of tails) {
    const spans = parseInline(repairInline(t));
    assert.ok(Array.isArray(spans) && spans.length > 0, `parse failed for ${t}`);
  }
});
