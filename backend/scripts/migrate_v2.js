/**
 * Migration v2 — adds multi-sport columns and pdf_uploads tracking table
 * Run: node scripts/migrate_v2.js
 * Safe to run on existing DB — uses ALTER TABLE IF NOT EXISTS patterns
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const MIGRATIONS = `
-- Add sport & gender columns to athletes (idempotent)
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS sport        VARCHAR(50)  DEFAULT 'Women''s Basketball';
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS team_gender  VARCHAR(10)  DEFAULT 'Women';

-- Add sport to roster_entries
ALTER TABLE roster_entries ADD COLUMN IF NOT EXISTS sport  VARCHAR(50)  DEFAULT 'Women''s Basketball';

-- Upload tracking table
CREATE TABLE IF NOT EXISTS pdf_uploads (
  id            SERIAL PRIMARY KEY,
  original_name VARCHAR(255) NOT NULL,
  stored_path   VARCHAR(500) NOT NULL,
  pdf_type      VARCHAR(20),    -- 'biodex' | 'bodpod' | 'unknown'
  athlete_id    INT REFERENCES athletes(id) ON DELETE SET NULL,
  athlete_name  VARCHAR(100),   -- resolved name
  test_date     DATE,
  extracted_json JSONB,
  status        VARCHAR(20) DEFAULT 'pending',  -- 'pending'|'imported'|'error'
  error_msg     TEXT,
  uploaded_at   TIMESTAMPTZ DEFAULT NOW(),
  imported_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_uploads_athlete ON pdf_uploads(athlete_id);
CREATE INDEX IF NOT EXISTS idx_uploads_type    ON pdf_uploads(pdf_type);
CREATE INDEX IF NOT EXISTS idx_uploads_status  ON pdf_uploads(status);

-- Biodex raw_data extended columns (for sets data storage)
ALTER TABLE biodex ADD COLUMN IF NOT EXISTS raw_sets_json   JSONB;
ALTER TABLE biodex ADD COLUMN IF NOT EXISTS upload_id       INT REFERENCES pdf_uploads(id) ON DELETE SET NULL;

-- BOD POD extended columns
ALTER TABLE bodpod ADD COLUMN IF NOT EXISTS fat_mass_kg     NUMERIC(7,2);
ALTER TABLE bodpod ADD COLUMN IF NOT EXISTS fat_free_mass_kg NUMERIC(7,2);
ALTER TABLE bodpod ADD COLUMN IF NOT EXISTS body_density    NUMERIC(7,4);
ALTER TABLE bodpod ADD COLUMN IF NOT EXISTS tgv             NUMERIC(7,3);
ALTER TABLE bodpod ADD COLUMN IF NOT EXISTS activity_level  VARCHAR(30);
ALTER TABLE bodpod ADD COLUMN IF NOT EXISTS upload_id       INT REFERENCES pdf_uploads(id) ON DELETE SET NULL;
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running v2 migrations...');
    // Execute each statement individually (ALTER TABLE can't be in one block easily)
    const statements = MIGRATIONS.split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const stmt of statements) {
      await client.query(stmt + ';');
    }
    console.log('✅  Migration v2 complete');
  } catch (err) {
    console.error('❌  Migration v2 failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
