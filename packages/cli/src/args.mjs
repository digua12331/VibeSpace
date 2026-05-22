// Minimal arg parser — supports `--key value`, `--key=value`, `--flag` (bool),
// and positional args. Does NOT support short options (-x) or bundling (-xvf).
// `--` ends flag parsing; everything after is positional.

export function parseArgs(argv) {
  const positional = [];
  const flags = Object.create(null);
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i];
    if (tok === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      if (eq !== -1) {
        flags[tok.slice(2, eq)] = tok.slice(eq + 1);
        i += 1;
        continue;
      }
      const key = tok.slice(2);
      const next = argv[i + 1];
      // If the next token doesn't exist or itself looks like a flag, the
      // current key is a boolean flag (e.g. `--yes`).
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
        i += 1;
        continue;
      }
      flags[key] = next;
      i += 2;
      continue;
    }
    positional.push(tok);
    i += 1;
  }
  return { positional, flags };
}

/** Reject flags that are not in the allowed set. Returns true if all flags
 *  recognised, false (after writing the error) if any is unknown. */
export function assertKnownFlags(flags, allowed) {
  for (const key of Object.keys(flags)) {
    if (!allowed.includes(key)) {
      process.stderr.write(`error: invalid_args\nunknown flag --${key}\n`);
      return false;
    }
  }
  return true;
}
