import { join } from "path";
import { guessAlignment, writeAlignPreview } from "./lib/stitch-two.js";
import { parseStitchArgs } from "./lib/parse-stitch-args.js";

const args = parseStitchArgs(process.argv.slice(2));
const outPath =
  args.out ?? join(dirname(args.left), "align-preview.png");

const guess = await guessAlignment(args.left, args.right);
const pan = args.align.pan ?? guess.pan;
const dy = args.align.dy ?? guess.dy;

const result = await writeAlignPreview(args.left, args.right, outPath, {
  pan,
  dy,
  alpha: args.align.alpha,
});

console.log(`\nAlign preview: ${outPath} (${result.width}×${result.height}px)`);
console.log(`  right layer at pan=${pan}px  dy=${dy}px  alpha=${args.align.alpha}`);
console.log(`  auto guess: pan=${guess.pan} dy=${guess.dy} score=${guess.score.toFixed(3)} confident=${guess.confident}`);
console.log(`  ${guess.note}`);
console.log(
  "\nAdjust until rows line up, then:\n" +
    `  npm run stitch:two -- ${args.left} ${args.right} stitched-two.png --pan ${pan} --dy ${dy}`
);

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(0, i) : ".";
}
