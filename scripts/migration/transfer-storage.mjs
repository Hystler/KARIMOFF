import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

function readEnv(path) {
  const result = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    result[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }
  return result;
}

async function storageRequest(sourceUrl, sourceKey, path, init = {}) {
  const response = await fetch(`${sourceUrl}/storage/v1${path}`, {
    ...init,
    headers: {
      apikey: sourceKey,
      Authorization: `Bearer ${sourceKey}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers
    }
  });

  if (!response.ok) {
    throw new Error(`Storage request failed (${response.status}) for ${path}.`);
  }

  return response;
}

async function listObjects(sourceUrl, sourceKey, bucket, prefix = "") {
  const collected = [];
  let offset = 0;

  while (true) {
    const response = await storageRequest(
      sourceUrl,
      sourceKey,
      `/object/list/${encodeURIComponent(bucket)}`,
      {
        body: JSON.stringify({
          limit: 1000,
          offset,
          prefix,
          sortBy: { column: "name", order: "asc" }
        }),
        method: "POST"
      }
    );
    const data = await response.json();
    if (!Array.isArray(data) || !data.length) break;

    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) {
        collected.push({ path, size: Number(entry.metadata?.size ?? 0) });
      } else {
        collected.push(...(await listObjects(sourceUrl, sourceKey, bucket, path)));
      }
    }

    if (data.length < 1000) break;
    offset += data.length;
  }

  return collected;
}

const sourceEnv = readEnv(process.env.SOURCE_ENV_PATH || ".env.local");
const targetEnv = readEnv(
  process.env.MIGRATION_ENV_PATH || "/Users/akimkovalenko/Desktop/KARIMOFF-migration.env"
);
const outputPath =
  process.env.STORAGE_MAP_PATH ||
  "/Users/akimkovalenko/Desktop/karimoff-storage-url-map.json";

const sourceUrl = sourceEnv.NEXT_PUBLIC_SUPABASE_URL;
const sourceKey = sourceEnv.SUPABASE_SERVICE_ROLE_KEY;
const endpoint = targetEnv.S3_ENDPOINT;
const region = targetEnv.S3_REGION;
const targetBucket = targetEnv.S3_BUCKET;
const publicBaseUrl = (
  targetEnv.S3_CDN_BASE_URL || targetEnv.S3_PUBLIC_BASE_URL
)?.replace(/\/$/, "");

if (
  !sourceUrl ||
  !sourceKey ||
  !endpoint ||
  !region ||
  !targetBucket ||
  !publicBaseUrl ||
  !targetEnv.S3_ACCESS_KEY_ID ||
  !targetEnv.S3_SECRET_ACCESS_KEY
) {
  throw new Error("Source Supabase or target S3 configuration is incomplete.");
}

const s3 = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: {
    accessKeyId: targetEnv.S3_ACCESS_KEY_ID,
    secretAccessKey: targetEnv.S3_SECRET_ACCESS_KEY
  }
});

const mappings = [];
const bucketResponse = await storageRequest(sourceUrl, sourceKey, "/bucket");
const sourceBuckets = await bucketResponse.json();
const buckets = (sourceBuckets ?? []).map((bucket) => bucket.name).sort();

for (const bucket of buckets) {
  const objects = await listObjects(sourceUrl, sourceKey, bucket);

  for (const object of objects) {
    const sourcePath = `${encodeURIComponent(bucket)}/${object.path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    const data = await storageRequest(sourceUrl, sourceKey, `/object/authenticated/${sourcePath}`);
    const body = Buffer.from(await data.arrayBuffer());
    const sourceSha256 = createHash("sha256").update(body).digest("hex");
    const key = `${bucket}/${object.path}`;
    const cacheControl = "public, max-age=31536000, immutable";
    const contentType = data.headers.get("content-type") || "application/octet-stream";
    await s3.send(
      new PutObjectCommand({
        Bucket: targetBucket,
        Key: key,
        Body: body,
        ContentLength: body.length,
        ContentType: contentType,
        CacheControl: cacheControl
      })
    );
    const head = await s3.send(new HeadObjectCommand({ Bucket: targetBucket, Key: key }));
    if (Number(head.ContentLength ?? -1) !== body.length) {
      throw new Error(`Size mismatch after upload: ${key}`);
    }
    const downloaded = await s3.send(new GetObjectCommand({ Bucket: targetBucket, Key: key }));
    const targetBody = Buffer.from(await downloaded.Body.transformToByteArray());
    const targetSha256 = createHash("sha256").update(targetBody).digest("hex");
    if (sourceSha256 !== targetSha256) {
      throw new Error(`Checksum mismatch after upload: ${key}`);
    }

    const oldUrl = `${sourceUrl}/storage/v1/object/public/${sourcePath}`;
    const newUrl = `${publicBaseUrl}/${key
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    const publicResponse = await fetch(newUrl, { method: "HEAD" });
    if (!publicResponse.ok) {
      throw new Error(`Public HTTP check failed for ${key}: ${publicResponse.status}`);
    }
    mappings.push({
      bucket,
      path: object.path,
      file: basename(object.path),
      bytes: body.length,
      cache_control: head.CacheControl ?? cacheControl,
      content_type: head.ContentType ?? contentType,
      source_sha256: sourceSha256,
      target_sha256: targetSha256,
      http_status: publicResponse.status,
      old_url: oldUrl,
      new_url: newUrl
    });
    console.log(`Transferred and verified ${key} (${body.length} bytes)`);
  }
}

writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      source_bucket_count: buckets.length,
      source_buckets: buckets,
      source_object_count: mappings.length,
      source_bytes: mappings.reduce((sum, item) => sum + item.bytes, 0),
      mappings
    },
    null,
    2
  )}\n`,
  { mode: 0o600 }
);

console.log(`Verified ${mappings.length} objects. URL map: ${outputPath}`);
