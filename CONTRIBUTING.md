# Contributing to markdrip

Issues, discussions and pull requests are all welcome — this project aims
to stay one small, dependable engine: zero runtime dependencies,
deterministic output, and a streaming contract that never breaks a
committed line.

## Getting started

Requirements: Node.js >= 22.13 (for the stable `node:test` runner and
`Intl.Segmenter`).

```bash
git clone https://github.com/JaydenCJ/markdrip.git
cd markdrip
npm install            # installs typescript, the only devDependency
npm run build          # compile TypeScript to dist/
npm test               # build + 90 node:test tests
bash scripts/smoke.sh  # end-to-end CLI check through real pipes
```

`scripts/smoke.sh` drives the compiled CLI end to end — one-shot render,
byte-identical streaming, token-sized chunks, mid-stream repair, live
repaint bytes, pipe defaults and the bundled replay example — and must
print `SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` — the tree must type-check clean
   (strict mode plus `noUncheckedIndexedAccess` is enforced).
2. `npm test` — all tests must pass.
3. `bash scripts/smoke.sh` — must print `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable
   modules (the block parser, inline parser, repair pass and wrapper all
   take strings, never streams or file handles).
5. Anything that changes streaming behavior must keep the four invariants
   in `docs/streaming-model.md` true — they are contract, and the
   chunk-invariance and commit-monotonicity tests will catch violations.

## Ground rules

- **No runtime dependencies.** The zero-dependency install is a core
  feature; adding one needs justification in the PR and will usually be
  declined.
- No network calls, ever — this is a pure string→string engine plus a
  stdin/stdout CLI.
- Committed output is stable API: a line, once emitted in append mode,
  must never change meaning within a major version; the CLI exit codes
  (0/1/2) and the erase sequence shape in live mode are likewise stable.
- Repair policy changes need a table row in `docs/streaming-model.md` and
  a test per new tail state; prefer hiding a marker over flashing it.
- Code comments and doc comments are written in English.

## Reporting bugs

Please include: `markdrip --version` output, the exact command line or
API options, and the input as an escaped string (`printf`-style) —
for streaming bugs also the chunk boundaries if you know them, since
most interesting failures live exactly on a split point.

## Security

Do not open public issues for security problems; use GitHub private
vulnerability reporting on this repository instead.
