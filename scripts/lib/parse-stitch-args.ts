import type { StitchAlignOptions, WriteStitchOptions } from "./stitch-two.js";

export interface StitchCliArgs {
  left: string;
  right: string;
  out?: string;
  preview: boolean;
  force: boolean;
  align: StitchAlignOptions;
}

export function parseStitchArgs(argv: string[]): StitchCliArgs {
  const positional: string[] = [];
  const align: StitchAlignOptions = {};
  let preview = false;
  let force = false;
  let alpha = 0.45;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--preview") preview = true;
    else if (arg === "--force") force = true;
    else if (arg === "--pan") align.pan = Number(argv[++i]);
    else if (arg === "--dy") align.dy = Number(argv[++i]);
    else if (arg === "--alpha") alpha = Number(argv[++i]);
    else if (!arg.startsWith("-")) positional.push(arg);
  }

  align.alpha = alpha;
  const [left, right, out] = positional;
  if (!left || !right) {
    throw new Error(
      "Usage: stitch-two|stitch-preview <left.png> <right.png> [out.png] [--pan N] [--dy N] [--alpha 0.45] [--preview] [--force]"
    );
  }

  return { left, right, out, preview, force, align };
}

export function writeOptions(args: StitchCliArgs): WriteStitchOptions {
  const hasAlign = args.align.pan !== undefined || args.align.dy !== undefined;
  return {
    force: args.force,
    align: hasAlign ? { pan: args.align.pan, dy: args.align.dy } : undefined,
  };
}
