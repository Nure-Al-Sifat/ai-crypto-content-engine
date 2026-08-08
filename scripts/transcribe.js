import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Full video → text. Wrapper so you can run:
 *   npm run transcript -- <youtube_url_or_id>
 *   node scripts/transcribe.js <youtube_url_or_id>
 */
const url = process.argv[2];
if (!url) {
  console.error("usage: npm run transcript -- <youtube_url_or_id>");
  process.exit(1);
}

const venvPy = path.join(process.cwd(), ".venv", "bin", "python");
const py = existsSync(venvPy) ? venvPy : "python3";
const script = path.join(process.cwd(), "analysis", "transcribe.py");

const child = spawn(py, [script, url], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
