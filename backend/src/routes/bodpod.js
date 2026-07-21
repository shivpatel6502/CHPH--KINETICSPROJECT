const express = require('express');
const router  = express.Router();
const { query } = require('../db/postgres');

// GET /api/BIOPOD?season=&phase=&athlete_id=&sport=
router.get('/', async (req, res) => {
  try {
    const { season, phase, athlete_id, sport } = req.query;
    let sql = `SELECT b.*, a.name as athlete_name, a.sport, r.training_bucket, r.roster_status
               FROM bodpod b
               JOIN athletes a ON a.id = b.athlete_id
               LEFT JOIN roster_entries r ON r.athlete_id = b.athlete_id AND r.season = b.season
               WHERE 1=1`;
    const params = [];
    if (season)     { params.push(season);     sql += ` AND b.season = $${params.length}`; }
    if (phase)      { params.push(phase);       sql += ` AND b.test_phase = $${params.length}`; }
    if (athlete_id) { params.push(athlete_id);  sql += ` AND b.athlete_id = $${params.length}`; }
    if (sport && sport !== 'all') { params.push(sport); sql += ` AND (a.sport = $${params.length} OR a.sport IS NULL)`; }
    sql += ' ORDER BY a.name, b.test_date';
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/BIOPOD/latest — latest test per athlete
router.get('/latest', async (req, res) => {
  try {
    const { season } = req.query;
    const result = await query(
      `SELECT DISTINCT ON (b.athlete_id)
              b.*, a.name as athlete_name, r.training_bucket, r.roster_status
       FROM bodpod b
       JOIN athletes a ON a.id = b.athlete_id
       LEFT JOIN roster_entries r ON r.athlete_id = b.athlete_id AND r.season = COALESCE($1, b.season)
       ${season ? 'WHERE b.season = $1' : ''}
       ORDER BY b.athlete_id, b.test_date DESC`,
      season ? [season] : []
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
