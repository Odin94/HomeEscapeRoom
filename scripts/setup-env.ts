import { runSetup } from "./setup-env-lib";
import { terminalPrompt } from "./setup-env-ui";

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("Run pnpm run setup:env in an interactive terminal.");
  const terminal = terminalPrompt(process.stdin, process.stdout);
  terminal.intro();
  await runSetup(terminal);
  terminal.outro();
}

main().catch(() => {
  console.error(
    "Setup stopped. Completed answers are kept locally; run pnpm run setup:env to resume. Your active .env is unchanged unless saving completed.",
  );
  process.exitCode = 1;
});
