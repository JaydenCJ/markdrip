# markdrip examples

Runnable demonstrations of the streaming engine. Everything is offline and
deterministic; run from the repository root after
`npm install && npm run build`.

## replay.mjs

```bash
node examples/replay.mjs            # instant
DELAY_MS=15 node examples/replay.mjs  # watch it stream on a TTY
```

Feeds `tour.md` through `StreamRenderer` four characters at a time — the
same shape as a model token stream. On a TTY the open tail repaints in
place; through a pipe only committed (final) lines are emitted, so the
output is identical to a one-shot render.

## Shell one-liners

The CLI covers the same engine from a pipe:

```bash
# Render a document.
node dist/cli.js examples/tour.md

# Stream: markdown formats while it arrives (repaint on a TTY).
cat examples/tour.md | node dist/cli.js

# Simulate slow token arrival and watch blocks commit incrementally.
(for w in "# Str" "eaming" " title" $'\n\nbody **grows' ' here**\n'; do
   printf '%s' "$w"; sleep 0.3; done) | node dist/cli.js --live

# Show the escape sequences markdrip emits (visualize with cat -v).
printf '**bold** and `code`\n' | node dist/cli.js --color | cat -v
```
