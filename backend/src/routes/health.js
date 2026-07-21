const express = require('express');
const router  = express.Router();
const { query } = require('../db/postgres');

router.get('/', async (req, res) => {
  try {
    const dbRes = await query('SELECT NOW()');
    res.json({ status: 'ok', db: 'connected', time: dbRes.rows[0].now, env: process.env.NODE_ENV });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'disconnected', error: err.message });
  }
});

module.exports = router;
