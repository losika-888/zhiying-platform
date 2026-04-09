const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
dotenv.config();
const { initDb, saveHistory, listHistory, checkDb } = require('./db');
const { uploadImageDataUrl } = require('./objectStorage');

const app = express();
const PORT = Number(process.env.PORT || 3000);

const YUNWU_BASE_URL = process.env.YUNWU_BASE_URL || 'https://yunwu.ai/v1';
const YUNWU_API_KEY = process.env.YUNWU_API_KEY;
const TEXT_MODEL = process.env.TEXT_MODEL || 'gpt-4o-mini';
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'gemini-3.1-flash-image-preview';

const ARK_BASE_URL = process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
const ARK_API_KEY = process.env.ARK_API_KEY;
const ARK_MODEL = process.env.ARK_MODEL || 'doubao-seedance-1-0-pro-fast-251015';
const VIDEO_POLL_INTERVAL_MS = Number(process.env.VIDEO_POLL_INTERVAL_MS || 5000);
const VIDEO_POLL_MAX_ROUNDS = Number(process.env.VIDEO_POLL_MAX_ROUNDS || 60);

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function assertPrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    const err = new Error('prompt 不能为空');
    err.status = 400;
    throw err;
  }
  const trimmed = prompt.trim();
  if (!trimmed) {
    const err = new Error('prompt 不能为空');
    err.status = 400;
    throw err;
  }
  if (trimmed.length > 4000) {
    const err = new Error('prompt 长度不能超过 4000 字符');
    err.status = 400;
    throw err;
  }
  return trimmed;
}

function requireEnv(name, value) {
  if (!value) {
    const err = new Error(`${name} 未配置`);
    err.status = 500;
    throw err;
  }
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  let data;

  try {
    data = await res.json();
  } catch (_err) {
    const text = await res.text();
    const err = new Error(`上游服务返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
    err.status = 502;
    throw err;
  }

  if (!res.ok || data.error) {
    const message = data?.error?.message || data?.error || JSON.stringify(data).slice(0, 200);
    const err = new Error(`上游服务错误（HTTP ${res.status}）：${message}`);
    err.status = 502;
    throw err;
  }
  return data;
}

function extractTextContent(data) {
  return data?.choices?.[0]?.message?.content;
}

function extractImageResult(content) {
  let httpUrl = null;
  let dataUrl = null;

  if (typeof content === 'string') {
    if (content.startsWith('http://') || content.startsWith('https://')) {
      httpUrl = content;
    } else if (content.includes('base64,')) {
      const b64 = content.split('base64,')[1].replace(/[^A-Za-z0-9+/=]/g, '');
      dataUrl = `data:image/jpeg;base64,${b64}`;
    }
  } else if (Array.isArray(content)) {
    for (const part of content) {
      const maybeUrl = part?.image_url?.url;
      if (!maybeUrl || typeof maybeUrl !== 'string') continue;
      if (maybeUrl.startsWith('http://') || maybeUrl.startsWith('https://')) {
        httpUrl = maybeUrl;
        break;
      }
      if (maybeUrl.includes('base64,')) {
        const b64 = maybeUrl.split('base64,')[1].replace(/[^A-Za-z0-9+/=]/g, '');
        dataUrl = `data:image/jpeg;base64,${b64}`;
      }
    }
  }

  if (httpUrl) {
    return {
      remoteUrl: httpUrl,
      dataUrl: null
    };
  }
  if (dataUrl) {
    return {
      remoteUrl: null,
      dataUrl
    };
  }

  throw new Error('未从上游响应中解析到图片内容');
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

app.get('/api/health', async (_req, res, next) => {
  try {
    await checkDb();
    res.json({ ok: true, data: { status: 'healthy' } });
  } catch (err) {
    next(err);
  }
});

app.get('/api/history', async (req, res, next) => {
  try {
    const limit = Number(req.query.limit || 8);
    const rows = await listHistory(limit);
    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
});

app.post('/api/generate/text', async (req, res, next) => {
  try {
    requireEnv('YUNWU_API_KEY', YUNWU_API_KEY);
    const prompt = assertPrompt(req.body?.prompt);

    const data = await fetchJson(`${YUNWU_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${YUNWU_API_KEY}`
      },
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages: [
          {
            role: 'system',
            content:
              '你是一位专业的营销文案专家，擅长创作吸引人的中文营销内容。请根据用户需求，生成高质量、有创意的营销文案，包含标题、正文和行动号召语。'
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 1000
      })
    });

    const text = extractTextContent(data);
    if (!text || typeof text !== 'string') {
      throw new Error('上游未返回有效文案');
    }

    const row = await saveHistory({
      mode: 'text',
      prompt,
      resultType: 'text',
      resultPreview: text
    });

    res.json({
      ok: true,
      data: {
        ...row,
        content: text
      }
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/generate/image', async (req, res, next) => {
  try {
    requireEnv('YUNWU_API_KEY', YUNWU_API_KEY);
    const prompt = assertPrompt(req.body?.prompt);

    const data = await fetchJson(`${YUNWU_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${YUNWU_API_KEY}`
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        messages: [{ role: 'user', content: prompt }],
        extra_body: { modalities: ['text', 'image'] }
      })
    });

    const content = data?.choices?.[0]?.message?.content;
    const imageResult = extractImageResult(content);
    const finalImageUrl = imageResult.remoteUrl || (await uploadImageDataUrl(imageResult.dataUrl));

    const row = await saveHistory({
      mode: 'image',
      prompt,
      resultType: 'image',
      resultPreview: finalImageUrl
    });

    res.json({
      ok: true,
      data: {
        ...row,
        content: finalImageUrl
      }
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/generate/video', async (req, res, next) => {
  try {
    requireEnv('ARK_API_KEY', ARK_API_KEY);
    const prompt = assertPrompt(req.body?.prompt);

    const createData = await fetchJson(`${ARK_BASE_URL}/contents/generations/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ARK_API_KEY}`
      },
      body: JSON.stringify({
        model: ARK_MODEL,
        content: [
          {
            type: 'text',
            text: `${prompt} --resolution 1080p --duration 5 --camerafixed false --watermark false`
          }
        ]
      })
    });

    const taskId = createData.id;
    if (!taskId) {
      throw new Error('未获取到视频任务 ID');
    }

    let videoUrl = null;
    for (let i = 0; i < VIDEO_POLL_MAX_ROUNDS; i += 1) {
      await sleep(VIDEO_POLL_INTERVAL_MS);
      const pollData = await fetchJson(`${ARK_BASE_URL}/contents/generations/tasks/${taskId}`, {
        headers: {
          Authorization: `Bearer ${ARK_API_KEY}`
        }
      });

      const status = pollData.status;
      if (status === 'succeeded') {
        videoUrl =
          pollData?.content?.video_url ||
          (Array.isArray(pollData?.outputs) ? pollData.outputs[0]?.url : null);
        break;
      }
      if (status === 'failed') {
        throw new Error(`视频任务失败：${JSON.stringify(pollData.error || pollData)}`);
      }
    }

    if (!videoUrl) {
      throw new Error('视频生成超时，请稍后重试');
    }

    const row = await saveHistory({
      mode: 'video',
      prompt,
      resultType: 'video',
      resultPreview: videoUrl
    });

    res.json({
      ok: true,
      data: {
        ...row,
        content: videoUrl
      }
    });
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  const status = Number(err.status) || 500;
  const message = err.message || '服务内部错误';
  res.status(status).json({ ok: false, error: message });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
