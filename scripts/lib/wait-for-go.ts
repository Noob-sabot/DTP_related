import { createInterface } from "readline";

export const DEFAULT_GO_COMMANDS = ["go", "start", "capture"];

export function isGoCommand(line: string, commands = DEFAULT_GO_COMMANDS): boolean {
  return commands.includes(line.trim().toLowerCase());
}

/** Wait until the user types go in the terminal running this script. */
export async function waitForGo(opts: {
  commands?: string[];
  prompt?: string;
} = {}): Promise<void> {
  const commands = opts.commands ?? DEFAULT_GO_COMMANDS;

  console.log("\n────────────────────────────────────────────────────────");
  if (opts.prompt) {
    console.log(`  ${opts.prompt.split("\n").join("\n  ")}`);
  } else {
    console.log("  Position the map, then type go in this terminal and press Enter.");
  }
  console.log("────────────────────────────────────────────────────────\n");

  if (!process.stdin.isTTY) {
    throw new Error(
      "stdin is not a terminal — run this script directly in a terminal window so you can type go."
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    const finish = () => {
      console.log("\n  Go received — continuing...\n");
      rl.close();
      resolve();
    };

    rl.on("line", (line) => {
      if (isGoCommand(line, commands)) finish();
      else console.log(`  Type "${commands[0]}" and press Enter when ready.`);
    });
  });
}
