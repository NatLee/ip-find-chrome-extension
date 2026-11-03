// The extension check must pass on src/ and fail on the mistakes it exists to catch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checker = path.join(root, "scripts", "check-extension.js");

function check(mutate) {
    const dir = mkdtempSync(path.join(tmpdir(), "ip-find-check-"));
    try {
        cpSync(path.join(root, "src"), dir, { recursive: true });
        if (mutate) mutate(dir);
        const r = spawnSync(process.execPath, [checker, dir], { encoding: "utf8" });
        return { code: r.status, out: r.stdout + r.stderr };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const edit = (dir, file, fn) => {
    const p = path.join(dir, file);
    writeFileSync(p, fn(readFileSync(p, "utf8")));
};
const editManifest = (dir, fn) => edit(dir, "manifest.json", (s) => JSON.stringify(fn(JSON.parse(s))));

test("src/ passes", () => {
    const r = check();
    assert.equal(r.code, 0, r.out);
});

test("fails on a missing icon", () => {
    const r = check((d) => editManifest(d, (m) => ({ ...m, icons: { 128: "icons/nope.png" } })));
    assert.equal(r.code, 1);
    assert.match(r.out, /missing file: icons\/nope\.png/);
});

test("fails on a permission nobody signed off on", () => {
    const r = check((d) => editManifest(d, (m) => ({ ...m, permissions: [...m.permissions, "tabs"], host_permissions: ["<all_urls>"] })));
    assert.equal(r.code, 1);
    assert.match(r.out, /unexpected permission "tabs"/);
    assert.match(r.out, /unexpected host permission "<all_urls>"/);
});

test("fails on Manifest V2", () => {
    const r = check((d) => editManifest(d, (m) => ({ ...m, manifest_version: 2 })));
    assert.equal(r.code, 1);
    assert.match(r.out, /manifest_version must be 3/);
});

test("fails on inline or remote scripts in the popup", () => {
    const r = check((d) => edit(d, "popup.html", (s) => s.replace(
        "</body>",
        '<script>alert(1)</script><script src="https://cdn.example.com/x.js"></script><button onclick="x()"></button></body>',
    )));
    assert.equal(r.code, 1);
    assert.match(r.out, /inline <script>/);
    assert.match(r.out, /remote code/);
    assert.match(r.out, /inline onclick= handler/);
});

test("fails on a broken import or a syntax error", () => {
    const r = check((d) => {
        edit(d, "popup.js", (s) => s.replace('from "./lookup.js"', 'from "./gone.js"'));
        edit(d, "lookup.js", (s) => s + "\nexport function (");
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /missing file: \.\/gone\.js/);
    assert.match(r.out, /lookup\.js has a syntax error/);
});
