const express = require('express');
const router  = express.Router();
const { query } = require('../db/postgres');

router.get('/', async (req, res) => {
  try {
    const { season, phase, athlete_id } = req.query;
    let sql = `SELECT p.*, a.name as athlete_name FROM performance_tests p
               JOIN athletes a ON a.id=p.athlete_id WHERE 1=1`;
    const params = [];
    if (season)     { params.push(season);    sql += ` AND p.season=$${params.length}`; }
    if (phase)      { params.push(phase);     sql += ` AND p.test_phase=$${params.length}`; }
    if (athlete_id) { params.push(athlete_id);sql += ` AND p.athlete_id=$${params.length}`; }
    sql += ' ORDER BY a.name, p.test_date DESC';
    res.json((await query(sql, params)).rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
