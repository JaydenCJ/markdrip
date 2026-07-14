/**
 * Mid-stream inline repair: turn the incomplete tail of a streaming
 * paragraph into well-formed markdown so the normal (closed-mode) inline
 * parser can render it.
 *
 * The policy is speculative-but-stable:
 *  - unclosed `**` / `*` / `__` / `_` / `~~` render styled (the closer is
 *    almost always still on its way), with closers inserted where the
 *    construct would have to end (before `](...)` for emphasis opened
 *    inside a link label, at end of text otherwise);
 *  - an unclosed backtick run renders the rest of the line as code;
 *  - `[label](partial-url` renders as a link label with the raw URL
 *    hidden; a bare `[label` stays literal until `](` proves linkhood;
 *  - a delimiter that was *just* opened at the very end of the input
 *    (`text **`) is dropped instead of rendered, so raw markers never
 *    flash on screen between tokens.
 *
 * Everything here is a pure string → string transformation, which is what
 * makes the behavior easy to test and reason about.
 */

const PUNCT = new Set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~");

function isWs(ch: string | undefined): boolean {
  return ch === undefined || ch === " " || ch === "\t" || ch === "\n";
}
function isAlnum(ch: string | undefined): boolean {
  return ch !== undefined && !isWs(ch) && !PUNCT.has(ch);
}

interface EmphOpen {
  char: "*" | "_" | "~";
  rem: number;
  /** Index just past the run in the source (to detect "just opened"). */
  endPos: number;
  /** Opened inside the label of a link currently being scanned. */
  inLabel: boolean;
}

interface Insertion {
  pos: number;
  text: string;
}

/** Closer text for the remaining length of an emphasis opener. */
function emphCloser(e: EmphOpen): string {
  return e.char.repeat(e.rem);
}

/**
 * Repair an incomplete inline tail into complete markdown.
 * Returns the input unchanged when nothing dangles.
 */
export function repairInline(src: string): string {
  const insertions: Insertion[] = [];
  const stack: EmphOpen[] = [];
  let codeOpenLen = 0; // >0: an unclosed backtick run swallows the rest
  let codeOpenPos = -1; // index of the run start
  // Link scanning state.
  let labelStart = -1; // index just past "[" of a candidate label
  let destStart = -1; // index just past "](" once seen
  let destAngle = false; // destination uses the <...> form

  const closeLabelEmphasis = (pos: number): void => {
    // Emphasis opened inside the label must close before "](" —
    // appending at end of input would style the destination.
    for (let i = stack.length - 1; i >= 0; i--) {
      const e = stack[i]!;
      if (!e.inLabel) continue;
      // An opener with no content before "]" (e.g. "[a **]") is left
      // literal; inserting a closer right next to it would only create a
      // longer unmatched run.
      if (e.endPos < pos) insertions.push({ pos, text: emphCloser(e) });
      stack.splice(i, 1);
    }
  };

  let i = 0;
  outer: while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") {
      let len = 0;
      while (src[i + len] === "`") len++;
      // Look for a closing run of exactly `len`.
      let j = i + len;
      while (j < src.length) {
        if (src[j] === "`") {
          let n = 0;
          while (src[j + n] === "`") n++;
          if (n === len) {
            i = j + n;
            continue outer;
          }
          j += n;
        } else {
          j++;
        }
      }
      // Unclosed: everything after is code content; nothing inside needs repair.
      codeOpenLen = len;
      codeOpenPos = i;
      i = src.length;
      break;
    }
    if (ch === "[" && labelStart < 0 && destStart < 0) {
      labelStart = i + 1;
      i++;
      continue;
    }
    if (ch === "]" && labelStart >= 0 && destStart < 0) {
      if (src[i + 1] === "(") {
        closeLabelEmphasis(i);
        destStart = i + 2;
        destAngle = src[i + 2] === "<";
        i += 2;
        continue;
      }
      // "[label]" without "(" — not (yet) a link; forget the label.
      labelStart = -1;
      for (const e of stack) e.inLabel = false;
      i++;
      continue;
    }
    if (ch === ")" && destStart >= 0) {
      // Link completed normally.
      labelStart = -1;
      destStart = -1;
      destAngle = false;
      i++;
      continue;
    }
    if ((ch === "*" || ch === "_" || ch === "~") && destStart < 0) {
      let len = 0;
      while (src[i + len] === ch) len++;
      if (ch === "~" && len !== 2) {
        i += len;
        continue;
      }
      const prev = src[i - 1];
      const next = src[i + len];
      let canOpen = !isWs(next);
      let canClose = !isWs(prev);
      if (ch === "_") {
        canOpen = canOpen && !isAlnum(prev);
        canClose = canClose && !isAlnum(next);
      }
      let rem = len;
      if (canClose) {
        while (rem > 0) {
          let opener: EmphOpen | null = null;
          for (let s = stack.length - 1; s >= 0; s--) {
            if (stack[s]!.char === ch && stack[s]!.rem > 0) {
              opener = stack[s]!;
              break;
            }
          }
          if (!opener) break;
          const use = Math.min(opener.rem, rem) >= 2 ? 2 : 1;
          opener.rem -= use;
          rem -= use;
          if (opener.rem === 0) stack.splice(stack.indexOf(opener), 1);
        }
      }
      // At end of input, "canOpen" is speculative: `text *` has no "next"
      // character yet. Treat a trailing run as just-opened so it can be
      // stripped below instead of flashing raw markers.
      const atVeryEnd = i + len === src.length;
      if (rem > 0 && (canOpen || atVeryEnd)) {
        stack.push({ char: ch, rem, endPos: i + len, inLabel: labelStart >= 0 });
      }
      i += len;
      continue;
    }
    i++;
  }

  // ---- Assemble the repaired string. ----
  let out = src;

  // Apply mid-string insertions right-to-left so positions stay valid.
  insertions.sort((a, b) => b.pos - a.pos);
  for (const ins of insertions) {
    out = out.slice(0, ins.pos) + ins.text + out.slice(ins.pos);
  }
  // Positions in `stack`/code state refer to `src`; all remaining edits
  // are pure suffix appends or suffix trims, applied to `out`. Mid-string
  // insertions above always sit before "](", never inside the tail we
  // trim, because emphasis inside a pending destination is not tracked.
  const appended = out.length - src.length;

  const endsAt = (pos: number): boolean => pos === src.length;

  // A trailing backslash cannot escape anything yet — drop it.
  if (out.endsWith("\\")) {
    let bs = 0;
    for (let k = out.length - 1; k >= 0 && out[k] === "\\"; k--) bs++;
    if (bs % 2 === 1) out = out.slice(0, -1);
  }

  if (codeOpenLen > 0) {
    if (endsAt(codeOpenPos + codeOpenLen)) {
      // "text `" — a code span with no content yet; hide the run.
      out = out.slice(0, codeOpenPos + appended);
    } else {
      out += "`".repeat(codeOpenLen);
    }
  }

  // Pending link?
  if (destStart >= 0) {
    if (destAngle) out += ">";
    out += ")";
  } else if (labelStart >= 0 && endsAt(labelStart)) {
    // "text [" — just-opened label with nothing after; hide the bracket.
    out = out.slice(0, labelStart - 1 + appended);
    if (out.endsWith("!")) out = out.slice(0, -1); // and its image bang
  }
  // A bare "[label" (content after the bracket) stays literal — linkhood
  // is unproven until "](", and the closed-mode parser renders it as-is.

  // Emphasis: strip just-opened trailing runs (an opener that is still
  // the last thing in the repaired text has no content to style yet),
  // close everything else.
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    if (out.endsWith(top.char.repeat(top.rem))) {
      out = out.slice(0, out.length - top.rem);
      stack.pop();
      continue;
    }
    break;
  }
  if (stack.length > 0) {
    // Insert closers before any trailing whitespace: "a *b " must become
    // "a *b* " (italic b), not "a *b *" (a literal, unmatched pair).
    let cut = out.length;
    while (cut > 0 && (out[cut - 1] === " " || out[cut - 1] === "\t")) cut--;
    let closers = "";
    for (let s = stack.length - 1; s >= 0; s--) closers += emphCloser(stack[s]!);
    out = out.slice(0, cut) + closers + out.slice(cut);
  }
  return out;
}
