import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("src/styles.css", "utf8");
const svg = readFileSync("public/icons/icon.svg", "utf8");
const script = readFileSync("scripts/generate-icons.mjs", "utf8");
const html = readFileSync("index.html", "utf8");
const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));

test("deep blue palette is shared by controls and all iOS/PWA icon sources", () => {
  assert.match(css, /--accent:\s*#0866ff;/);
  assert.match(css, /--accent-ink:\s*#ffffff;/);
  assert.match(css, /--accent-readable:\s*#81b9ff;/);
  assert.match(svg, /fill="#0866FF"/);
  assert.match(svg, /fill="#FFFFFF"/);
  assert.match(script, /const ACCENT = \[8, 102, 255\]/);
  assert.match(script, /insidePlayTriangle\(sx, sy\)/);
  assert.match(html, /apple-touch-icon\.png\?v=deep-blue-20261123/);
  assert.ok(manifest.icons.every((icon) => icon.src.includes("?v=deep-blue-20261123")));
  assert.doesNotMatch(css + svg + script, /#65a7ff|#ff7a1a|\[101, 167, 255\]/i);
});
