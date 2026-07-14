/**
 * Argument parsing for the markdrip CLI. Deliberately tiny and strict:
 * unknown flags are usage errors (exit 2), `--` ends flag parsing, and at
 * most one positional (the input file) is accepted.
 */

export class UsageError extends Error {}

export interface CliOptions {
  file: string | null;
  width: number | null;
  color: boolean | null;
  mode: "live" | "append" | null;
  hyperlinks: boolean;
  showUrls: boolean;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    file: null,
    width: null,
    color: null,
    mode: null,
    hyperlinks: false,
    showUrls: false,
    help: false,
    version: false,
  };
  let positionalOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (positionalOnly || !arg.startsWith("-") || arg === "-") {
      if (opts.file !== null) throw new UsageError(`unexpected argument: ${arg}`);
      opts.file = arg;
      continue;
    }
    switch (arg) {
      case "--":
        positionalOnly = true;
        break;
      case "--width":
      case "-w": {
        const v = argv[++i];
        if (v === undefined) throw new UsageError(`${arg} requires a value`);
        const n = Number(v);
        if (!Number.isInteger(n) || n < 16 || n > 400) {
          throw new UsageError(`--width must be an integer in 16..400, got ${v}`);
        }
        opts.width = n;
        break;
      }
      case "--live":
        opts.mode = "live";
        break;
      case "--plain":
        opts.mode = "append";
        break;
      case "--color":
        opts.color = true;
        break;
      case "--no-color":
        opts.color = false;
        break;
      case "--hyperlinks":
        opts.hyperlinks = true;
        break;
      case "--show-urls":
        opts.showUrls = true;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      case "--version":
      case "-V":
        opts.version = true;
        break;
      default:
        throw new UsageError(`unknown option: ${arg}`);
    }
  }
  return opts;
}

export const USAGE = `markdrip — streaming markdown renderer for terminals

Usage:
  markdrip [options] [file]        render a file (or "-" for stdin)
  some-tool | markdrip [options]   render stdin as it streams

When reading a stream, finished blocks print immediately as stable lines;
the still-arriving tail is repaired mid-stream (unclosed **bold**, half-typed
links, open code fences) and, on a TTY, repainted in place.

Options:
  -w, --width <n>   wrap width in columns, 16..400
                    (default: terminal width, capped at 100; 80 when piped)
      --live        force in-place tail repaint (default on a TTY)
      --plain       force append-only output (default when piped)
      --color       force ANSI colors (default on a TTY, honors NO_COLOR)
      --no-color    disable ANSI colors
      --hyperlinks  emit OSC 8 terminal hyperlinks for links
      --show-urls   append each link's destination, dimmed
  -h, --help        show this help
  -V, --version     print the version

Exit codes: 0 success · 1 input file unreadable · 2 usage error
`;
