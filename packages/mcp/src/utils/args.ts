/**
 * Command line argument parsing for Nella MCP server
 */

export interface ParsedArgs {
  workspace?: string;
  help: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      result.help = true;
    } else if (arg === "-w" || arg === "--workspace") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        result.workspace = next;
        i++;
      }
    } else if (arg.startsWith("--workspace=")) {
      result.workspace = arg.slice("--workspace=".length);
    }
  }

  return result;
}
