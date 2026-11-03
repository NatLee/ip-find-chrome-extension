import { test } from "node:test";
import assert from "node:assert/strict";
import {
    API_BASE,
    lookupUrl,
    isIPv4,
    isIPv6,
    isValidIP,
    formatCoords,
    historyEntry,
    addHistoryEntry,
    escapeHTML,
} from "../src/lookup.js";

test("looking up your own IP calls the API root", () => {
    assert.equal(lookupUrl(""), API_BASE);
    assert.equal(lookupUrl(undefined), API_BASE);
});

test("accepts ordinary IPv4 addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "0.0.0.0", "255.255.255.255", "192.168.1.1", "10.0.0.254"]) {
        assert.ok(isIPv4(ip), ip);
        assert.ok(isValidIP(ip), ip);
    }
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
