# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-13

### Added

- Incremental block parser with a closed/open contract: every block is
  tagged as final (safe to commit) or still-growing, with conservative
  handling of half-typed markers ("-", "3.", a bare "#", a fence info
  string still being typed).
- Block coverage: ATX and setext headings, paragraphs with hard breaks
  (double-space and backslash), backtick and tilde fenced code, nested
  blockquotes with lazy continuation, ordered/unordered/task lists with
  nesting and loose/tight spacing, GFM pipe tables with alignment and
  `\|` escapes, thematic breaks.
- Inline parser producing flat styled spans: emphasis with
  partial-length delimiter matching (`***x***` → bold+italic), code
  spans with exact-run matching, links, images, autolinks, escapes.
- `repairInline()` — the mid-stream repair pass: speculative closing of
  unclosed emphasis/strike/code, completion of pending link
  destinations, closers inserted before `](`, hiding of just-opened
  markers, literal fallback for unproven labels.
- `StreamRenderer` with two modes: `append` (committed lines only,
  pipe-safe) and `live` (erase + repaint of the volatile tail), CRLF
  normalization across chunk splits, and line-by-line commits inside
  open code fences.
- Enforced streaming invariants: chunk-split invariance (any chunking
  is byte-identical to `render()`), commit monotonicity, the prefix
  property, and screen-model equivalence for live mode.
- Renderer: width-aware greedy wrap over styled spans with CJK, emoji,
  ZWJ-cluster and combining-mark widths; hanging indents; aligned
  tables; per-fragment self-contained SGR; optional OSC 8 hyperlinks
  and dimmed `--show-urls`; themeable SGR roles.
- A pipe-friendly CLI (`markdrip [file]`) with `--width`, `--live`,
  `--plain`, `--color`/`--no-color` (honors `NO_COLOR`),
  `--hyperlinks`, `--show-urls`, and exit codes 0/1/2.
- Streaming contract in `docs/streaming-model.md`; runnable token-replay
  example in `examples/`; test suite: 90 node:test tests plus an
  end-to-end `scripts/smoke.sh`.

[0.1.0]: https://github.com/JaydenCJ/markdrip/releases/tag/v0.1.0
