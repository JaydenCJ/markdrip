/**
 * Minimal ambient declarations for the handful of Node.js built-ins this
 * project uses. Declaring them in-repo keeps `typescript` the only
 * devDependency (no `@types/node`); the surface below is intentionally
 * restricted to exactly what `src/` calls, so a typo against a real Node
 * API still fails to compile.
 */

declare module "node:fs" {
  export function readFileSync(path: string | number, encoding: "utf8"): string;
}

declare var process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode: number | undefined;
  exit(code?: number): never;
  stdout: {
    write(chunk: string): boolean;
    on(event: "error", listener: (err: Error & { code?: string }) => void): void;
    isTTY?: boolean;
    columns?: number;
  };
  stderr: { write(chunk: string): boolean };
  /** Typed as the post-setEncoding("utf8") shape: iteration yields strings. */
  stdin: AsyncIterable<string> & { setEncoding(enc: "utf8"): void };
};
