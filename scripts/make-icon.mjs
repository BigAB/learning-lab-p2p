// Rasterises public/icon.svg into the 180×180 apple-touch-icon iOS wants for a Home Screen web
// app (it ignores SVG icons). Run with `pnpm icon` after changing icon.svg and commit the PNG —
// this is a one-off generator, not part of the build.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const SIZE = 180;
const svg = readFileSync(new URL("../public/icon.svg", import.meta.url));
const out = fileURLToPath(new URL("../public/apple-touch-icon.png", import.meta.url));

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setViewportSize({ width: SIZE, height: SIZE });
  await page.setContent(
    `<body style="margin:0"><img src="data:image/svg+xml;base64,${svg.toString(
      "base64",
    )}" width="${SIZE}" height="${SIZE}" style="display:block"></body>`,
  );
  await page.screenshot({ path: out });
} finally {
  await browser.close();
}
console.log(`wrote ${out} (${SIZE}×${SIZE})`);
