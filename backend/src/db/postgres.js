const { Pool } = require('pg');
const logger = require('../utils/logger');

let pool;

async function initDB() {
  pool = new Pool({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  });

  pool.on('error', (err) => {
    logger.error('Unexpected DB pool error', err);
  });

  // Test connection
  const client = await pool.connect();
  const res = await client.query('SELECT NOW()');
  client.release();
  logger.info(`PostgreSQL connected at ${res.rows[0].now}`);
  return pool;
}

function query(text, params) {
  if (!pool) throw new Error('DB not initialized — call initDB() first');
  return pool.query(text, params);
}

function getPool() { return pool; }

module.exports = { initDB, query, getPool };
