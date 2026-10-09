#!/usr/bin/env node
import { createDecipheriv, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const keyText = process.env.KARIMOFF_SEED_SNAPSHOT_KEY_B64?.trim() ?? "";
const key = Buffer.from(keyText, "base64");
if (key.length !== 32 || key.toString("base64") !== keyText) {
  throw new Error("KARIMOFF_SEED_SNAPSHOT_KEY_B64 must be a canonical base64-encoded 256-bit key.");
}

const encrypted = await readFile("outputs/delivery-whitelist-review-2026-10-03/raw-overpass.json.gz.enc");
if (encrypted.length < 29) throw new Error("Encrypted OSM snapshot is truncated.");
const decipher = createDecipheriv("aes-256-gcm", key, encrypted.subarray(0, 12));
decipher.setAuthTag(encrypted.subarray(12, 28));
const compressed = Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]);
const snapshotBytes = gunzipSync(compressed);
const snapshotSha256 = createHash("sha256").update(snapshotBytes).digest("hex");
const expectedSha256 = "b34266b612678934877bdd405b3567bd59bf3c1677cea6711d8ec182017558e4";
if (snapshotSha256 !== expectedSha256) throw new Error("Decrypted OSM snapshot checksum mismatch.");

const snapshot = JSON.parse(snapshotBytes.toString("utf8"));
if (snapshot.osm3s?.timestamp_osm_base !== "2026-10-03T13:13:20Z" || snapshot.elements?.length !== 2757) {
  throw new Error("Decrypted OSM snapshot metadata mismatch.");
}
const outputPath = "/tmp/karimoff-approved-raw-overpass.json";
await writeFile(outputPath, snapshotBytes, { mode: 0o600 });
console.log(JSON.stringify({
  verified: true,
  source_snapshot_version: snapshot.osm3s.timestamp_osm_base,
  source_objects: snapshot.elements.length,
  sha256: snapshotSha256,
  output: outputPath
}));
