// Pure helpers for IP Find: input validation, the lookup URL, and turning a
// geoiplookup.io response into the text the popup shows. Nothing in here
// touches the DOM or the network, so it can be unit-tested in Node.

export const API_BASE = "https://json.geoiplookup.io/";

/**
 * URL for looking up `ip`, or the caller's own IP when `ip` is empty.
 * The address goes in the path: geoiplookup.io ignores an `?ip=` query and
 * answers with the caller's own IP instead.
 */
export function lookupUrl(ip) {
    return ip ? API_BASE + encodeURIComponent(ip) : API_BASE;
}

/* ---------- Validation ---------- */

export function isIPv4(ip) {
    if (!ip) return false;
    const re = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/;
    return re.test(ip);
}

export function isIPv6(ip) {
    if (!ip) return false;
    // Permissive IPv6 check (full + compressed + IPv4-mapped)
    const re = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
    return re.test(ip);
}

export function isValidIP(ip) {
    return isIPv4(ip) || isIPv6(ip);
}

/* ---------- Formatting a lookup response ---------- */

/** "City, Region, Country", or "" when the response has none of them. */
export function formatLocation(data) {
    return [data.city || data.district, data.region, data.country_name].filter(Boolean).join(", ");
}

export function ispName(data) {
    return data.isp || data.org || data.asn_org || "";
}

/** "ISP · AS1234" (either half may be missing). */
export function formatNetwork(data) {
    const isp = ispName(data);
    const asnRaw = data.asn ? String(data.asn).trim() : "";
    const asn = asnRaw ? (/^AS/i.test(asnRaw) ? asnRaw : `AS${asnRaw}`) : "";
    if (isp && asn) return `${isp} · ${asn}`;
    return isp || asn;
}

export function formatTime(iso) {
    try {
        const d = new Date(iso);
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
        return "";
    }
}

/** "Asia/Taipei · 21:30", or just the zone name, or "". */
export function formatTimezone(data) {
    let tz = data.timezone_name || "";
    if (tz && data.current_time) {
        const t = formatTime(data.current_time);
        if (t) tz += ` · ${t}`;
    }
    return tz;
}

/** Coordinates as text plus a Google Maps link, or null when unknown (0,0 counts as unknown). */
export function formatCoords(data) {
    const lat = parseFloat(data.latitude);
    const lng = parseFloat(data.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
    return {
        text: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        mapUrl: `https://www.google.com/maps?q=${lat},${lng}`,
    };
}

/** What we keep in the search history for one lookup. */
export function historyEntry(data) {
    return {
        ip: data.ip,
        country_code: data.country_code || "",
        country_name: data.country_name || "",
        city: data.city || data.district || "",
    };
}

/** Add `entry` to the front of `list`, dropping an older entry for the same IP. */
export function addHistoryEntry(list, entry, limit) {
    return [entry, ...list.filter((h) => h.ip !== entry.ip)].slice(0, limit);
}

/* ---------- HTML escaping ---------- */

export function escapeHTML(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}
