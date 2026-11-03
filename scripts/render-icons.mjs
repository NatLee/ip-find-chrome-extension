// Renders assets/icon.svg into every PNG that src/manifest.json lists (under
// "icons" and "action.default_icon"), each at the size its key names. The
// manifest is the only list of sizes and file names.
//
//   node scripts/render-icons.mjs
//
// Browser selection and settings: see scripts/lib/browser.mjs.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./lib/browser.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(root, "assets", "icon.svg");
const srcDir = path.join(root, "src");
const manifest = JSON.parse(readFileSync(path.join(srcDir, "manifest.json"), "utf8"));

const targets = new Map(); // file -> size in px
for (const map of [manifest.icons, manifest.action?.default_icon]) {
    for (const [size, file] of Object.entries(map || {})) targets.set(file, Number(size));
}
const svg = readFileSync(SOURCE).toString("base64");
const largest = Math.max(...targets.values());

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    await page.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    await page.send("Emulation.setDeviceMetricsOverride", { width: largest, height: largest, deviceScaleFactor: 1, mobile: false });
    for (const [file, size] of targets) {
        await page.evaluate(`new Promise((resolve, reject) => {
            document.body.style.margin = "0";
            const img = new Image(${size}, ${size});
            img.style.display = "block";
            img.onload = resolve;
            img.onerror = reject;
            img.src = "data:image/svg+xml;base64,${svg}";
            document.body.replaceChildren(img);
        })`);
        await page.settle();
        writeFileSync(path.join(srcDir, file), await page.screenshot({ x: 0, y: 0, width: size, height: size }));
        console.log(`${file}  ${size}x${size}`);
    }
} finally {
    await browser.close();
}
