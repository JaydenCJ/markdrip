// Display-width rules: layout happens on plain text, so these widths are
// the foundation every wrap/table/list measurement builds on.
import assert from "node:assert/strict";
import test from "node:test";
import { graphemes, stringWidth } from "../dist/index.js";

test("ASCII counts one column per character", () => {
  assert.equal(stringWidth("hello"), 5);
  assert.equal(stringWidth(""), 0);
  assert.equal(stringWidth("a b"), 3);
});

test("CJK ideographs, kana and fullwidth forms are two columns", () => {
  assert.equal(stringWidth("汉字"), 4);
  assert.equal(stringWidth("こんにちは"), 10);
  assert.equal(stringWidth("mixed汉x"), 8);
  assert.equal(stringWidth("ＡＢ"), 4);
});

test("emoji are two columns, including ZWJ families and skin tones", () => {
  assert.equal(stringWidth("👍"), 2);
  assert.equal(stringWidth("👩‍👩‍👦"), 2); // one family, one cluster
  assert.equal(stringWidth("👍🏽"), 2);
});

test("VS16 forces emoji presentation width", () => {
  assert.equal(stringWidth("☂️"), 2);
});

test("combining marks add no width", () => {
  assert.equal(stringWidth("cafe\u0301"), 4); // e + combining acute
  assert.equal(stringWidth("a\u200Bb"), 2); // zero-width space
});

test("graphemes() clusters ZWJ sequences and combining marks", () => {
  assert.deepEqual(graphemes("ab"), ["a", "b"]);
  assert.equal(graphemes("👩‍👩‍👦x").length, 2);
  assert.equal(graphemes("e\u0301x").length, 2);
});
