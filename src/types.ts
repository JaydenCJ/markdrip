/**
 * Shared types for markdrip: the inline span model, the block model produced
 * by the incremental block parser, and the option bags accepted by the
 * renderer and the streaming engine.
 */

/** One styled run of text after inline parsing. Flat on purpose: the
 * renderer never needs a tree, only runs with resolved attributes. */
export interface InlineSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  /** Inline code span (`like this`); wins its own color, combines with bold/italic. */
  code?: boolean;
  /** De-emphasized text (used for appended URLs and structural chrome). */
  dim?: boolean;
  /** Link destination. Present on every span inside a link label. */
  href?: string;
  /** Hard line break: text is "\n" and every other field is unset. */
  hardBreak?: boolean;
}

/** Column alignment of one table column, from the delimiter row. */
export type Align = "left" | "center" | "right" | null;

interface BlockBase {
  /** Byte offset of the block's first line in the parsed source. */
  start: number;
  /** Byte offset just past the last consumed line (including its newline). */
  end: number;
  /**
   * True when no future input can change this block: its terminator was a
   * complete line (blank line, closing fence, a new block start) or the
   * parse ran with `atEnd`. Only closed blocks may be committed by the
   * streaming engine.
   */
  closed: boolean;
}

export interface ParagraphBlock extends BlockBase {
  kind: "paragraph";
  /** Logical text: soft-wrapped source lines joined with spaces, hard
   * breaks (trailing two spaces or backslash) encoded as "\n". */
  text: string;
}

export interface HeadingBlock extends BlockBase {
  kind: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  /** True when produced by a setext underline (`===` / `---`). */
  setext: boolean;
}

export interface FenceBlock extends BlockBase {
  kind: "fence";
  /** Info string after the opening fence (usually a language tag). */
  info: string;
  /** Complete (newline-terminated) code lines. */
  lines: string[];
  /** Trailing code line that has not received its newline yet, if any. */
  partial: string | null;
  /** True when this block continues a fence whose head was already
   * committed by the streaming engine; the header must not re-render. */
  cont: boolean;
  fenceChar: "`" | "~";
  fenceLen: number;
  indent: number;
  /** The opening fence line has its newline (the info string is final).
   * The streaming engine only commits the header once this is true. */
  headTerminated: boolean;
  /** Offset just past the opening fence line (for partial commits). */
  headEnd: number;
  /** Offset just past each entry of `lines` (for partial commits). */
  lineEnds: number[];
}

export interface QuoteBlock extends BlockBase {
  kind: "quote";
  children: Block[];
}

export interface ListItem {
  blocks: Block[];
  /** Task-list state: " " unchecked, "x" checked, null for plain items. */
  task: " " | "x" | null;
}

export interface ListBlock extends BlockBase {
  kind: "list";
  ordered: boolean;
  /** First ordinal for ordered lists (e.g. `3.` starts at 3). */
  startNo: number;
  items: ListItem[];
  /** Loose list: blank lines separated items or item paragraphs. */
  loose: boolean;
}

export interface HrBlock extends BlockBase {
  kind: "hr";
}

export interface TableBlock extends BlockBase {
  kind: "table";
  header: string[];
  align: Align[];
  rows: string[][];
}

export type Block =
  | ParagraphBlock
  | HeadingBlock
  | FenceBlock
  | QuoteBlock
  | ListBlock
  | HrBlock
  | TableBlock;

/** Continuation state for a fence whose earlier lines were committed. */
export interface FenceCont {
  fenceChar: "`" | "~";
  fenceLen: number;
  indent: number;
  info: string;
}

export interface ParseOptions {
  /** Treat the input as complete: the final block is finalized (unclosed
   * emphasis becomes literal, an open fence is closed as-is). */
  atEnd?: boolean;
  /** Resume parsing inside an open fence (streaming partial commits). */
  cont?: FenceCont | null;
}

/** Theme: SGR parameter strings (the part between `\x1b[` and `m`). An
 * empty string means "no styling for this role". */
export interface Theme {
  heading: [string, string, string, string, string, string];
  headingMarker: string;
  codeSpan: string;
  codeText: string;
  codeGutter: string;
  codeInfo: string;
  quoteBar: string;
  bullet: string;
  ordinal: string;
  taskDone: string;
  taskTodo: string;
  hr: string;
  link: string;
  url: string;
  tableBorder: string;
}

export interface RenderOptions {
  /** Wrap width in columns. Default 80. Code lines are never wrapped. */
  width?: number;
  /** Emit ANSI colors. Default true. */
  color?: boolean;
  /** Wrap link labels in OSC 8 hyperlink escapes. Default false. */
  hyperlinks?: boolean;
  /** Append the destination after each link label, dimmed. Default false. */
  showUrls?: boolean;
  /** Theme overrides, merged over the default theme. */
  theme?: Partial<Theme>;
}

export type StreamMode = "live" | "append";

export interface StreamOptions extends RenderOptions {
  /**
   * "append": emit only committed lines (safe for pipes and logs; the open
   * tail appears when `end()` finalizes it). "live": additionally repaint
   * the open tail in place using cursor movement. Default "append".
   */
  mode?: StreamMode;
}
