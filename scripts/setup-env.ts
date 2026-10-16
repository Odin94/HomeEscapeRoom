import { runSetup, terminalPrompt } from "./setup-env-lib";

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("Run pnpm run setup:env in an interactive terminal.");
  const terminal = terminalPrompt(process.stdin, process.stdout);
  try {
    await runSetup({ ask: terminal.ask, log: console.log });
  } finally {
    terminal.close();
  }
}

main().catch(() => {
  console.error(
    "Setup stopped. Completed answers are kept locally; run pnpm run setup:env to resume. Your active .env is unchanged unless saving completed.",
  );
  process.exitCode = 1;
});
