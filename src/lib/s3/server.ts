import "server-only";

import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

let sharedClient: S3Client | null = null;

function s3Config() {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL?.replace(/\/$/, "");

  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey || !publicBaseUrl) {
    return null;
  }

  return { accessKeyId, bucket, endpoint, publicBaseUrl, region, secretAccessKey };
}

function client() {
  const config = s3Config();
  if (!config) return null;
  if (!sharedClient) {
    sharedClient = new S3Client({
      endpoint: config.endpoint,
      forcePathStyle: true,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
  }
  return { config, s3: sharedClient };
}

export async function uploadS3Object(key: string, body: Buffer, contentType: string) {
  const target = client();
  if (!target) return { error: "Timeweb S3 не настроен.", url: null as string | null };

  try {
    await target.s3.send(
      new PutObjectCommand({
        Body: body,
        Bucket: target.config.bucket,
        CacheControl: "public, max-age=31536000, immutable",
        ContentType: contentType,
        Key: key
      })
    );
    return {
      error: null as string | null,
      url: `${target.config.publicBaseUrl}/${key
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Не удалось загрузить файл в S3.",
      url: null as string | null
    };
  }
}

export async function removeS3Object(key: string) {
  const target = client();
  if (!target) return;
  await target.s3.send(new DeleteObjectCommand({ Bucket: target.config.bucket, Key: key }));
}

export function s3KeyFromPublicUrl(imageUrl: string) {
  const config = s3Config();
  if (!config || !imageUrl.startsWith(`${config.publicBaseUrl}/`)) return null;
  return imageUrl
    .slice(config.publicBaseUrl.length + 1)
    .split("/")
    .map(decodeURIComponent)
    .join("/");
}
