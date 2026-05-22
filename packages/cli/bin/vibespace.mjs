#!/usr/bin/env node
// vibespace CLI entry — dispatches <verb> <noun> to commands/*.mjs.
// Sole shape contract: every command's run(argv) returns a Promise<number>
// where the number is the exit code (0 ok, 1 business, 2 unreachable, 3 args).
import { run } from "../src/index.mjs";

run(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (err) => {
    // Last-line defence — commands should normally print structured errors and
    // return an exit code. If something escapes (unexpected throw), surface it
    // as exit 1 with the short code "internal_error" so AI callers can branch.
    process.stderr.write("error: internal_error\n");
    process.stderr.write((err && err.message) || String(err));
    process.stderr.write("\n");
    process.exit(1);
  },
);
