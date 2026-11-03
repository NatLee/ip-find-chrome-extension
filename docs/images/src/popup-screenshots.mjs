// Takes the README screenshots of the real popup (light and dark) with the
// unpacked extension loaded. Lookups go to the real API; only the "Your IP
// address" answer is swapped for a documentation-range example (EXAMPLE_ME)
// so nobody's real address ends up in the README.
//
//   node docs/images/src/popup-screenshots.mjs
//
// Writes docs/images/popup-{light,dark}.png at SCALE. Browser selection and
// settings: see scripts/lib/browser.mjs.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "../../../scripts/lib/browser.mjs";
import { API_BASE } from "../../../src/lookup.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ext = path.resolve(here, "../../../src");
const out = path.resolve(here, "..");
const SCALE = 2;
const THEMES = ["light", "dark"];
// Looked up in this order, so the last one is the result on screen.
const LOOKUPS = ["1.1.1.1", "2001:4860:4860::8888", "8.8.8.8"];
const EXAMPLE_ME = {
    ip: "203.0.113.42", isp: "Example Telecom", org: "Example Telecom", city: "Taipei", region: "Taiwan",
    country_code: "TW", country_name: "Taiwan", timezone_name: "Asia/Taipei", latitude: 25.0334,
    longitude: 121.566, asn_number: 64500, asn: "AS64500 - Example Telecom", success: true,
};

const browser = await launchBrowser();
try {
    const id = await browser.loadExtension(ext);
    const page = await browser.newPage();
    // Answer the "my IP" request (the bare API_BASE) with EXAMPLE_ME.
    await page.send("Fetch.enable", { patterns: [{ urlPattern: API_BASE }] });
    browser.on((m) => {
        if (m.method !== "Fetch.requestPaused" || m.sessionId !== page.sessionId) return;
        page.send("Fetch.fulfillRequest", {
            requestId: m.params.requestId,
            responseCode: 200,
            responseHeaders: [
                { name: "content-type", value: "application/json" },
                { name: "access-control-allow-origin", value: "*" },
            ],
            body: Buffer.from(JSON.stringify(EXAMPLE_ME)).toString("base64"),
        });
    });
    const search = async (ip) => {
        await page.evaluate(`document.querySelector('#searchIP').value = ${JSON.stringify(ip)}; document.querySelector('#searchBtn').click()`);
        await page.waitFor(`document.querySelector('.result-ip')?.textContent === ${JSON.stringify(ip)}`, { what: `the result for ${ip}` });
    };
    const myIpShown = `document.querySelector('#myIP').dataset.ip === ${JSON.stringify(EXAMPLE_ME.ip)}`;

    await page.goto(`chrome-extension://${id}/popup.html`);
    await page.waitFor(myIpShown, { what: "the example IP" });
    for (const ip of LOOKUPS) await search(ip);

    for (const theme of THEMES) {
        await page.evaluate(`localStorage.setItem('ipfind_theme', '${theme}')`);
        await page.goto(`chrome-extension://${id}/popup.html`);
        await page.waitFor(myIpShown, { what: "the example IP" });
        await search(LOOKUPS.at(-1));
        await page.waitFor(`document.querySelectorAll('.history-item').length === ${LOOKUPS.length}`, { what: "the history" });
        await page.evaluate("document.activeElement.blur(); document.querySelector('#toast').classList.remove('show')");
        await page.waitFor("getComputedStyle(document.querySelector('#toast')).opacity === '0'", { what: "the toast to fade" });
        // The popup's width comes from its CSS; the height from its content.
        const size = await page.evaluate("(() => { const r = document.querySelector('.app').getBoundingClientRect(); return { width: Math.ceil(document.body.getBoundingClientRect().width), height: Math.ceil(r.bottom) }; })()");
        await page.send("Emulation.setDeviceMetricsOverride", { ...size, deviceScaleFactor: SCALE, mobile: false });
        await page.settle();
        writeFileSync(path.join(out, `popup-${theme}.png`), await page.screenshot());
        console.log(`popup-${theme}.png  ${size.width}x${size.height} @${SCALE}x`);
    }
} finally {
    await browser.close();
}
