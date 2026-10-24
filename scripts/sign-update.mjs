import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Only stable X.Y.Z versions are supported");
const tag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME;
if (tag && tag !== `v${version}`) throw new Error(`Tag ${tag} does not match package version v${version}`);
const bundle = resolve("src-tauri/target/release/bundle/nsis");
const asset = `md-king_${version}_x64-setup.exe`;
const installer = readFileSync(resolve(bundle, asset));
const key = createPrivateKey({ key: Buffer.from(process.env.UPDATE_SIGNING_PRIVATE_KEY ?? "", "base64"), type: "pkcs8", format: "der" });
const publicBytes = Buffer.from(readFileSync("src-tauri/update-public-key.txt", "utf8").trim(), "base64");
const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicBytes]), type: "spki", format: "der" });
const data = { version: `v${version}`, asset, size: installer.length, sha256: createHash("sha256").update(installer).digest("hex") };
const deltaMetadata = resolve(bundle, "update-delta.json");
if (existsSync(deltaMetadata)) {
  const delta = JSON.parse(readFileSync(deltaMetadata, "utf8"));
  if (!/^v\d+\.\d+\.\d+$/.test(delta.base_version) || delta.base_version === `v${version}`
    || delta.asset !== `md-king_${delta.base_version.slice(1)}_to_${version}_x64.patch`
    || !Number.isSafeInteger(delta.base_size) || delta.base_size <= 0 || !/^[a-f0-9]{64}$/.test(delta.base_sha256)) {
    throw new Error("Invalid delta base or asset metadata");
  }
  const patch = readFileSync(resolve(bundle, delta.asset));
  if (patch.length === 0 || patch.length >= installer.length || delta.size !== patch.length
    || delta.sha256 !== createHash("sha256").update(patch).digest("hex")) throw new Error("Delta size or SHA-256 mismatch");
  data.delta = delta;
}
const manifest = Buffer.from(JSON.stringify(data) + "\n");
const signature = sign(null, manifest, key);
if (!verify(null, manifest, publicKey, signature)) throw new Error("Signing key does not match the client public key");
writeFileSync(resolve(bundle, "update-manifest.json"), manifest);
writeFileSync(resolve(bundle, "update-manifest.sig"), signature.toString("base64") + "\n");
const checksums = readdirSync(bundle).filter(name => name.endsWith(".exe") || name === data.delta?.asset).map(name => `${createHash("sha256").update(readFileSync(resolve(bundle, name))).digest("hex")}  ${name}`).join("\n") + "\n";
writeFileSync(resolve(bundle, "SHA256SUMS.txt"), checksums);
console.log(`Signed update manifest for v${version}: ${asset} (${installer.length} bytes)`);
