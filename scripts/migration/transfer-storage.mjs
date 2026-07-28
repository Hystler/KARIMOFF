import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
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

async function listObjects(storage, bucket, prefix = "") {
  const collected = [];
  let offset = 0;

  while (true) {
    const { data, error } = await storage.from(bucket).list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" }
    });
    if (error) throw new Error(`${bucket}: ${error.message}`);
    if (!data?.length) break;

    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) {
        collected.push({ path, size: Number(entry.metadata?.size ?? 0) });
      } else {
        collected.push(...(await listObjects(storage, bucket, path)));
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
const publicBaseUrl = targetEnv.S3_PUBLIC_BASE_URL?.replace(/\/$/, "");

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

const supabase = createClient(sourceUrl, sourceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
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
const buckets = ["products", "hero", "brand", "avatars"];

for (const bucket of buckets) {
  const objects = await listObjects(supabase.storage, bucket);

  for (const object of objects) {
    const { data, error } = await supabase.storage.from(bucket).download(object.path);
    if (error) throw new Error(`${bucket}/${object.path}: ${error.message}`);

    const body = Buffer.from(await data.arrayBuffer());
    const key = `${bucket}/${object.path}`;
    await s3.send(
      new PutObjectCommand({
        Bucket: targetBucket,
        Key: key,
        Body: body,
        ContentLength: body.length,
        ContentType: data.type || "application/octet-stream",
        CacheControl: "public, max-age=31536000, immutable"
      })
    );
    const head = await s3.send(new HeadObjectCommand({ Bucket: targetBucket, Key: key }));
    if (Number(head.ContentLength ?? -1) !== body.length) {
      throw new Error(`Size mismatch after upload: ${key}`);
    }

    const oldUrl = supabase.storage.from(bucket).getPublicUrl(object.path).data.publicUrl;
    mappings.push({
      bucket,
      path: object.path,
      file: basename(object.path),
      bytes: body.length,
      old_url: oldUrl,
      new_url: `${publicBaseUrl}/${key}`
    });
    console.log(`Transferred ${key} (${body.length} bytes)`);
  }
}

writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      generated_at: new Date().toISOString(),
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
