import {
    lookupUrl,
    isIPv6,
    isValidIP,
    formatLocation,
    ispName,
    formatNetwork,
    formatTimezone,
    formatCoords,
    hasLookupData,
    historyEntry,
    addHistoryEntry,
    escapeHTML,
} from "./lookup.js";

const HISTORY_KEY = "ipfind_history";
const THEME_KEY = "ipfind_theme";
const HISTORY_LIMIT = 6;
const LOOKUP_TIMEOUT_MS = 10000;

const $ = (sel) => document.querySelector(sel);

document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    setupEventListeners();
    fetchUserIP();
    renderHistory();
});

/* ---------- Theme ---------- */

function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = saved || (prefersDark ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(THEME_KEY, next);
}

/* ---------- Event listeners ---------- */

function setupEventListeners() {
    $("#copyBtn").addEventListener("click", () => copyToClipboard($("#myIP").dataset.ip));
    $("#reloadBtn").addEventListener("click", () => {
        $("#reloadBtn").classList.add("spinning");
        fetchUserIP();
    });
    $("#searchBtn").addEventListener("click", searchIP);
    $("#searchIP").addEventListener("keydown", (e) => {
        if (e.key === "Enter") searchIP();
    });
    // Clear the red outline once the user edits the address, not on the
    // same keypress that just flagged it.
    $("#searchIP").addEventListener("input", () => $("#searchIP").classList.remove("is-error"));
    $("#themeToggle").addEventListener("click", toggleTheme);
    $("#pasteBtn").addEventListener("click", pasteFromClipboard);
    $("#useMyIpBtn").addEventListener("click", () => {
        const ip = $("#myIP").dataset.ip;
        if (!ip) {
            showToast("Your IP is still loading", "error");
            return;
        }
        $("#searchIP").value = ip;
        searchIP();
    });
    $("#clearHistoryBtn").addEventListener("click", clearHistory);
}

/* ---------- API ---------- */

async function lookup(ip) {
    const res = await fetch(lookupUrl(ip), { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// Each lookup gets a number; an answer that arrives after a newer request
// was started is dropped instead of overwriting the newer one.
let myIpRequest = 0;
let searchRequest = 0;

/* ---------- My IP ---------- */

async function fetchUserIP() {
    const req = ++myIpRequest;
    const ipEl = $("#myIP");
    ipEl.innerHTML = '<div class="skeleton skeleton-ip"></div>';
    ipEl.dataset.ip = "";
    setMyInfo({ location: "—", isp: "—", timezone: "—" });

    try {
        const data = await lookup();
        if (req !== myIpRequest) return;
        renderMyIP(data);
    } catch (err) {
        if (req !== myIpRequest) return;
        console.error("Error fetching IP:", err);
        ipEl.textContent = "Unavailable";
        showToast(err.name === "TimeoutError" ? "geoiplookup.io didn't answer" : "Couldn't fetch your IP", "error");
    } finally {
        setTimeout(() => $("#reloadBtn").classList.remove("spinning"), 600);
    }
}

function renderMyIP(data) {
    const ipEl = $("#myIP");
    ipEl.textContent = data.ip || "Unknown";
    ipEl.dataset.ip = data.ip || "";
    ipEl.classList.toggle("is-ipv6", isIPv6(data.ip));

    setMyInfo({
        location: formatLocation(data) || "Unknown location",
        isp: ispName(data) || "Unknown ISP",
        timezone: formatTimezone(data) || "Unknown timezone",
    });
}

function setMyInfo({ location, isp, timezone }) {
    const grid = $("#myInfo");
    grid.querySelector('[data-field="location"]').textContent = location;
    grid.querySelector('[data-field="isp"]').textContent = isp;
    grid.querySelector('[data-field="timezone"]').textContent = timezone;
}

/* ---------- Search ---------- */

async function searchIP() {
    const input = $("#searchIP");
    const ip = input.value.trim();

    if (!ip) {
        input.classList.add("is-error");
        showToast("Enter an IP first", "error");
        return;
    }

    if (!isValidIP(ip)) {
        input.classList.add("is-error");
        showToast("Invalid IP format", "error");
        return;
    }

    input.classList.remove("is-error");
    const req = ++searchRequest;
    const result = $("#searchResult");
    result.classList.remove("hidden");
    result.innerHTML = '<div class="skeleton skeleton-ip"></div>';

    try {
        const data = await lookup(ip);
        if (req !== searchRequest) return;
        renderResult({ ...data, ip: data.ip || ip });
        // Private and reserved addresses come back with success: false and
        // no details; there is nothing worth keeping in the history.
        if (hasLookupData(data)) addToHistory(data);
    } catch (err) {
        if (req !== searchRequest) return;
        console.error("Error fetching IP details:", err);
        const timedOut = err.name === "TimeoutError";
        result.innerHTML = `<dl class="dl"><dt>Error</dt><dd class="muted">${
            timedOut ? "geoiplookup.io didn't answer in time. Please try again." : "Lookup failed. Please try again."
        }</dd></dl>`;
        showToast(timedOut ? "Lookup timed out" : "Lookup failed", "error");
    }
}

function renderResult(data) {
    const ip = data.ip || "";
    const code = (data.country_code || "").toUpperCase();
    const ipClass = isIPv6(ip) ? "result-ip is-ipv6" : "result-ip";

    const locText = formatLocation(data);
    const networkText = formatNetwork(data);
    const tzText = formatTimezone(data);
    const coords = formatCoords(data);

    const rows = [];
    if (locText) rows.push(row("Location", escapeHTML(locText)));
    if (networkText) rows.push(row("Network", escapeHTML(networkText)));
    if (tzText) rows.push(row("Timezone", escapeHTML(tzText)));
    if (coords) {
        rows.push(row(
            "Coords",
            `<a href="${escapeHTML(coords.mapUrl)}" target="_blank" rel="noopener"><span class="mono">${escapeHTML(coords.text)}</span></a>`
        ));
    }
    if (data.postal_code) rows.push(row("Postal", `<span class="mono">${escapeHTML(data.postal_code)}</span>`));

    let body;
    if (!hasLookupData(data)) {
        body = `<div class="dl"><dd class="muted">No location data. Private and reserved ranges (192.168.x.x, 10.x.x.x, ::1, …) aren't on the public map.</dd></div>`;
    } else if (rows.length) {
        body = `<dl class="dl">${rows.join("")}</dl>`;
    } else {
        body = `<div class="dl"><dd class="muted">No additional information available for this IP.</dd></div>`;
    }

    const badge = code ? `<span class="result-badge">${escapeHTML(code)}</span>` : "";

    $("#searchResult").innerHTML = `
        <div class="result-header">
            <span class="${ipClass}">${escapeHTML(ip)}</span>
            ${badge}
            <button class="icon-btn" id="copyResultBtn" title="Copy IP">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
            </button>
        </div>
        ${body}
    `;

    $("#copyResultBtn").addEventListener("click", () => copyToClipboard(ip));
}

function row(label, valueHTML) {
    return `<dt>${escapeHTML(label)}</dt><dd>${valueHTML}</dd>`;
}

/* ---------- History ---------- */

function addToHistory(data) {
    if (!data.ip) return;
    const list = addHistoryEntry(getHistory(), historyEntry(data), HISTORY_LIMIT);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    renderHistory();
}

function getHistory() {
    try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch {
        return [];
    }
}

function renderHistory() {
    const items = getHistory();
    const wrap = $("#historyWrap");
    const list = $("#history");

    if (items.length === 0) {
        wrap.classList.add("hidden");
        return;
    }

    wrap.classList.remove("hidden");
    list.innerHTML = items
        .map((h) => {
            const code = (h.country_code || "").toUpperCase();
            const badge = code ? escapeHTML(code) : "??";
            const loc = [h.city, h.country_name].filter(Boolean).join(", ") || "Unknown";
            return `<div class="history-item" data-ip="${escapeHTML(h.ip)}">
                <span class="history-flag">${badge}</span>
                <span class="history-ip">${escapeHTML(h.ip)}</span>
                <span class="history-loc">${escapeHTML(loc)}</span>
            </div>`;
        })
        .join("");

    list.querySelectorAll(".history-item").forEach((el) => {
        el.addEventListener("click", () => {
            $("#searchIP").value = el.dataset.ip;
            searchIP();
        });
    });
}

function clearHistory() {
    if (getHistory().length === 0) {
        showToast("No history to clear");
        return;
    }
    localStorage.removeItem(HISTORY_KEY);
    $("#searchResult").classList.add("hidden");
    renderHistory();
    showToast("History cleared");
}

/* ---------- Clipboard ---------- */

async function copyToClipboard(text) {
    if (!text) {
        showToast("Nothing to copy", "error");
        return;
    }
    try {
        await navigator.clipboard.writeText(text);
        showToast("Copied to clipboard", "success");
    } catch (err) {
        console.error("Copy failed:", err);
        showToast("Copy failed", "error");
    }
}

async function pasteFromClipboard() {
    try {
        const text = (await navigator.clipboard.readText()).trim();
        if (!text) {
            showToast("Clipboard is empty", "error");
            return;
        }
        $("#searchIP").value = text;
        $("#searchIP").classList.remove("is-error");
        $("#searchIP").focus();
    } catch (err) {
        console.error("Paste failed:", err);
        showToast("Paste blocked by browser", "error");
    }
}

/* ---------- Toast ---------- */

let toastTimer = null;
function showToast(msg, kind = "") {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast show" + (kind ? " is-" + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1600);
}
