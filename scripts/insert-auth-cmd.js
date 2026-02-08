// Helper script to insert runAuthCommand into cli.ts
const fs = require('fs');

const cli = fs.readFileSync('packages/nella/src/cli.ts', 'utf-8');

const searchStr = `  }
}

async function runConnectCommand(args: CliArgs): Promise<void> {
  console.log(logo);
  console.log(tagline);

  const serverUrl = args.serverUrl || "https://mcp.getnella.dev/mcp";\`;

if (!cli.includes(searchStr)) {
  console.error('ERROR: search string not found in cli.ts');
  process.exit(1);
}

const authCommandBlock = `  }
}

// =============================================================================
// Auth Command
// =============================================================================

async function runAuthCommand(args: CliArgs): Promise<void> {
  console.log(logo);
  console.log(tagline);

  const sub = args.authSubcommand;

  if (!sub) {
    console.log(\`  \${theme.secondary.bold("Usage:")}\\n\`);
    console.log(\`    \${theme.muted("$")} \${theme.primary("nella auth login")}    \${theme.muted("Log in with your Nella account")}\`);
    console.log(\`    \${theme.muted("$")} \${theme.primary("nella auth logout")}   \${theme.muted("Clear stored credentials")}\`);
    console.log(\`    \${theme.muted("$")} \${theme.primary("nella auth status")}   \${theme.muted("Show current login state")}\`);
    console.log("");
    return;
  }

  if (sub === "login") {
    console.log(\`  \${theme.icons.info}  \${theme.bold("Log in to Nella")}\\n\`);
    console.log(\`  \${theme.muted("Enter your account credentials from")} \${theme.secondary("app.getnella.dev")}\\n\`);

    const result = await login();

    if (result.success) {
      console.log(\`\\n  \${theme.icons.success}  \${theme.success.bold("Logged in")} as \${theme.secondary(result.email!)}\`);
      console.log(\`  \${theme.muted("   Session saved to ~/.nella/auth.json")}\\n\`);
      console.log(\`  \${theme.muted("Next:")} \${theme.secondary("nella connect")} to configure your MCP clients\\n\`);
    } else {
      console.log(\`\\n  \${theme.icons.error}  \${theme.error.bold("Login failed:")} \${result.error}\\n\`);
      process.exit(1);
    }
    return;
  }

  if (sub === "logout") {
    clearSession();
    console.log(\`  \${theme.icons.success}  \${theme.success("Logged out")} \\u2014 credentials removed\\n\`);
    return;
  }

  if (sub === "status") {
    const session = await getValidSession();
    if (session) {
      console.log(\`  \${theme.icons.success}  \${theme.success.bold("Authenticated")}\\n\`);
      console.log(\`  \${theme.muted("Email:")}   \${theme.secondary(session.user.email)}\`);
      console.log(\`  \${theme.muted("User ID:")} \${theme.dim(session.user.id)}\`);
      const exp = new Date(session.expires_at * 1000);
      console.log(\`  \${theme.muted("Expires:")} \${theme.dim(exp.toLocaleString())}\`);
    } else {
      console.log(\`  \${theme.icons.warning}  \${theme.warning("Not logged in")}\`);
      console.log(\`\\n  \${theme.muted("Run")} \${theme.secondary("nella auth login")} \${theme.muted("to authenticate")}\`);
    }
    console.log("");
    return;
  }
}

async function runConnectCommand(args: CliArgs): Promise<void> {
  console.log(logo);
  console.log(tagline);

  const serverUrl = args.serverUrl || "https://mcp.getnella.dev/mcp";\`;

const updated = cli.replace(searchStr, authCommandBlock);
fs.writeFileSync('packages/nella/src/cli.ts', updated);
console.log('OK - runAuthCommand inserted successfully');
console.log('File size:', updated.length, 'chars');
