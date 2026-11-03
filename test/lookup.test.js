import { test } from "node:test";
import assert from "node:assert/strict";
import {
    API_BASE,
    lookupUrl,
    isIPv4,
    isIPv6,
    isValidIP,
    formatCoords,
    hasLookupData,
    formatLocation,
    formatNetwork,
    formatTimezone,
    localTimeIn,
    historyEntry,
    addHistoryEntry,
    escapeHTML,
} from "../src/lookup.js";

test("looking up your own IP calls the API root", () => {
    assert.equal(lookupUrl(""), API_BASE);
    assert.equal(lookupUrl(undefined), API_BASE);
});

// Regression: the IP used to go in an ?ip= query, which the API ignores, so
// every search showed the caller's own IP.
test("looking up another IP puts it in the URL path", () => {
    assert.equal(lookupUrl("8.8.8.8"), "https://json.geoiplookup.io/8.8.8.8");
    assert.equal(lookupUrl("2001:4860:4860::8888"), "https://json.geoiplookup.io/2001%3A4860%3A4860%3A%3A8888");
    assert.doesNotMatch(lookupUrl("1.1.1.1"), /\?/);
});

test("accepts ordinary IPv4 addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "0.0.0.0", "255.255.255.255", "192.168.1.1", "10.0.0.254"]) {
        assert.ok(isIPv4(ip), ip);
        assert.ok(isValidIP(ip), ip);
    }
});

// Regression: "08.08.08.08" passed the check, then the API answered 400 and
// the popup said "Lookup failed" instead of pointing at the typo.
test("rejects IPv4 octets with leading zeros", () => {
    for (const ip of ["08.08.08.08", "1.2.3.04", "001.1.1.1", "192.168.01.1"]) {
        assert.equal(isIPv4(ip), false, ip);
    }
    for (const ip of ["100.64.0.1", "199.9.9.9", "1.20.3.0"]) assert.ok(isIPv4(ip), ip);
});

test("rejects things that are not IPv4 addresses", () => {
    for (const ip of ["", "256.1.1.1", "1.2.3", "1.2.3.4.5", "1.2.3.-4", "a.b.c.d", " 8.8.8.8", "8.8.8.8/32"]) {
        assert.equal(isIPv4(ip), false, JSON.stringify(ip));
    }
});

test("accepts full, compressed and IPv4-mapped IPv6 addresses", () => {
    for (const ip of [
        "2001:4860:4860::8888",
        "2001:0db8:0000:0000:0000:0000:0000:0001",
        "::1",
        "::",
        "fe80::1",
        "::ffff:8.8.8.8",
        "2409:10:32e0:ac00:25fd:7636:5ef2:c507",
    ]) {
        assert.ok(isIPv6(ip), ip);
        assert.ok(isValidIP(ip), ip);
    }
});

test("rejects malformed IPv6 addresses", () => {
    for (const ip of ["", "2001:db8::1::1", "12345::", "g::1", "2001:db8:1:2:3:4:5:6:7", ":1"]) {
        assert.equal(isIPv6(ip), false, JSON.stringify(ip));
    }
    assert.equal(isValidIP("example.com"), false);
});

test("coordinates come with a Google Maps link, and 0,0 means unknown", () => {
    assert.deepEqual(formatCoords({ latitude: 37.422, longitude: -122.085 }), {
        text: "37.4220, -122.0850",
        mapUrl: "https://www.google.com/maps?q=37.422,-122.085",
    });
    assert.equal(formatCoords({ latitude: 0, longitude: 0 }), null);
    assert.equal(formatCoords({ latitude: "", longitude: "" }), null);
    assert.equal(formatCoords({}), null);
});

test("history keeps the newest lookup first, without duplicates, up to the limit", () => {
    const entry = (ip) => historyEntry({ ip, country_code: "US", country_name: "United States", city: "X" });
    let list = [];
    for (const ip of ["1.1.1.1", "8.8.8.8", "9.9.9.9"]) list = addHistoryEntry(list, entry(ip), 2);
    assert.deepEqual(list.map((h) => h.ip), ["9.9.9.9", "8.8.8.8"]);
    list = addHistoryEntry(list, entry("8.8.8.8"), 2);
    assert.deepEqual(list.map((h) => h.ip), ["8.8.8.8", "9.9.9.9"]);
});

test("history entries fall back to the district when there is no city", () => {
    assert.deepEqual(historyEntry({ ip: "1.2.3.4", district: "Chiyoda" }), {
        ip: "1.2.3.4", country_code: "", country_name: "", city: "Chiyoda",
    });
});

test("escapes text before it goes into innerHTML", () => {
    assert.equal(escapeHTML(`<img src=x onerror="a('b')">&`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
    assert.equal(escapeHTML(null), "");
    assert.equal(escapeHTML(15169), "15169");
});

// Responses below are trimmed copies of what json.geoiplookup.io returned on 2026-11-03.
const GOOGLE_DNS = {
    ip: "8.8.8.8", isp: "Google LLC", org: "Level 3", city: "Mountain View", region: "California",
    country_code: "US", country_name: "United States", timezone_name: "America/Los_Angeles",
    latitude: 37.422, longitude: -122.085, asn_number: 15169, asn_org: "Google LLC",
    asn: "AS15169 - Google LLC", success: true,
};
const TAIPEI = {
    ip: "203.0.113.7", isp: "Example Telecom", city: "Taipei", region: "Taiwan",
    country_code: "TW", country_name: "Taiwan", timezone_name: "Asia/Taipei",
};

// Regression: the API's asn field became "AS15169 - Google LLC", so the row
// read "Google LLC · AS15169 - Google LLC".
test("the Network row names the ISP once, followed by the AS number", () => {
    assert.equal(formatNetwork(GOOGLE_DNS), "Google LLC · AS15169");
    assert.equal(formatNetwork({ asn: "AS13335 - Cloudflare, Inc." }), "AS13335");
    assert.equal(formatNetwork({ isp: "Some ISP", asn: "4134" }), "Some ISP · AS4134");
    assert.equal(formatNetwork({ org: "Only Org" }), "Only Org");
    assert.equal(formatNetwork({ asn_number: 0, asn: "" }), "");
});

// Regression: "Taipei, Taiwan, Taiwan".
test("Location shows each place name once", () => {
    assert.equal(formatLocation(TAIPEI), "Taipei, Taiwan");
    assert.equal(formatLocation(GOOGLE_DNS), "Mountain View, California, United States");
    assert.equal(formatLocation({ district: "Chiyoda", region: "Tokyo", country_name: "Japan" }), "Chiyoda, Tokyo, Japan");
    assert.equal(formatLocation({}), "");
});

// Regression: the time came from a current_time field the API no longer
// sends, and was shown in the viewer's zone rather than the IP's.
test("Timezone shows the current time in that zone", () => {
    const now = new Date("2026-11-03T14:00:00Z");
    assert.equal(localTimeIn("America/Los_Angeles", now, "en-GB"), "06:00");
    assert.equal(localTimeIn("Asia/Taipei", now, "en-GB"), "22:00");
    assert.equal(formatTimezone(GOOGLE_DNS, now, "en-GB"), "America/Los_Angeles · 06:00");
    assert.equal(formatTimezone(TAIPEI, now, "en-GB"), "Asia/Taipei · 22:00");
});

test("the time reads HH:MM whatever the browser's language", () => {
    const evening = new Date("2026-11-03T10:05:00Z");
    for (const locale of ["en-US", "zh-TW", "ja-JP", "de-DE", undefined]) {
        assert.equal(localTimeIn("Asia/Taipei", evening, locale), "18:05", String(locale));
        assert.equal(localTimeIn("America/Los_Angeles", evening, locale), "02:05", String(locale));
    }
});

test("an unknown or missing zone shows no time", () => {
    assert.equal(formatTimezone({ timezone_name: "Mars/Olympus_Mons" }), "Mars/Olympus_Mons");
    assert.equal(formatTimezone({ timezone_name: "" }), "");
    assert.equal(formatTimezone({}), "");
});

// Regression: a private address (API: HTTP 200, success: false, empty
// fields) was shown as if it had a result and saved to the history.
test("knows when the API had nothing for an address", () => {
    const privateAnswer = { ip: "192.168.1.1", isp: "", city: "", latitude: 0, longitude: 0, success: false };
    assert.equal(hasLookupData(privateAnswer), false);
    assert.equal(hasLookupData(GOOGLE_DNS), true);
    assert.equal(hasLookupData({ ip: "1.2.3.4" }), true); // older responses had no success field
    assert.equal(hasLookupData(null), false);
});
