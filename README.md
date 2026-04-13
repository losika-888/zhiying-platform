# 智影文创（前后端 + Neon + Render）

这是一个可直接部署的全栈版本：
- 前端：`public/index.html`（你给的页面，已改为调用后端 API）
- 后端：`Node.js + Express`
- 数据库：`Neon Postgres`
- 部署：`Render`

## 1. 本地启动

```bash
npm install
cp .env.example .env
# 编辑 .env，填入真实 DATABASE_URL / YUNWU_API_KEY / ARK_API_KEY
# 若希望图片历史始终存 URL，请同时配置 OBJECT_STORAGE_* 变量
npm start
```

打开：`http://localhost:3000`

## 2. Neon 配置

1. 在 Neon 创建 Project 和数据库。
2. 复制 Neon 提供的连接串（`postgresql://...`）。
3. 写入 `.env` 的 `DATABASE_URL`。

后端首次启动会自动建表 `generation_history`，无需手动建表。

## 3. API 说明

- `POST /api/generate/text`
- `POST /api/generate/image`
- `POST /api/generate/video`
- `GET /api/history?limit=8`
- `GET /api/health`

## 4. 推送 GitHub

```bash
git init
git add .
git commit -m "feat: fullstack zhiying platform with neon + render"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

## 5. 部署 Render

方式 A（推荐）：
1. 在 Render 选择 **New +** -> **Blueprint**。
2. 连接你的 GitHub 仓库。
3. Render 自动识别 `render.yaml`。
4. 在环境变量中填入：
   - `DATABASE_URL`（Neon 连接串）
   - `YUNWU_API_KEY`
   - `ARK_API_KEY`
   - `OBJECT_STORAGE_BUCKET`
   - `OBJECT_STORAGE_ENDPOINT`
   - `OBJECT_STORAGE_ACCESS_KEY_ID`
   - `OBJECT_STORAGE_SECRET_ACCESS_KEY`
   - `OBJECT_STORAGE_PUBLIC_BASE_URL`（可选，推荐）
5. 点击 Deploy。

方式 B：
1. 在 Render 选择 **New +** -> **Web Service**。
2. 连接仓库后手动设置：
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Health Check: `/api/health`
   - Node 版本：20
3. 添加同样的环境变量并部署。

## 6. 注意事项

- 旧版前端中的明文密钥已移除，不会暴露在浏览器端。
- 图片接口会优先使用上游 URL；如果上游仅返回 base64，会上传到你配置的对象存储后再返回 URL。
- 对于阿里云 OSS，建议设置 `OBJECT_STORAGE_FORCE_PATH_STYLE=false` 和 `OBJECT_STORAGE_UPLOAD_ACL=public-read`。
- 如果 OSS 仍受 ACL 限制，可设置 `OBJECT_STORAGE_URL_MODE=signed`，后端会返回可直接访问的签名 URL（默认 3600 秒过期）。
- 视频生成接口可能耗时 1-3 分钟，后端会轮询等待结果。
