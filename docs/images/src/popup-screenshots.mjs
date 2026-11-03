// Takes the README screenshots of the real popup (light and dark) in Edge or
// Chrome with the unpacked extension loaded. Lookups go to the real API; only
// the "Your IP address" answer is swapped for a documentation-range example
// (203.0.113.42, AS64500) so nobody's real address ends up in the README.
//
//   node docs/images/src/popup-screenshots.mjs [path to msedge/chrome]
//
// Writes docs/images/popup-{light,dark}.png at 2x. Needs a browser build that
// still honours --load-extension (Edge does; branded Chrome 137+ does not).
// Set BROWSER_PROFILE to use a given (empty) profile folder instead of a temp one.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const ext = path.join(root, "src");
const out = path.resolve(here, "..");
const browser = process.argv[2] || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const port = 9400 + Math.floor(Math.random() * 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EXAMPLE_ME = {
    ip: "203.0.113.42", isp: "Example Telecom", org: "Example Telecom", city: "Taipei", region: "Taiwan",
    country_code: "TW", country_name: "Taiwan", timezone_name: "Asia/Taipei", latitude: 25.0334,
    longitude: 121.566, asn_number: 64500, asn: "AS64500 - Example Telecom", success: true,
};

// Unpacked extension IDs come from the SHA-256 of the folder path.
function extensionId(dir) {
    let p = path.resolve(dir);
    let bytes = Buffer.from(p);
    if (process.platform === "win32") {
        p = p[0].toUpperCase() + p.slice(1);
        bytes = Buffer.from(p, "utf16le");
    }
    const hex = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
    return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

async function cdpConnect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pending = new Map();
    const handlers = [];
    ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.id && pending.has(msg.id)) {
            const { res, rej } = pending.get(msg.id);
            pending.delete(msg.id);
            msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
        } else if (msg.method) handlers.forEach((h) => h(msg));
    };
    const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
        pending.set(++id, { res, rej });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
    return { send, on: (h) => handlers.push(h) };
}

const ownProfile = !process.env.BROWSER_PROFILE;
const profile = process.env.BROWSER_PROFILE || mkdtempSync(path.join(tmpdir(), "ip-find-shots-"));
const proc = spawn(browser, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--load-extension=${ext}`, `--disable-extensions-except=${ext}`, "about:blank",
], { stdio: "ignore" });

try {
    let info;
    for (let i = 0; i < 100 && !info; i++) {
        try { info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(200); }
    }
    const cdp = await cdpConnect(info.webSocketDebuggerUrl);
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const s = (m, p) => cdp.send(m, p, sessionId);
    const evaluate = async (expression) => (await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;

    await s("Page.enable");
    await s("Fetch.enable", { patterns: [{ urlPattern: "https://json.geoiplookup.io/" }] });
    cdp.on((m) => {
        if (m.method !== "Fetch.requestPaused" || m.sessionId !== sessionId) return;
        s("Fetch.fulfillRequest", {
            requestId: m.params.requestId,
            responseCode: 200,
            responseHeaders: [
                { name: "content-type", value: "application/json" },
                { name: "access-control-allow-origin", value: "*" },
            ],
            body: Buffer.from(JSON.stringify(EXAMPLE_ME)).toString("base64"),
        });
    });

    const popup = `chrome-extension://${extensionId(ext)}/popup.html`;
    await s("Emulation.setDeviceMetricsOverride", { width: 380, height: 700, deviceScaleFactor: 2, mobile: false });
    await s("Page.navigate", { url: popup });
    await sleep(2500);
    // Fill the history with real lookups; 8.8.8.8 last so it is the result on screen.
    for (const ip of ["1.1.1.1", "2001:4860:4860::8888", "8.8.8.8"]) {
        await evaluate(`document.querySelector('#searchIP').value = ${JSON.stringify(ip)}; document.querySelector('#searchBtn').click()`);
        await sleep(2500);
    }

    for (const theme of ["light", "dark"]) {
        await evaluate(`localStorage.setItem('ipfind_theme', '${theme}')`);
        await s("Page.reload");
        await sleep(2500);
        await evaluate(`document.querySelector('#searchIP').value = '8.8.8.8'; document.querySelector('#searchBtn').click()`);
        await sleep(3000);
        await evaluate("document.activeElement.blur(); document.querySelector('#toast').classList.remove('show')");
        await sleep(400);
        const height = await evaluate("Math.ceil(document.querySelector('.app').getBoundingClientRect().bottom)");
        await s("Emulation.setDeviceMetricsOverride", { width: 380, height, deviceScaleFactor: 2, mobile: false });
        await sleep(300);
        const shot = await s("Page.captureScreenshot", { format: "png" });
        writeFileSync(path.join(out, `popup-${theme}.png`), Buffer.from(shot.data, "base64"));
        console.log(`popup-${theme}.png  380x${height} @2x`);
    }
    await cdp.send("Browser.close").catch(() => {});
} finally {
    await sleep(500);
    proc.kill();
    await sleep(500);
    if (ownProfile) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
