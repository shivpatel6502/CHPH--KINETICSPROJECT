/**
 * POST /api/upload
 * Accepts one or more PDFs (field name: "pdfs"), runs Python extractor,
 * previews extracted data, and optionally imports into PostgreSQL.
 *
 * POST /api/upload/import/:uploadId
 * Confirms import of a previously uploaded-but-not-imported PDF.
 *
 * GET /api/upload/history
 * Returns recent upload history.
 */
const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { spawn } = require('child_process');
const { query } = require('../db/postgres');
const logger   = require('../utils/logger');

const router = express.Router();

// ── Multer storage ────────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ts  = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `${ts}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are accepted'));
    }
  },
});

// ── Python extractor helper ────────────────────────────────────────────────────
function runExtractor(pdfPath) {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, '..', '..', 'scripts', 'extract_pdf.py');
    const proc   = spawn('python3', [script, pdfPath]);
    let stdout   = '';
    let stderr   = '';

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`Extractor exited ${code}: ${stderr.slice(0, 300)}`));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`Failed to parse extractor output: ${stdout.slice(0, 200)}`));
      }
    });

    proc.on('error', err => reject(new Error(`Could not start Python: ${err.message}`)));

    // 30 second timeout
    setTimeout(() => {
      proc.kill();
      reject(new Error('Extractor timed out after 30s'));
    }, 30000);
  });
}

// ── Athlete name resolution ────────────────────────────────────────────────────
async function resolveAthlete(extractedName, sport) {
  if (!extractedName) return null;

  const clean = extractedName.trim();

  // 1. Exact match (case-insensitive)
  const exact = await query(
    'SELECT id, name FROM athletes WHERE LOWER(name) = LOWER($1)', [clean]
  );
  if (exact.rows[0]) return exact.rows[0];

  // 2. All athletes — score each one against the extracted name
  const all = await query('SELECT id, name FROM athletes ORDER BY name');
  if (!all.rows.length) return null;

  const nameParts = clean.toLowerCase().split(/[\s,\.]+/).filter(Boolean);

  let bestMatch = null;
  let bestScore = 0;

  for (const row of all.rows) {
    const dbParts = row.name.toLowerCase().split(/\s+/).filter(Boolean);
    let score = 0;

    for (const part of nameParts) {
      if (part.length < 2) continue; // skip initials like "A"
      for (const dbPart of dbParts) {
        if (dbPart === part) score += 10;           // exact token match
        else if (dbPart.startsWith(part)) score += 5; // prefix match (e.g. "L." → "Leah")
        else if (part.startsWith(dbPart)) score += 3;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = row;
    }
  }

  // Only return a match if it has a meaningful score (at least one real token matched)
  return bestScore >= 5 ? bestMatch : null;
}

// ── Import helpers ─────────────────────────────────────────────────────────────
async function importBiodex(uploadId, extracted, athleteId, testDate, sport, phase, season) {
  const h   = extracted.header || {};
  const wkg = h.weight_kg || null;
  const hcm = h.height_cm || null;

  await query(
    `INSERT INTO biodex(
       athlete_id, test_date, season, test_phase, weight_kg, height_cm,
       quad_l_60, quad_r_60, ham_l_60, ham_r_60,
       quad_l_120, quad_r_120, ham_l_120, ham_r_120,
       quad_l_180, quad_r_180, ham_l_180, ham_r_180,
       quad_lr_60, ham_lr_60, quad_lr_120, ham_lr_120, quad_lr_180, ham_lr_180,
       lhq_60, rhq_60, lhq_120, rhq_120, lhq_180, rhq_180,
       lr_class, hq_class, raw_sets_json, upload_id
     ) VALUES (
       $1,$2,$3,$4,$5,$6,
       $7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
       $19,$20,$21,$22,$23,$24,
       $25,$26,$27,$28,$29,$30,
       $31,$32,$33,$34
     ) ON CONFLICT DO NOTHING`,
    [
      athleteId, testDate, season, phase, wkg, hcm,
      extracted.quad_l_60,   extracted.quad_r_60,   extracted.ham_l_60,   extracted.ham_r_60,
      extracted.quad_l_120,  extracted.quad_r_120,  extracted.ham_l_120,  extracted.ham_r_120,
      extracted.quad_l_180,  extracted.quad_r_180,  extracted.ham_l_180,  extracted.ham_r_180,
      extracted.quad_lr_60,  extracted.ham_lr_60,   extracted.quad_lr_120, extracted.ham_lr_120,
      extracted.quad_lr_180, extracted.ham_lr_180,
      extracted.lhq_60,  extracted.rhq_60,  extracted.lhq_120, extracted.rhq_120,
      extracted.lhq_180, extracted.rhq_180,
      extracted.lr_class || null, extracted.hq_class || null,
      JSON.stringify(extracted.sets || []),
      uploadId,
    ]
  );
}

async function importBodpod(uploadId, extracted, athleteId, testDate, sport, phase, season) {
  const wLbs  = extracted.weight_lbs  || null;
  const ffmLbs = extracted.fat_free_mass_lbs || null;
  const bfPct  = extracted.body_fat_pct || null;
  const hcm    = (extracted.header || {}).height_cm || null;

  await query(
    `INSERT INTO bodpod(
       athlete_id, test_date, season, test_phase,
       weight_lbs, body_fat_pct, fat_free_mass_lbs, height_cm,
       fat_mass_kg, fat_free_mass_kg, body_density, tgv,
       ree_kcal, tee_kcal, activity_level, upload_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT DO NOTHING`,
    [
      athleteId, testDate, season, phase,
      wLbs, bfPct, ffmLbs, hcm,
      extracted.fat_mass_kg    || null,
      extracted.fat_free_mass_kg || null,
      extracted.body_density   || null,
      extracted.tgv            || null,
      extracted.ree_kcal       || null,
      extracted.tee_kcal       || null,
      extracted.activity_level || null,
      uploadId,
    ]
  );
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// POST /api/upload — upload + extract (returns preview, does NOT import yet)
router.post('/', upload.array('pdfs', 10), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No PDF files received' });
  }

  const results = [];

  for (const file of req.files) {
    let extracted = null;
    let status    = 'pending';
    let errorMsg  = null;

    try {
      extracted = await runExtractor(file.path);
      if (extracted.error) {
        status   = 'error';
        errorMsg = extracted.error;
      }
    } catch (err) {
      status   = 'error';
      errorMsg = err.message;
      logger.error('PDF extraction error', { file: file.originalname, error: err.message });
    }

    // Resolve athlete name from extracted data
    const extractedName = extracted?.header?.patient_name || null;
    const nameSource    = extracted?.header?.name_source  || 'pdf';
    const athlete = extractedName ? await resolveAthlete(extractedName, req.body.sport) : null;

    // Store in pdf_uploads
    const uploadRes = await query(
      `INSERT INTO pdf_uploads(original_name, stored_path, pdf_type, athlete_id, athlete_name,
        test_date, extracted_json, status, error_msg)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        file.originalname,
        file.path,
        extracted?.type || 'unknown',
        athlete?.id || null,
        extractedName,
        extracted?.header?.test_date || null,
        extracted ? JSON.stringify(extracted) : null,
        status,
        errorMsg,
      ]
    );

    const uploadId = uploadRes.rows[0].id;

    results.push({
      upload_id:      uploadId,
      file_name:      file.originalname,
      pdf_type:       extracted?.type || 'unknown',
      status,
      error:          errorMsg,
      athlete_name:   extractedName,
      name_source:    nameSource,
      athlete_match:  athlete ? { id: athlete.id, name: athlete.name } : null,
      test_date:      extracted?.header?.test_date || null,
      preview:        extracted,
    });
  }

  res.json({ uploads: results });
});

// POST /api/upload/import/:uploadId — confirm import into BIOPOD / biodex tables
router.post('/import/:uploadId', async (req, res) => {
  const { uploadId } = req.params;
  const {
    athlete_id,
    athlete_name,
    test_date,
    season   = '2025-26',
    phase    = 'Other',
    sport    = "Women's Basketball",
    create_athlete = false,
  } = req.body;

  try {
    // Fetch upload record
    const upRes = await query('SELECT * FROM pdf_uploads WHERE id=$1', [uploadId]);
    if (!upRes.rows[0]) return res.status(404).json({ error: 'Upload not found' });

    const up       = upRes.rows[0];
    const extracted = up.extracted_json;

    if (!extracted || up.status === 'error') {
      return res.status(400).json({ error: 'Upload has extraction errors — cannot import' });
    }

    let finalAthleteId = athlete_id ? parseInt(athlete_id) : null;

    // Create athlete if requested and not found
    if (!finalAthleteId && create_athlete && athlete_name) {
      const [gender, ...sportParts] = sport.split("'s ");
      const newA = await query(
        `INSERT INTO athletes(name, sport, team_gender)
         VALUES($1, $2, $3)
         ON CONFLICT(name) DO UPDATE SET sport=EXCLUDED.sport
         RETURNING id`,
        [athlete_name, sport, gender || 'Women']
      );
      finalAthleteId = newA.rows[0].id;
    }

    if (!finalAthleteId) {
      return res.status(400).json({
        error: 'No athlete_id provided. Pass create_athlete=true with athlete_name to auto-create.',
      });
    }

    const finalDate = test_date || up.test_date || new Date().toISOString().slice(0, 10);

    if (extracted.type === 'biodex') {
      await importBiodex(parseInt(uploadId), extracted, finalAthleteId, finalDate, sport, phase, season);
    } else if (extracted.type === 'bodpod') {
      await importBodpod(parseInt(uploadId), extracted, finalAthleteId, finalDate, sport, phase, season);
    } else {
      return res.status(400).json({ error: `Unknown PDF type: ${extracted.type}` });
    }

    // Mark as imported
    await query(
      `UPDATE pdf_uploads SET status='imported', athlete_id=$1, athlete_name=$2, imported_at=NOW()
       WHERE id=$3`,
      [finalAthleteId, athlete_name, uploadId]
    );

    // Auto-create roster entry for this season so athlete appears in all views
    await query(
      `INSERT INTO roster_entries(athlete_id, season, sport, roster_status)
       VALUES($1, $2, $3, 'Full')
       ON CONFLICT(athlete_id, season) DO NOTHING`,
      [finalAthleteId, season, sport]
    );

    res.json({ success: true, upload_id: uploadId, athlete_id: finalAthleteId });
  } catch (err) {
    logger.error('Import error', { uploadId, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/upload/history
router.get('/history', async (req, res) => {
  try {
    const { limit = 50, status } = req.query;
    const conditions = status ? [`status = '${status}'`] : [];
    const where      = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const result     = await query(
      `SELECT id, original_name, pdf_type, athlete_name,
              TO_CHAR(test_date, 'YYYY-MM-DD') as test_date,
              status, error_msg,
              TO_CHAR(uploaded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') as uploaded_at,
              TO_CHAR(imported_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') as imported_at
       FROM pdf_uploads ${where}
       ORDER BY uploaded_at DESC LIMIT $1`,
      [parseInt(limit)]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/upload/sports — return all sports for filter dropdowns
router.get('/sports', async (req, res) => {
  res.json({
    sports: [
      { id: "Women's Basketball", gender: 'Women',  category: 'Basketball' },
      { id: "Women's Volleyball", gender: 'Women',  category: 'Volleyball' },
      { id: "Women's Soccer",     gender: 'Women',  category: 'Soccer'     },
      { id: "Women's Hockey",     gender: 'Women',  category: 'Hockey'     },
      { id: "Men's Basketball",   gender: 'Men',    category: 'Basketball' },
      { id: "Men's Volleyball",   gender: 'Men',    category: 'Volleyball' },
      { id: "Men's Soccer",       gender: 'Men',    category: 'Soccer'     },
      { id: "Men's Hockey",       gender: 'Men',    category: 'Hockey'     },
      { id: 'Football',           gender: 'Mixed',  category: 'Football'   },
      { id: 'Baseball',           gender: 'Mixed',  category: 'Baseball'   },
      { id: 'Softball',           gender: 'Mixed',  category: 'Softball'   },
    ],
  });
});

module.exports = router;
