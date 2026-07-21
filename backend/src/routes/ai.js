const express = require('express');
const router  = express.Router();
const { query } = require('../db/postgres');
const ai = require('../services/aiService');
const logger = require('../utils/logger');

// Helper: build full athlete payload from DB
async function buildAthletePayload(athleteId) {
  const [aRes, bpRes, bdxRes] = await Promise.all([
    query(`SELECT a.*, r.training_bucket, r.accommodation, r.roster_status, r.season
           FROM athletes a
           LEFT JOIN roster_entries r ON r.athlete_id = a.id AND r.season = '2025-26'
           WHERE a.id = $1`, [athleteId]),
    query(`SELECT * FROM bodpod WHERE athlete_id = $1 ORDER BY test_date`, [athleteId]),
    query(`SELECT * FROM biodex WHERE athlete_id = $1 ORDER BY test_date`, [athleteId]),
  ]);
  return {
    athlete: aRes.rows[0],
    BIOPOD: bpRes.rows,
    biodex: bdxRes.rows,
  };
}

// GET /api/ai/anomalies?season=2025-26
router.get('/anomalies', async (req, res) => {
  try {
    const { season = '2025-26' } = req.query;
    const bpRes = await query(
      `SELECT a.id as athlete_id, a.name, b.*
       FROM bodpod b JOIN athletes a ON a.id = b.athlete_id
       WHERE b.season = $1 ORDER BY a.name, b.test_date`,
      [season]
    );
    const bdxRes = await query(
      `SELECT a.id as athlete_id, a.name, d.*
       FROM biodex d JOIN athletes a ON a.id = d.athlete_id
       WHERE d.season = $1 ORDER BY a.name, d.test_date`,
      [season]
    );
    const result = await ai.detectAnomalies({
      season, BIOPOD: bpRes.rows, biodex: bdxRes.rows
    });
    res.json(result);
  } catch (err) {
    logger.error('Anomaly route error', err);
    res.status(500).json({ error: err.message, anomalies: [], fallback: true });
  }
});

// GET /api/ai/forecasts?season=2025-26
router.get('/forecasts', async (req, res) => {
  try {
    const { season = '2025-26' } = req.query;
    const bpRes = await query(
      `SELECT a.id as athlete_id, a.name, b.test_date, b.test_phase,
              b.body_fat_pct, b.fat_free_mass_lbs, b.weight_lbs
       FROM bodpod b JOIN athletes a ON a.id = b.athlete_id
       WHERE b.season = $1 ORDER BY a.name, b.test_date`,
      [season]
    );
    const result = await ai.forecastTrends({ season, data: bpRes.rows });
    res.json(result);
  } catch (err) {
    logger.error('Forecast route error', err);
    res.status(500).json({ error: err.message, forecasts: [], fallback: true });
  }
});

// GET /api/ai/risks?season=2025-26
router.get('/risks', async (req, res) => {
  try {
    const { season = '2025-26' } = req.query;
    const [bpRes, bdxRes, aRes] = await Promise.all([
      query(`SELECT a.id as athlete_id, a.name, b.test_date, b.test_phase,
                    b.body_fat_pct, b.fat_free_mass_lbs, b.weight_lbs
             FROM bodpod b JOIN athletes a ON a.id = b.athlete_id ORDER BY b.test_date DESC`),
      query(`SELECT a.id as athlete_id, a.name, d.test_date,
                    d.quad_lr_60, d.ham_lr_60, d.quad_lr_120, d.ham_lr_120,
                    d.quad_lr_180, d.ham_lr_180, d.lhq_60, d.rhq_60, d.lr_class, d.hq_class
             FROM biodex d JOIN athletes a ON a.id = d.athlete_id ORDER BY d.test_date DESC`),
      query(`SELECT a.id, a.name, r.training_bucket, r.accommodation
             FROM athletes a LEFT JOIN roster_entries r ON r.athlete_id=a.id AND r.season=$1`,
        [season]),
    ]);
    const result = await ai.scoreRisks({
      season, roster: aRes.rows, BIOPOD: bpRes.rows, biodex: bdxRes.rows
    });
    res.json(result);
  } catch (err) {
    logger.error('Risk route error', err);
    res.status(500).json({ error: err.message, risk_scores: [], fallback: true });
  }
});

// GET /api/ai/summary/:athleteId
router.get('/summary/:athleteId', async (req, res) => {
  try {
    const { athleteId } = req.params;
    const payload = await buildAthletePayload(parseInt(athleteId));
    if (!payload.athlete) return res.status(404).json({ error: 'Athlete not found' });
    const result = await ai.getAthleteSummary(parseInt(athleteId), payload);
    res.json(result);
  } catch (err) {
    logger.error('Summary route error', err);
    res.status(500).json({ error: err.message, fallback: true });
  }
});

// GET /api/ai/team?season=2025-26
router.get('/team', async (req, res) => {
  try {
    const { season = '2025-26' } = req.query;
    const [bpRes, bdxRes, aRes] = await Promise.all([
      query(`SELECT a.name, b.test_date, b.test_phase, b.body_fat_pct, b.fat_free_mass_lbs, b.weight_lbs
             FROM bodpod b JOIN athletes a ON a.id=b.athlete_id WHERE b.season=$1 ORDER BY b.test_date`, [season]),
      query(`SELECT a.name, d.test_date, d.test_phase, d.quad_lr_60, d.ham_lr_60, d.lhq_60, d.rhq_60, d.lr_class
             FROM biodex d JOIN athletes a ON a.id=d.athlete_id WHERE d.season=$1 ORDER BY d.test_date`, [season]),
      query(`SELECT a.name, r.training_bucket, r.accommodation
             FROM athletes a JOIN roster_entries r ON r.athlete_id=a.id AND r.season=$1`, [season]),
    ]);
    const result = await ai.getTeamInsights({
      season, roster: aRes.rows, BIOPOD: bpRes.rows, biodex: bdxRes.rows
    });
    res.json(result);
  } catch (err) {
    logger.error('Team insights route error', err);
    res.status(500).json({ error: err.message, fallback: true });
  }
});

module.exports = router;
