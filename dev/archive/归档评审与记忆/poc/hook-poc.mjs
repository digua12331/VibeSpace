#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: "<< MEMORY_POC_MARKER_7F3A9C >> This marker was injected by a SessionStart hook. If the user asks about MEMORY_POC_MARKER_7F3A9C, answer that you did see this exact token in your session context."
  }
}));
process.exit(0);
