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

/**
 * Dotted-quad IPv4. Leading zeros ("08.08.08.08") are rejected: they are
 * ambiguous (some tools read them as octal) and the API answers 400.
 */
export function isIPv4(ip) {
    if (!ip) return false;
    const re = /^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$/;
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

/**
 * False when the API had nothing for the address. Private and reserved
 * ranges come back as HTTP 200 with `success: false` and empty fields.
 */
export function hasLookupData(data) {
    return !!data && data.success !== false;
}

/**
 * "City, Region, Country", or "" when the response has none of them. A name
 * that repeats (the API reports region "Taiwan" in country "Taiwan") is shown once.
 */
export function formatLocation(data) {
    const parts = [data.city || data.district, data.region, data.country_name].filter(Boolean);
    const seen = new Set();
    return parts
        .filter((p) => {
            const key = String(p).trim().toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .join(", ");
}

export function ispName(data) {
    return data.isp || data.org || data.asn_org || "";
}

/**
 * The AS number on its own ("AS15169"). The API sends `asn_number` (15169)
 * and `asn` ("AS15169 - Google LLC"), and older responses sent a bare number.
 */
export function asnLabel(data) {
    if (Number(data.asn_number) > 0) return `AS${Number(data.asn_number)}`;
    const raw = data.asn ? String(data.asn).trim() : "";
    const m = /^(?:AS)?\s*(\d+)/i.exec(raw);
    return m && Number(m[1]) > 0 ? `AS${m[1]}` : "";
}

/** "ISP · AS1234" (either half may be missing). */
export function formatNetwork(data) {
    const isp = ispName(data);
    const asn = asnLabel(data);
    if (isp && asn) return `${isp} · ${asn}`;
    return isp || asn;
}

/**
 * Current time in `timeZone` ("09:41"), or "" for an unknown zone. Worked out
 * locally: the API stopped sending `current_time`, and the old code showed
 * that time in the viewer's own zone anyway.
 */
export function localTimeIn(timeZone, now = new Date(), locale = undefined) {
    if (!timeZone) return "";
    try {
        return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone }).format(now);
    } catch {
        return "";
    }
}

/** "Asia/Taipei · 21:30", or just the zone name, or "". */
export function formatTimezone(data, now = new Date(), locale = undefined) {
    const tz = data.timezone_name || "";
    const time = localTimeIn(tz, now, locale);
    return time ? `${tz} · ${time}` : tz;
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
