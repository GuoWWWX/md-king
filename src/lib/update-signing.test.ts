import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

const script = resolve("scripts/sign-update.mjs");
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

for (const scenario of ["legacy", "delta", "tampered"] as const) {
  test(`更新签名兼容完整包并验证增量包：${scenario}`, () => {
    const root = mkdtempSync(join(tmpdir(), "mdking-sign-test-"));
    try {
      const bundle = join(root, "src-tauri/target/release/bundle/nsis");
      mkdirSync(bundle, { recursive: true });
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const publicDer = publicKey.export({ type: "spki", format: "der" });
      writeFileSync(join(root, "src-tauri/update-public-key.txt"), publicDer.subarray(-32).toString("base64"));
      writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.1.18" }));
      const full = Buffer.alloc(4096, 1);
      writeFileSync(join(bundle, "md-king_1.1.18_x64-setup.exe"), full);
      const delta = { base_version: "v1.1.17", base_size: 4096, base_sha256: hash(full), asset: "md-king_1.1.17_to_1.1.18_x64.patch", size: 128, sha256: hash(Buffer.alloc(128, 2)) };
      if (scenario !== "legacy") {
        writeFileSync(join(bundle, delta.asset), Buffer.alloc(128, scenario === "tampered" ? 3 : 2));
        writeFileSync(join(bundle, "update-delta.json"), JSON.stringify(delta));
      }
      const result = spawnSync(process.execPath, [script], { cwd: root, windowsHide: true, encoding: "utf8", env: {
        ...process.env, GITHUB_REF_NAME: "v1.1.18", UPDATE_SIGNING_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
      } });
      if (scenario === "tampered") {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Delta size or SHA-256 mismatch/);
      } else {
        assert.equal(result.status, 0, result.stderr);
        const manifest = readFileSync(join(bundle, "update-manifest.json"));
        assert.equal(verify(null, manifest, publicKey, Buffer.from(readFileSync(join(bundle, "update-manifest.sig"), "utf8").trim(), "base64")), true);
        assert.deepEqual(JSON.parse(manifest.toString()).delta, scenario === "delta" ? delta : undefined);
        if (scenario === "delta") assert.match(readFileSync(join(bundle, "SHA256SUMS.txt"), "utf8"), /x64\.patch/);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
