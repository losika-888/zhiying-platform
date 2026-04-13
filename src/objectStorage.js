const { randomUUID } = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const bucket = process.env.OBJECT_STORAGE_BUCKET;
const region = process.env.OBJECT_STORAGE_REGION || 'auto';
const endpoint = process.env.OBJECT_STORAGE_ENDPOINT;
const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID;
const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY;
const publicBaseUrl = process.env.OBJECT_STORAGE_PUBLIC_BASE_URL;
const keyPrefix = process.env.OBJECT_STORAGE_PREFIX || 'generated-images';
const forcePathStyle = String(process.env.OBJECT_STORAGE_FORCE_PATH_STYLE || 'true').toLowerCase() === 'true';
const uploadAcl = (process.env.OBJECT_STORAGE_UPLOAD_ACL || '').trim();
const urlMode = (process.env.OBJECT_STORAGE_URL_MODE || 'public').trim().toLowerCase();
const signedUrlExpiresSeconds = Number(process.env.OBJECT_STORAGE_SIGNED_URL_EXPIRES_SECONDS || 3600);

function isConfigured() {
  return Boolean(bucket && endpoint && accessKeyId && secretAccessKey);
}

let s3Client = null;
function getS3Client() {
  if (!isConfigured()) return null;
  if (s3Client) return s3Client;
  s3Client = new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: {
      accessKeyId,
      secretAccessKey
    }
  });
  return s3Client;
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) {
    const err = new Error('图片数据格式无效（非标准 base64 data URL）');
    err.status = 400;
    throw err;
  }
  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], 'base64')
  };
}

function extFromContentType(contentType) {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/gif') return 'gif';
  return 'jpg';
}

function createObjectKey(contentType) {
  const ext = extFromContentType(contentType);
  const date = new Date().toISOString().slice(0, 10);
  return `${keyPrefix}/${date}/${randomUUID()}.${ext}`;
}

function toStorageUrl(key) {
  if (publicBaseUrl) {
    return `${publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }
  if (endpoint) {
    return `${endpoint.replace(/\/$/, '')}/${bucket}/${key}`;
  }
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

async function toAccessUrl(client, key) {
  if (urlMode !== 'signed') {
    return toStorageUrl(key);
  }
  const safeExpires = Number.isFinite(signedUrlExpiresSeconds)
    ? Math.max(60, Math.min(signedUrlExpiresSeconds, 7 * 24 * 3600))
    : 3600;

  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key
    }),
    { expiresIn: safeExpires }
  );
}

async function uploadImageDataUrl(dataUrl) {
  const client = getS3Client();
  if (!client) {
    const err = new Error(
      '图片上游仅返回 base64，且对象存储未配置。请设置 OBJECT_STORAGE_* 环境变量后重试。'
    );
    err.status = 500;
    throw err;
  }

  const { contentType, buffer } = parseDataUrl(dataUrl);
  const key = createObjectKey(contentType);

  const putParams = {
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType
  };

  // Signed URL mode is intended for private buckets, so we avoid setting object ACL.
  if (uploadAcl && urlMode !== 'signed') {
    putParams.ACL = uploadAcl;
  }

  await client.send(new PutObjectCommand(putParams));

  return {
    key,
    storageUrl: toStorageUrl(key),
    accessUrl: await toAccessUrl(client, key)
  };
}

module.exports = {
  uploadImageDataUrl,
  isObjectStorageConfigured: isConfigured
};
