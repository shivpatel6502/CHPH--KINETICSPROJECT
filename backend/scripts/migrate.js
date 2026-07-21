/**
 * Database migration — creates all tables for WBB Dashboard
 * Run: node scripts/migrate.js
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const SCHEMA = `
-- Athletes master table
CREATE TABLE IF NOT EXISTS athletes (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  position    VARCHAR(50),
  program     VARCHAR(100),
  hometown    VARCHAR(100),
  birthday    DATE,
  height_cm   NUMERIC(5,1),
  wingspan_cm NUMERIC(5,1),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Roster seasons (an athlete can be on roster for multiple years)
CREATE TABLE IF NOT EXISTS roster_entries (
  id             SERIAL PRIMARY KEY,
  athlete_id     INT REFERENCES athletes(id) ON DELETE CASCADE,
  season         VARCHAR(10) NOT NULL,  -- e.g. "2025-26"
  roster_status  VARCHAR(30) DEFAULT 'Full',
  training_bucket VARCHAR(50),
  accommodation  VARCHAR(100),
  accommodation2 VARCHAR(100),
  notes          TEXT,
  UNIQUE(athlete_id, season)
);

-- BIOPOD body composition tests
CREATE TABLE IF NOT EXISTS BIOPOD (
  id             SERIAL PRIMARY KEY,
  athlete_id     INT REFERENCES athletes(id) ON DELETE CASCADE,
  test_date      DATE NOT NULL,
  season         VARCHAR(10),
  test_phase     VARCHAR(30),
  weight_lbs     NUMERIC(7,2),
  body_fat_pct   NUMERIC(5,3),   -- stored as decimal 0.179
  fat_free_mass_lbs NUMERIC(7,2),
  height_cm      NUMERIC(5,1),
  ree_kcal       INT,
  tee_kcal       INT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_BIOPOD_athlete ON BIOPOD(athlete_id);
CREATE INDEX IF NOT EXISTS idx_BIOPOD_date ON BIOPOD(test_date);

-- Biodex isokinetic strength tests
CREATE TABLE IF NOT EXISTS biodex (
  id             SERIAL PRIMARY KEY,
  athlete_id     INT REFERENCES athletes(id) ON DELETE CASCADE,
  test_date      DATE NOT NULL,
  season         VARCHAR(10),
  test_phase     VARCHAR(30),
  weight_kg      NUMERIC(6,2),
  height_cm      NUMERIC(5,1),
  -- Peak torques (Nm)
  quad_l_60      NUMERIC(7,2), quad_r_60  NUMERIC(7,2),
  quad_l_120     NUMERIC(7,2), quad_r_120 NUMERIC(7,2),
  quad_l_180     NUMERIC(7,2), quad_r_180 NUMERIC(7,2),
  ham_l_60       NUMERIC(7,2), ham_r_60   NUMERIC(7,2),
  ham_l_120      NUMERIC(7,2), ham_r_120  NUMERIC(7,2),
  ham_l_180      NUMERIC(7,2), ham_r_180  NUMERIC(7,2),
  -- L:R ratios (decimal)
  quad_lr_60     NUMERIC(5,3), ham_lr_60  NUMERIC(5,3),
  quad_lr_120    NUMERIC(5,3), ham_lr_120 NUMERIC(5,3),
  quad_lr_180    NUMERIC(5,3), ham_lr_180 NUMERIC(5,3),
  -- H:Q ratios (decimal)
  lhq_60         NUMERIC(5,3), rhq_60     NUMERIC(5,3),
  lhq_120        NUMERIC(5,3), rhq_120    NUMERIC(5,3),
  lhq_180        NUMERIC(5,3), rhq_180    NUMERIC(5,3),
  -- Classifications
  lr_class       VARCHAR(30),
  hq_class       VARCHAR(30),
  training_priority VARCHAR(50),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_biodex_athlete ON biodex(athlete_id);
CREATE INDEX IF NOT EXISTS idx_biodex_date ON biodex(test_date);

-- Performance testing
CREATE TABLE IF NOT EXISTS performance_tests (
  id              SERIAL PRIMARY KEY,
  athlete_id      INT REFERENCES athletes(id) ON DELETE CASCADE,
  test_date       DATE NOT NULL,
  season          VARCHAR(10),
  test_phase      VARCHAR(30),
  test_weight_lbs NUMERIC(7,2),
  front_squat_lbs NUMERIC(7,2), front_squat_reps INT,
  front_sq_1rm    NUMERIC(7,2), front_sq_rel NUMERIC(5,3),
  bench_lbs       NUMERIC(7,2), bench_reps INT,
  bench_1rm       NUMERIC(7,2), bench_rel  NUMERIC(5,3),
  pullups_reps    INT,
  yirtl1_m        INT,
  approach_jump_in NUMERIC(5,1),
  cmj_block_in    NUMERIC(5,1),
  t_test_l        NUMERIC(5,2), t_test_r NUMERIC(5,2),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_perf_athlete ON performance_tests(athlete_id);

-- AI insights cache
CREATE TABLE IF NOT EXISTS ai_insights_cache (
  id           SERIAL PRIMARY KEY,
  cache_key    VARCHAR(255) UNIQUE NOT NULL,
  insight_type VARCHAR(50),       -- 'anomaly'|'forecast'|'risk'|'summary'|'team'
  athlete_id   INT,
  payload      JSONB NOT NULL,
  model_used   VARCHAR(50),
  prompt_hash  VARCHAR(64),
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cache_key ON ai_insights_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON ai_insights_cache(expires_at);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running migrations...');
    await client.query(SCHEMA);
    console.log('✅  Migration complete');
  } catch (err) {
    console.error('❌  Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
