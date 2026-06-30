import { join } from "path";
import { writeStitchTwo } from "./lib/stitch-two.js";
import { parseStitchArgs, writeOptions } from "./lib/parse-stitch-args.js";

const args = parseStitchArgs(process.argv.slice(2));
const outPath = args.out ?? join(dirname(args.left), "stitched-two.png");

writeStitchTwo(args.left, args.right, outPath, writeOptions(args))
  .then((r) => {
    console.log(`\nDone: ${outPath} (${r.width}×${r.height}px)`);
  })
  .catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(0, i) : ".";
}
