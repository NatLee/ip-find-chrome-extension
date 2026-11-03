#!/usr/bin/env node
// Sanity checks for the unpacked extension in src/, run in CI next to the unit
// tests. It catches the mistakes that only show up after uploading to the
// Chrome Web Store or loading the extension: a broken manifest, a file the
// manifest or the popup points at that isn't there, remote or inline scripts
// (blocked by Manifest V3), and permissions that changed without anyone
// meaning to.
//
// usage: node scripts/check-extension.js [srcDir]

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

// Changing what the extension may access changes the install prompt users
// see, so it should be a deliberate edit here, not a side effect.
const ALLOWED_PERMISSIONS = ["clipboardWrite", "clipboardRead"];
const ALLOWED_HOST_PERMISSIONS = [];

const srcDir = path.resolve(process.argv[2] || "src");
const errors = [];
const fail = (msg) => errors.push(msg);
const rel = (p) => path.relative(process.cwd(), p).replace(/\\/g, "/");

function walk(dir) {
    return readdirSync(dir).flatMap((name) => {
        const p = path.join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

function mustExist(fromFile, ref) {
    const target = path.resolve(path.dirname(fromFile), ref.split(/[?#]/)[0]);
    if (!target.startsWith(srcDir)) fail(`${rel(fromFile)} points outside src/: ${ref}`);
    else if (!existsSync(target)) fail(`${rel(fromFile)} points at a missing file: ${ref}`);
}

// 1. Manifest
const manifestPath = path.join(srcDir, "manifest.json");
let manifest = {};
try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (err) {
    fail(`manifest.json is not valid JSON: ${err.message}`);
}
if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
for (const key of ["name", "version", "description"]) {
    if (!manifest[key]) fail(`manifest.json is missing "${key}"`);
}
if (manifest.description && manifest.description.length > 132) {
    fail(`description is ${manifest.description.length} characters; the Web Store allows 132`);
}
if (manifest.version && !/^\d{1,5}(\.\d{1,5}){0,3}$/.test(manifest.version)) {
    fail(`version "${manifest.version}" must be 1-4 dot-separated numbers`);
}
const extra = (list, allowed) => (list || []).filter((p) => !allowed.includes(p));
for (const p of extra(manifest.permissions, ALLOWED_PERMISSIONS)) {
    fail(`unexpected permission "${p}" (update ALLOWED_PERMISSIONS if this is intended)`);
}
for (const p of extra(manifest.host_permissions, ALLOWED_HOST_PERMISSIONS)) {
    fail(`unexpected host permission "${p}" (update ALLOWED_HOST_PERMISSIONS if this is intended)`);
}

const referenced = [
    manifest.action?.default_popup,
    manifest.background?.service_worker,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
].filter(Boolean);
for (const ref of referenced) mustExist(manifestPath, ref);

// 2. HTML pages: local scripts and styles only, no inline code.
const files = walk(srcDir);
for (const file of files.filter((f) => f.endsWith(".html"))) {
    const html = readFileSync(file, "utf8");
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(m[1])?.[1];
        if (!src) {
            if (m[2].trim()) fail(`${rel(file)} has an inline <script>; Manifest V3 blocks it`);
            continue;
        }
        if (/^(https?:)?\/\//i.test(src)) fail(`${rel(file)} loads remote code: ${src}`);
        else mustExist(file, src);
    }
    for (const m of html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
        if (/rel\s*=\s*["']stylesheet["']/i.test(m[0])) {
            if (/^(https?:)?\/\//i.test(m[1])) fail(`${rel(file)} loads a remote stylesheet: ${m[1]}`);
            else mustExist(file, m[1]);
        }
    }
    const inlineHandler = /<[a-z][^>]*\s(on[a-z]+)\s*=/i.exec(html);
    if (inlineHandler) fail(`${rel(file)} has an inline ${inlineHandler[1]}= handler; Manifest V3 blocks it`);
}

// 3. JavaScript: valid syntax, and every relative import exists. Every script
//    in src/ is an ES module. `node --check <file>` lets module syntax errors
//    through (Node 22), so the source goes in on stdin with an explicit type.
for (const file of files.filter((f) => f.endsWith(".js"))) {
    const js = readFileSync(file, "utf8");
    try {
        execFileSync(process.execPath, ["--input-type=module", "--check"], { input: js, stdio: "pipe" });
    } catch (err) {
        fail(`${rel(file)} has a syntax error:\n${err.stderr}`);
    }
    for (const m of js.matchAll(/\bimport\s[^"']*?from\s*["'](\.[^"']+)["']/g)) mustExist(file, m[1]);
}

if (errors.length) {
    console.error(`check-extension: ${errors.length} problem(s)\n- ${errors.join("\n- ")}`);
    process.exit(1);
}
console.log(`check-extension: OK (${manifest.name} ${manifest.version}, ${files.length} files)`);
