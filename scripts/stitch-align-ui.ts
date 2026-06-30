import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { readFileSync, existsSync, appendFileSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import {
  guessAlignment,
  microSnapTranslate,
  writeStitchTwo,
} from "./lib/stitch-two.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_HTML = join(__dirname, "stitch-align-ui", "index.html");
const PORT = Number(process.env.STITCH_ALIGN_PORT ?? 3847);

/** Max dy nudge on try-snap (pan is locked to your placement). */
const TRY_SNAP_MAX_DY = 8;
const SCORE_IMPROVE_MIN = 0.002;

function parseArgs(argv: string[]) {
  const positional = argv.filter((a) => !a.startsWith("-"));
  const outFlag = argv.find((a, i) => argv[i - 1] === "--out");
  return {
    left: positional[0],
    right: positional[1],
    out: outFlag,
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

interface SnapLogEntry {
  ts: string;
  source: string;
  userPan: number;
  userDy: number;
  suggestedPan: number;
  suggestedDy: number;
  deltaPan: number;
  deltaDy: number;
  score: number;
  applied: boolean;
  reason?: string;
}

function appendSnapLog(logPath: string, entry: SnapLogEntry) {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
  console.log(
    `[align] ${entry.source} user pan=${entry.userPan} dy=${entry.userDy} → ` +
      `suggested pan=${entry.suggestedPan} dy=${entry.suggestedDy} ` +
      `(Δpan=${entry.deltaPan} Δdy=${entry.deltaDy}) applied=${entry.applied}` +
      (entry.reason ? ` — ${entry.reason}` : "")
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pilotDir = join(
    dirname(__dirname),
    "exports/dtp-accessibility-journey-maps/stitch-pilot"
  );
  const leftPath = resolve(args.left ?? join(pilotDir, "left.png"));
  const rightPath = resolve(args.right ?? join(pilotDir, "right.png"));
  const outPath = resolve(args.out ?? join(dirname(leftPath), "stitched-two.png"));
  const logPath = join(dirname(leftPath), "align-snap-log.jsonl");

  if (!existsSync(leftPath) || !existsSync(rightPath)) {
    console.error(`Missing captures:\n  ${leftPath}\n  ${rightPath}`);
    console.error("\nRun: npm run capture:two");
    process.exit(1);
  }

  const guess = await guessAlignment(leftPath, rightPath);
  const sharp = (await import("sharp")).default;
  const meta = await sharp(leftPath).metadata();
  const tileWidth = meta.width ?? 1920;
  const tileHeight = meta.height ?? 1080;

  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";

    try {
      if (req.method === "GET" && url === "/") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(readFileSync(UI_HTML));
        return;
      }

      if (req.method === "GET" && url === "/api/meta") {
        sendJson(res, 200, {
          tileWidth,
          tileHeight,
          origin: 300,
          artboardScale: 20,
          guess: { pan: guess.pan, dy: guess.dy, score: guess.score },
          outPath,
          logPath,
        });
        return;
      }

      if (req.method === "GET" && url === "/images/left.png") {
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(readFileSync(leftPath));
        return;
      }

      if (req.method === "GET" && url === "/images/right.png") {
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(readFileSync(rightPath));
        return;
      }

      if (req.method === "POST" && url === "/api/snap") {
        const body = JSON.parse(await readBody(req)) as {
          mode?: "guess" | "refine";
          pan?: number;
          dy?: number;
          source?: string;
        };
        const userPan = Math.round(body.pan ?? 0);
        const userDy = Math.round(body.dy ?? 0);
        const source = body.source ?? "snap";

        const snap = await microSnapTranslate(
          leftPath,
          rightPath,
          userPan,
          userDy,
          TRY_SNAP_MAX_DY
        );

        const deltaPan = snap.pan - userPan;
        const deltaDy = snap.dy - userDy;
        const applied = snap.improved && deltaPan === 0 && Math.abs(deltaDy) <= TRY_SNAP_MAX_DY;

        const entry: SnapLogEntry = {
          ts: new Date().toISOString(),
          source,
          userPan,
          userDy,
          suggestedPan: snap.pan,
          suggestedDy: snap.dy,
          deltaPan,
          deltaDy,
          score: snap.score,
          applied,
          reason: !applied
            ? snap.improved
              ? "rejected: unexpected pan change"
              : `no score improvement at pan=${userPan} (userScore=${snap.userScore.toFixed(4)}, best=${snap.score.toFixed(4)})`
            : undefined,
        };
        appendSnapLog(logPath, entry);

        sendJson(res, 200, {
          pan: snap.pan,
          dy: snap.dy,
          score: snap.score,
          userScore: snap.userScore,
          suggestedPan: snap.pan,
          suggestedDy: snap.dy,
          userPan,
          userDy,
          deltaPan,
          deltaDy,
          applied,
          panLocked: true,
          logPath,
          reason: entry.reason,
        });
        return;
      }

      if (req.method === "POST" && url === "/api/placement") {
        const body = JSON.parse(await readBody(req)) as {
          pan: number;
          dy: number;
          source?: string;
          note?: string;
        };
        const entry = {
          ts: new Date().toISOString(),
          source: body.source ?? "user-placement",
          userPan: Math.round(body.pan),
          userDy: Math.round(body.dy),
          note: body.note,
        };
        appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
        sendJson(res, 200, { ok: true, logPath });
        return;
      }

      if (req.method === "POST" && url === "/api/stitch") {
        const body = JSON.parse(await readBody(req)) as { pan: number; dy: number };
        appendSnapLog(logPath, {
          ts: new Date().toISOString(),
          source: "save-stitch",
          userPan: Math.round(body.pan),
          userDy: Math.round(body.dy),
          suggestedPan: Math.round(body.pan),
          suggestedDy: Math.round(body.dy),
          deltaPan: 0,
          deltaDy: 0,
          score: 1,
          applied: true,
        });
        const result = await writeStitchTwo(leftPath, rightPath, outPath, {
          align: { pan: body.pan, dy: body.dy },
          force: true,
        });
        sendJson(res, 200, {
          path: outPath,
          width: result.width,
          height: result.height,
          pan: body.pan,
          dy: body.dy,
        });
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: message });
    }
  });

  server.listen(PORT, () => {
    const link = `http://127.0.0.1:${PORT}`;
    console.log(`Stitch align UI: ${link}`);
    console.log(`  Left:  ${leftPath}`);
    console.log(`  Right: ${rightPath}`);
    console.log(`  Out:   ${outPath}`);
    console.log(`  Log:   ${logPath}`);
    console.log("\nDrag the right image, release to auto-snap when close, or use Try snap / Undo snap.");
    try {
      execSync(`open "${link}"`);
    } catch {
      console.log(`Open in browser: ${link}`);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
