const express = require('express');
const router  = express.Router();
const { query } = require('../db/postgres');

// GET /api/athletes?season=2025-26&sport=Women's Basketball
router.get('/', async (req, res) => {
  try {
    const { season = '2025-26', sport } = req.query;

    // Sport filter — if 'all' or empty, no filter
    const sportFilter = sport && sport !== 'all' ? `AND (a.sport = $1 OR a.sport IS NULL)` : '';
    const params = sport && sport !== 'all' ? [sport] : [];

    // Join roster_entries with fallback: try the requested season first, then any season
    const result = await query(
      `SELECT a.id, a.name, a.position, a.program, a.hometown, a.birthday, a.height_cm,
              a.sport, a.team_gender,
              COALESCE(r_exact.roster_status, r_any.roster_status) as roster_status,
              COALESCE(r_exact.training_bucket, r_any.training_bucket) as training_bucket,
              COALESCE(r_exact.accommodation, r_any.accommodation) as accommodation,
              COALESCE(r_exact.accommodation2, r_any.accommodation2) as accommodation2,
              COALESCE(r_exact.notes, r_any.notes) as notes,
              (SELECT json_build_object('date',b.test_date,'bf',b.body_fat_pct,'ffm',b.fat_free_mass_lbs,'weight',b.weight_lbs)
               FROM bodpod b WHERE b.athlete_id=a.id ORDER BY b.test_date DESC LIMIT 1) as latest_bodpod,
              (SELECT json_build_object('date',d.test_date,'qlr60',d.quad_lr_60,'hlr60',d.ham_lr_60,'lr_class',d.lr_class)
               FROM biodex d WHERE d.athlete_id=a.id ORDER BY d.test_date DESC LIMIT 1) as latest_biodex
       FROM athletes a
       LEFT JOIN roster_entries r_exact ON r_exact.athlete_id=a.id AND r_exact.season=$${params.length + 1}
       LEFT JOIN LATERAL (
         SELECT * FROM roster_entries re WHERE re.athlete_id=a.id ORDER BY re.season DESC LIMIT 1
       ) r_any ON true
       WHERE 1=1 ${sportFilter}
       ORDER BY a.sport, a.name`,
      [...params, season]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/athletes/:id
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [aRes, bpRes, bdxRes, rRes] = await Promise.all([
      query('SELECT * FROM athletes WHERE id=$1', [id]),
      query('SELECT * FROM bodpod WHERE athlete_id=$1 ORDER BY test_date', [id]),
      query('SELECT * FROM biodex WHERE athlete_id=$1 ORDER BY test_date', [id]),
      query('SELECT * FROM roster_entries WHERE athlete_id=$1 ORDER BY season DESC', [id]),
    ]);
    if (!aRes.rows[0]) return res.status(404).json({ error: 'Athlete not found' });
    res.json({ ...aRes.rows[0], BIOPOD: bpRes.rows, biodex: bdxRes.rows, roster: rRes.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
