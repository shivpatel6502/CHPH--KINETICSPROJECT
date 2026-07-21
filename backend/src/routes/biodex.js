const express = require('express');
const router  = express.Router();
const { query } = require('../db/postgres');

router.get('/', async (req, res) => {
  try {
    const { season, phase, athlete_id, sport } = req.query;
    let sql = `SELECT d.*, a.name as athlete_name, a.sport, r.training_bucket
               FROM biodex d
               JOIN athletes a ON a.id = d.athlete_id
               LEFT JOIN roster_entries r ON r.athlete_id = d.athlete_id AND r.season = d.season
               WHERE 1=1`;
    const params = [];
    if (season)     { params.push(season);    sql += ` AND d.season=$${params.length}`; }
    if (phase)      { params.push(phase);     sql += ` AND d.test_phase=$${params.length}`; }
    if (athlete_id) { params.push(athlete_id);sql += ` AND d.athlete_id=$${params.length}`; }
    if (sport && sport !== 'all') { params.push(sport); sql += ` AND (a.sport = $${params.length} OR a.sport IS NULL)`; }
    sql += ' ORDER BY a.name, d.test_date DESC';
    res.json((await query(sql, params)).rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/latest', async (req, res) => {
  try {
    const { season } = req.query;
    const result = await query(
      `SELECT DISTINCT ON (d.athlete_id) d.*, a.name as athlete_name
       FROM biodex d JOIN athletes a ON a.id=d.athlete_id
       ${season ? 'WHERE d.season=$1' : ''}
       ORDER BY d.athlete_id, d.test_date DESC`,
      season ? [season] : []
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
