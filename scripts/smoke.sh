#!/usr/bin/env bash
# Smoke test for markdrip: drives the real CLI end to end through pipes —
# one-shot rendering, incremental streaming, repair of a truncated stream,
# live-mode repaint bytes, and the bundled example. No network, idempotent,
# runs from a clean checkout (after `npm install`). Prints "SMOKE OK".
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

ESC=$'\x1b'

# 1. Build (idempotent).
npm run build >/dev/null 2>&1 || fail "npm run build failed"
CLI="node $ROOT/dist/cli.js"
echo "[smoke] build ok"

# 2. --version matches package.json; --help documents the surface.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in --width --plain --live --no-color --hyperlinks "Exit codes"; do
  echo "$HELP" | grep -q -- "$word" || fail "--help missing $word"
done
echo "[smoke] --help/--version ok ($CLI_VERSION)"

# 3. Usage errors exit 2; a missing file exits 1.
set +e
$CLI --frobnicate </dev/null >/dev/null 2>"$WORKDIR/err"; code=$?
set -e
[ "$code" -eq 2 ] || fail "unknown option should exit 2, got $code"
grep -q "^markdrip: " "$WORKDIR/err" || fail "usage error must print a diagnostic"
set +e
$CLI "$WORKDIR/does-not-exist.md" >/dev/null 2>&1; code=$?
set -e
[ "$code" -eq 1 ] || fail "missing file should exit 1, got $code"
echo "[smoke] exit codes ok (2 usage, 1 io)"

# 4. One-shot render of a document with every block type.
cat > "$WORKDIR/doc.md" <<'MD'
# Smoke

A paragraph with **bold**, `code` and a [link](https://example.test/d).

- item one
- item two

```js
const x = 1;
```

| a | b |
|---|---|
| 1 | 2 |
MD
$CLI "$WORKDIR/doc.md" --width 60 > "$WORKDIR/one"
grep -q "^# Smoke$" "$WORKDIR/one" || fail "heading missing"
grep -q "• item one" "$WORKDIR/one" || fail "bullet missing"
grep -q "│ const x = 1;" "$WORKDIR/one" || fail "code gutter missing"
grep -q "─┼─" "$WORKDIR/one" || fail "table rule missing"
echo "[smoke] one-shot render ok"

# 5. Streaming through a pipe equals the one-shot render, byte for byte.
$CLI --width 60 < "$WORKDIR/doc.md" > "$WORKDIR/streamed"
diff "$WORKDIR/one" "$WORKDIR/streamed" >/dev/null || fail "stream output != one-shot output"
echo "[smoke] pipe streaming ok (identical bytes)"

# 6. Token-sized chunks through a real pipe: still identical.
node -e '
  const fs = require("node:fs");
  const doc = fs.readFileSync(process.argv[1], "utf8");
  (async () => {
    for (let i = 0; i < doc.length; i += 3) {
      process.stdout.write(doc.slice(i, i + 3));
      await new Promise((r) => setImmediate(r));
    }
  })();
' "$WORKDIR/doc.md" | $CLI --width 60 > "$WORKDIR/chunked"
diff "$WORKDIR/one" "$WORKDIR/chunked" >/dev/null || fail "chunked stream output differs"
echo "[smoke] token-chunked streaming ok"

# 7. Mid-stream repair: while the tail is open, live mode paints the
#    unclosed code span styled; end() then finalizes with strict
#    (CommonMark-literal) semantics.
printf '# Cut\n\nan unclosed **bold and `code' | $CLI --live --width 60 --color > "$WORKDIR/cut"
grep -q "Cut" "$WORKDIR/cut" || fail "truncated stream lost the heading"
grep -Fq "${ESC}[1;93mcode${ESC}[0m" "$WORKDIR/cut" || fail "open tail must paint the repaired bold code span"
tail -n 1 "$WORKDIR/cut" | grep -Fq '`code' || fail "end() must finalize the dangler as literal"
echo "[smoke] mid-stream repair ok (styled while open, literal at EOF)"

# 8. Live mode emits repaint sequences (cursor-up + erase-below).
printf 'grow grow grow\n\nnext para\n' | $CLI --live --width 60 > "$WORKDIR/live"
grep -q "F${ESC}\[0J" "$WORKDIR/live" || fail "live mode must repaint the tail"
echo "[smoke] live repaint ok"

# 9. Piped output is append-only and colorless; --color forces SGR.
printf '**b**\n' | $CLI > "$WORKDIR/plain"
if grep -q "$ESC" "$WORKDIR/plain"; then fail "piped output must be escape-free"; fi
printf '**b**\n' | $CLI --color | grep -Fq "${ESC}[1mb${ESC}[0m" || fail "--color must emit SGR"
echo "[smoke] pipe defaults ok (no escapes unless forced)"

# 10. The bundled example replays the tour byte-identically to one-shot.
node "$ROOT/examples/replay.mjs" > "$WORKDIR/replay" || fail "examples/replay.mjs failed"
$CLI "$ROOT/examples/tour.md" --width 72 > "$WORKDIR/tour"
diff "$WORKDIR/replay" "$WORKDIR/tour" >/dev/null || fail "example replay differs from one-shot"
echo "[smoke] example replay ok"

# 11. A downstream that closes early (| head, a pager) must not crash the
#     stream: no EPIPE stack trace, clean exit.
awk 'BEGIN { for (i = 0; i < 20000; i++) printf "paragraph %d with words to bulk the stream up\n\n", i }' \
  > "$WORKDIR/big.md"
set +e
( $CLI < "$WORKDIR/big.md" 2>"$WORKDIR/epipe"; echo "$?" > "$WORKDIR/epipe.code" ) | head -n 2 >/dev/null
set -e
code="$(cat "$WORKDIR/epipe.code")"
[ "$code" -eq 0 ] || fail "early pipe close should exit 0, got $code"
[ ! -s "$WORKDIR/epipe" ] || fail "early pipe close must not print a stack trace"
echo "[smoke] early pipe close ok (quiet exit)"

echo "SMOKE OK"
