const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL 未配置，请先设置 Neon 连接串');
}

const sslMode = (process.env.DATABASE_SSL_MODE || 'require').toLowerCase();
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: sslMode === 'disable' ? false : { rejectUnauthorized: false }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS generation_history (
      id BIGSERIAL PRIMARY KEY,
      mode VARCHAR(20) NOT NULL,
      prompt TEXT NOT NULL,
      result_type VARCHAR(20) NOT NULL,
      result_preview TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_generation_history_created_at
    ON generation_history (created_at DESC);
  `);
}

async function saveHistory({ mode, prompt, resultType, resultPreview }) {
  const preview = resultPreview ? String(resultPreview).slice(0, 3000) : null;
  const query = `
    INSERT INTO generation_history (mode, prompt, result_type, result_preview)
    VALUES ($1, $2, $3, $4)
    RETURNING id, mode, prompt, result_type AS "resultType", created_at AS "createdAt";
  `;
  const values = [mode, prompt, resultType, preview];
  const { rows } = await pool.query(query, values);
  return rows[0];
}

async function listHistory(limit = 8) {
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 8;
  const query = `
    SELECT id, mode, prompt, result_type AS "resultType", created_at AS "createdAt"
    FROM generation_history
    ORDER BY created_at DESC
    LIMIT $1;
  `;
  const { rows } = await pool.query(query, [safeLimit]);
  return rows;
}

async function checkDb() {
  await pool.query('SELECT 1');
}

module.exports = {
  initDb,
  saveHistory,
  listHistory,
  checkDb
};
