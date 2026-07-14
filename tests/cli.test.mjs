// End-to-end CLI behavior against the compiled binary: flags, exit codes,
// file vs stdin input, and the piped (non-TTY) defaults — append mode and
// no color — that make `tool | markdrip | tee log` safe.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, ROOT } from "./helpers.mjs";
import { readFileSync } from "node:fs";

test("--version prints the package.json version", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const { stdout, code } = runCli(["--version"]);
  assert.equal(code, 0);
  assert.equal(stdout, `${pkg.version}\n`);
});

test("--help documents the surface and exits 0", () => {
  const { stdout, code } = runCli(["--help"]);
  assert.equal(code, 0);
  for (const word of ["--width", "--plain", "--live", "--no-color", "--hyperlinks", "Exit codes"]) {
    assert.ok(stdout.includes(word), `help missing ${word}`);
  }
});

test("usage errors exit 2 with a diagnostic on stderr", () => {
  const { code, stderr, stdout } = runCli(["--frobnicate"]);
  assert.equal(code, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /^markdrip: unknown option: --frobnicate/);
  // --width range and missing value
  assert.equal(runCli(["--width", "0"]).code, 2);
  assert.equal(runCli(["--width", "nope"]).code, 2);
  assert.equal(runCli(["--width"]).code, 2);
  // a second positional argument
  const dup = runCli(["a.md", "b.md"]);
  assert.equal(dup.code, 2);
  assert.match(dup.stderr, /unexpected argument/);
});

test("renders a file argument one-shot", () => {
  const dir = mkdtempSync(join(tmpdir(), "markdrip-"));
  try {
    const file = join(dir, "doc.md");
    writeFileSync(file, "# Hi\n\n**bold** move\n");
    const { stdout, code } = runCli([file, "--width", "40"]);
    assert.equal(code, 0);
    assert.equal(stdout, "# Hi\n\nbold move\n"); // piped: no color
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing file exits 1 with a readable error", () => {
  const { code, stderr } = runCli([join(tmpdir(), "definitely-missing.md")]);
  assert.equal(code, 1);
  assert.match(stderr, /^markdrip: cannot read /);
});

test("stdin streams through the renderer: append mode, no color when piped", () => {
  const md = "# T\n\npara with `code`\n\n- a\n- b\n\nend\n";
  const { stdout, code } = runCli(["--width", "40"], { input: md });
  assert.equal(code, 0);
  assert.equal(stdout, "# T\n\npara with code\n\n• a\n• b\n\nend\n");
  assert.ok(!stdout.includes("\x1b"));
  const forced = runCli(["--color"], { input: "**bold**\n" }).stdout;
  assert.ok(forced.includes("\x1b[1mbold\x1b[0m"), JSON.stringify(forced));
});

test("--live works over a pipe: repaint sequences appear in the byte stream", () => {
  const md = "grow grow grow\n\nnext\n";
  const { stdout, code } = runCli(["--live", "--width", "40"], { input: md });
  assert.equal(code, 0);
  assert.ok(stdout.includes("\x1b[1F\x1b[0J") || stdout.includes("\x1b[2F\x1b[0J"), JSON.stringify(stdout));
});

test("--show-urls and --hyperlinks change link rendering end to end", () => {
  const md = "[docs](https://example.test/d)\n";
  const plain = runCli(["--show-urls"], { input: md }).stdout;
  assert.equal(plain, "docs (https://example.test/d)\n");
  const osc = runCli(["--hyperlinks", "--color"], { input: md }).stdout;
  assert.ok(osc.includes("\x1b]8;;https://example.test/d\x1b\\"), JSON.stringify(osc));
});

test("stdin end-to-end equals the one-shot render; '-' reads stdin explicitly", () => {
  const dash = runCli(["-", "--width", "30"], { input: "hello **there**\n" });
  assert.equal(dash.code, 0);
  assert.equal(dash.stdout, "hello there\n");
  const md = "# A\n\n> q\n\n```\nx\n```\n\n| h |\n|---|\n| v |\n";
  const viaStdin = runCli(["--width", "40"], { input: md }).stdout;
  const viaFile = (() => {
    const dir = mkdtempSync(join(tmpdir(), "markdrip-"));
    try {
      const f = join(dir, "d.md");
      writeFileSync(f, md);
      return runCli([f, "--width", "40"]).stdout;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
  assert.equal(viaStdin, viaFile);
});
