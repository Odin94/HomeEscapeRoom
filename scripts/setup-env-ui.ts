import * as p from "@clack/prompts";
import type { Readable, Writable } from "node:stream";
import type { Choose } from "./setup-env-lib";

function accepted(value: string | symbol): string {
  if (p.isCancel(value)) throw new Error("Setup cancelled");
  return value as string;
}

export function terminalPrompt(input: Readable, output: Writable) {
  const io = { input, output };
  return {
    async ask(message: string, secret = false) {
      return accepted(
        secret
          ? await p.password({ ...io, message, mask: "*" })
          : await p.text({
              ...io,
              message,
              placeholder: "Enter keeps the current value",
            }),
      );
    },
    choose: (async (message, options, initialValue, searchable = false) => {
      return accepted(
        await (searchable ? p.autocomplete : p.select)({
          ...io,
          message,
          options,
          initialValue,
          maxItems: 8,
        }),
      );
    }) satisfies Choose,
    log: (message: string) => p.log.info(message.trim(), io),
    intro: () => p.intro("Threshold · Environment setup", io),
    outro: () => p.outro("Setup complete", io),
    loading(message: string) {
      const spinner = p.spinner(io);
      spinner.start(message);
      return (result: string) => spinner.stop(result);
    },
  };
}
