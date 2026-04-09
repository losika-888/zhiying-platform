const { randomUUID } = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const bucket = process.env.OBJECT_STORAGE_BUCKET;
const region = process.env.OBJECT_STORAGE_REGION || 'auto';
const endpoint = process.env.OBJECT_STORAGE_ENDPOINT;
const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID;
const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY;
const publicBaseUrl = process.env.OBJECT_STORAGE_PUBLIC_BASE_URL;
const keyPrefix = process.env.OBJECT_STORAGE_PREFIX || 'generated-images';
const forcePathStyle = String(process.env.OBJECT_STORAGE_FORCE_PATH_STYLE || 'true').toLowerCase() === 'true';

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

function toPublicUrl(key) {
  if (publicBaseUrl) {
    return `${publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }
  if (endpoint) {
    return `${endpoint.replace(/\/$/, '')}/${bucket}/${key}`;
  }
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
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

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType
    })
  );

  return toPublicUrl(key);
}

module.exports = {
  uploadImageDataUrl,
  isObjectStorageConfigured: isConfigured
};
