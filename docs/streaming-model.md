# The streaming model

This document is the contract behind `StreamRenderer`. If a change makes
any statement here false, it is a breaking change.

## Two regions

At any moment the rendered document is split into:

- **Committed lines** — output of *closed* blocks. Emitted exactly once,
  never repainted, never mutated. In `append` mode they are the only thing
  ever written, which makes `tool | markdrip | tee log` safe.
- **The volatile tail** — the (at most one) *open* block at the end of the
  input. It re-renders on every `push()`; in `live` mode the previous tail
  is erased with `CSI n F` + `CSI 0 J` and repainted.

## When does a block close?

A block closes when no future input can change it:

| Block | Closes when |
|---|---|
| ATX heading, `hr` | its line receives a newline |
| setext heading | the underline line receives a newline |
| paragraph | a blank line, or an unambiguous new-block line, arrives |
| fenced code | a terminated closing fence of sufficient length arrives |
| blockquote | a blank line or a new block ends it |
| list | a non-continuation line arrives (blanks alone never close it) |
| table | a blank line or a new block ends it |
| anything | `end()` is called (`atEnd` finalization) |

Ambiguity is resolved conservatively: a half-typed `-` or `3` after a list
keeps the list open (it may become the next item), a lone `#` stays
paragraph text (it may become `#hashtag`), a fence header waits for its
newline before committing (the info string may still be typing).

**Fenced code is special.** Each newline-terminated code line commits
immediately — code lines render independently, so a 500-line streaming
code block repaints at most one partial line, not 500. A partial line that
looks like the closing fence (` ``` ` being typed) is hidden rather than
flashed as code.

## Inline repair (the volatile tail only)

Open paragraphs and headings run through `repairInline()` before parsing:

| Tail state | Policy |
|---|---|
| `**bold`, `*i`, `~~s`, `__b` | close speculatively — render styled |
| `` `code `` | close the run — render the rest as code |
| `[label](partial-url` | complete — style the label, hide the URL |
| `[label` | literal until `](` proves linkhood |
| trailing `**` / `` ` `` / `[` just opened | hidden (no marker flash) |
| `[a **b](u` | emphasis closers insert *before* `](` |
| trailing `\` | dropped (it escapes nothing yet) |

`end()` switches to strict CommonMark-style semantics: a dangler that
never closed renders literally, exactly as `render()` would.

## Invariants (all enforced by the test suite)

1. **Chunk-split invariance.** For any document and any chunking of it,
   `concat(push(...chunks), end())` in append mode is byte-identical to
   `render(document)`.
2. **Commit monotonicity.** The committed line list only ever grows; a
   committed line never changes.
3. **Prefix property.** Append-mode output at any moment is a prefix of
   the final output.
4. **Screen equivalence.** Replaying live-mode output against a terminal
   model (lines + erase-up) reproduces the one-shot render exactly.

## Cost model

`push()` re-parses only the uncommitted tail (committed source is dropped
from the buffer), so steady-state cost per push is proportional to the
open block, not the document. Greedy wrapping keeps already-wrapped lines
of a growing paragraph stable, so live repaints do not flicker upstream.
