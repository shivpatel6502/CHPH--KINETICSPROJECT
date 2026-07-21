/**
 * Seeds the PostgreSQL database with all WBB athlete data
 * Run: node scripts/seed.js
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const ATHLETES = [
  { name:'Maysa Arabi',       position:'Guard',        program:'Human Kinetics',                       hometown:'' },
  { name:'Abby Cullion',      position:'Point Guard',  program:'Human Kinetics',                       hometown:'Belle River, ON', birthday:'2007-06-21', height_cm:168.3 },
  { name:'Mackenzie Fineman', position:'Guard',        program:'Human Kinetics',                       hometown:'Newmarket, ON',   birthday:'2007-07-10', height_cm:168 },
  { name:'Kali Grootenboer',  position:'Forward',      program:'Human Kinetics',                       hometown:'Thunder Bay',      birthday:'2004-10-08', height_cm:194 },
  { name:'Maliyah Ogorek',    position:'Point Guard',  program:'Human Kinetics',                       hometown:'Sarnia, ON',       birthday:'2007-06-30', height_cm:170 },
  { name:'Jodie-Rachel Pierre',position:'Centre',      program:'Arts, Humanities, and Social Sciences',hometown:'Sarnia, ON',       birthday:'2006-03-02', height_cm:183 },
  { name:'Leah Shannon',      position:'Guard',        program:'',                                     hometown:'' },
  { name:'Teighan Stoukas',   position:'Guard',        program:'Human Kinetics',                       hometown:'Corunna',          birthday:'2005-03-22', height_cm:160.5 },
  { name:'Leah Tate',         position:'Guard',        program:'Business',                             hometown:'Windsor',          birthday:'2004-09-07', height_cm:175 },
  { name:'Helena Lasic',      position:'',             program:'',                                     hometown:'' },
  { name:'Tito Akinnusi',     position:'',             program:'',                                     hometown:'' },
  { name:'Mackenzie Marenchin',position:'Guard',       program:'',                                     hometown:'' },
  { name:'Lita Sutor',        position:'Guard',        program:'',                                     hometown:'' },
];

const ROSTER = [
  { name:'Maysa Arabi',        season:'2025-26', status:'Full', bucket:'General',    accom:'',                notes:'' },
  { name:'Abby Cullion',       season:'2025-26', status:'Full', bucket:'Get Right',  accom:'Posterior Chain', notes:'' },
  { name:'Mackenzie Fineman',  season:'2025-26', status:'Full', bucket:'Get Right',  accom:'Posterior Chain', notes:'' },
  { name:'Kali Grootenboer',   season:'2025-26', status:'Full', bucket:'Individual', accom:'',                notes:'Training around In Season Schedule' },
  { name:'Maliyah Ogorek',     season:'2025-26', status:'Full', bucket:'Get Right',  accom:'Posterior Chain', notes:'' },
  { name:'Jodie-Rachel Pierre',season:'2025-26', status:'Full', bucket:'Individual', accom:'Other',           notes:'ADDED HYPERTROPHY WORK' },
  { name:'Leah Shannon',       season:'2025-26', status:'Full', bucket:'General',    accom:'',                notes:'' },
  { name:'Teighan Stoukas',    season:'2025-26', status:'Full', bucket:'Get Right',  accom:'Posterior Chain', notes:'' },
  { name:'Leah Tate',          season:'2025-26', status:'Full', bucket:'Individual', accom:'',                notes:'Limit Lower Body Work' },
  { name:'Helena Lasic',       season:'2026-27', status:'Full', bucket:'General',    accom:'',                notes:"Didn't play this year" },
  { name:'Tito Akinnusi',      season:'2026-27', status:'Full', bucket:'Individual', accom:'',                notes:'Patella Graft complications' },
  { name:'Mackenzie Marenchin',season:'2026-27', status:'Full', bucket:'General',    accom:'',                notes:'Returning from a broken foot' },
  { name:'Lita Sutor',         season:'2026-27', status:'Full', bucket:'General',    accom:'',                notes:'' },
];

const BIOPOD_DATA = [
  { name:'Teighan Stoukas', date:'2024-07-02', season:'2024-25', phase:'Training Camp', w:131.72, bf:0.227, ffm:101.82, h:161 },
  { name:'Teighan Stoukas', date:'2024-09-09', season:'2024-25', phase:'Pre Season',    w:128.6,  bf:0.196, ffm:103.39, h:161 },
  { name:'Teighan Stoukas', date:'2025-07-10', season:'2025-26', phase:'Training Camp', w:128.2,  bf:0.193, ffm:103.46, h:160.5 },
  { name:'Teighan Stoukas', date:'2025-12-03', season:'2025-26', phase:'Mid Season',    w:125.1,  bf:0.164, ffm:104.58, h:null },
  { name:'Teighan Stoukas', date:'2026-04-02', season:'2025-26', phase:'Post Season',   w:126.06, bf:0.179, ffm:103.50, h:160.5 },
  { name:'Abby Cullion',    date:'2025-07-10', season:'2025-26', phase:'Training Camp', w:158.3,  bf:0.216, ffm:124.11, h:168.3 },
  { name:'Abby Cullion',    date:'2025-12-03', season:'2025-26', phase:'Mid Season',    w:164.12, bf:0.271, ffm:119.64, h:null },
  { name:'Abby Cullion',    date:'2026-04-02', season:'2025-26', phase:'Post Season',   w:166.32, bf:0.280, ffm:119.75, h:167 },
  { name:'Mackenzie Fineman',date:'2025-07-10',season:'2025-26', phase:'Training Camp', w:175,    bf:0.285, ffm:125.13, h:168 },
  { name:'Mackenzie Fineman',date:'2025-12-03',season:'2025-26', phase:'Mid Season',    w:173.31, bf:0.280, ffm:124.78, h:null },
  { name:'Mackenzie Fineman',date:'2026-04-02',season:'2025-26', phase:'Post Season',   w:174.9,  bf:0.310, ffm:120.68, h:168 },
  { name:'Kali Grootenboer',date:'2024-07-02', season:'2024-25', phase:'Training Camp', w:231.72, bf:0.227, ffm:179.07, h:193.5 },
  { name:'Kali Grootenboer',date:'2024-09-09', season:'2024-25', phase:'Pre Season',    w:232.2,  bf:0.284, ffm:166.26, h:193.5 },
  { name:'Kali Grootenboer',date:'2025-07-10', season:'2025-26', phase:'Training Camp', w:227.4,  bf:0.270, ffm:165.09, h:194 },
  { name:'Kali Grootenboer',date:'2025-12-03', season:'2025-26', phase:'Mid Season',    w:212.5,  bf:0.225, ffm:164.69, h:null },
  { name:'Kali Grootenboer',date:'2026-04-02', season:'2025-26', phase:'Post Season',   w:215.16, bf:0.236, ffm:164.38, h:194 },
  { name:'Maliyah Ogorek',  date:'2025-07-10', season:'2025-26', phase:'Training Camp', w:125.3,  bf:0.139, ffm:107.88, h:170 },
  { name:'Maliyah Ogorek',  date:'2025-12-03', season:'2025-26', phase:'Mid Season',    w:135.4,  bf:0.139, ffm:116.58, h:null },
  { name:'Maliyah Ogorek',  date:'2026-04-02', season:'2025-26', phase:'Post Season',   w:137.72, bf:0.146, ffm:117.61, h:169.6 },
  { name:'Jodie-Rachel Pierre',date:'2024-07-02',season:'2024-25',phase:'Training Camp',w:170.3,  bf:0.174, ffm:140.71, h:182.5 },
  { name:'Jodie-Rachel Pierre',date:'2024-09-09',season:'2024-25',phase:'Pre Season',   w:170.3,  bf:0.176, ffm:140.33, h:182.5 },
  { name:'Jodie-Rachel Pierre',date:'2025-07-10',season:'2025-26',phase:'Training Camp',w:173.5,  bf:0.150, ffm:147.30, h:183 },
  { name:'Jodie-Rachel Pierre',date:'2025-12-03',season:'2025-26',phase:'Mid Season',   w:170.81, bf:0.175, ffm:140.92, h:null },
  { name:'Jodie-Rachel Pierre',date:'2026-04-02',season:'2025-26',phase:'Post Season',  w:167.86, bf:0.191, ffm:135.80, h:183 },
  { name:'Leah Tate',       date:'2024-07-02', season:'2024-25', phase:'Training Camp', w:160.2,  bf:0.154, ffm:135.53, h:173.5 },
  { name:'Leah Tate',       date:'2024-09-09', season:'2024-25', phase:'Pre Season',    w:155.0,  bf:0.209, ffm:122.61, h:173.5 },
  { name:'Leah Tate',       date:'2025-07-10', season:'2025-26', phase:'Training Camp', w:160.2,  bf:0.150, ffm:135.53, h:174 },
  { name:'Leah Tate',       date:'2025-12-03', season:'2025-26', phase:'Mid Season',    w:151.18, bf:0.140, ffm:130.01, h:null },
  { name:'Leah Tate',       date:'2026-04-02', season:'2025-26', phase:'Post Season',   w:158.18, bf:0.128, ffm:137.93, h:175 },
  { name:'Tito Akinnusi',   date:'2026-05-20', season:'2026-27', phase:'Other',         w:171.105,bf:0.228, ffm:132.09, h:174 },
];

const BIODEX_DATA = [
  { name:'Abby Cullion',       date:'2026-04-30',season:'2025-26',phase:'Post Season',
    ql60:177.3,qr60:143.6,hl60:81.6,hr60:72.9,ql120:145.6,qr120:128,hl120:73.5,hr120:71.2,ql180:112.4,qr180:100.7,hl180:45.4,hr180:43.9,
    qlr60:0.810,hlr60:0.893,qlr120:0.879,hlr120:0.969,qlr180:0.896,hlr180:0.967,
    lhq60:0.460,rhq60:0.508,lhq120:0.505,rhq120:0.556,lhq180:0.404,rhq180:0.436,
    lr_class:'Moderate Imbalance',hq_class:'Moderate Imbalance',priority:'Posterior Chain' },
  { name:'Mackenzie Fineman',  date:'2026-04-30',season:'2025-26',phase:'Post Season',
    ql60:191,qr60:229.5,hl60:98.2,hr60:93.8,ql120:145.3,qr120:171.6,hl120:83,hr120:74.7,ql180:127.2,qr180:121.6,hl180:67,hr180:72.3,
    qlr60:0.832,hlr60:0.955,qlr120:0.847,hlr120:0.900,qlr180:0.956,hlr180:0.927,
    lhq60:0.514,rhq60:0.409,lhq120:0.571,rhq120:0.435,lhq180:0.527,rhq180:0.595,
    lr_class:'Moderate Imbalance',hq_class:'Moderate Imbalance',priority:'Posterior Chain' },
  { name:'Kali Grootenboer',   date:'2026-04-30',season:'2025-26',phase:'Post Season',
    ql60:254.9,qr60:273.7,hl60:133.8,hr60:138.4,ql120:211.1,qr120:211.9,hl120:116.1,hr120:123.2,ql180:174.4,qr180:175.2,hl180:99.9,hr180:99.8,
    qlr60:0.931,hlr60:0.967,qlr120:0.996,hlr120:0.942,qlr180:0.995,hlr180:0.999,
    lhq60:0.525,rhq60:0.506,lhq120:0.550,rhq120:0.581,lhq180:0.573,rhq180:0.570,
    lr_class:'No Imbalance',hq_class:'Moderate Imbalance',priority:'Posterior Chain' },
  { name:'Maliyah Ogorek',     date:'2026-04-30',season:'2025-26',phase:'Post Season',
    ql60:124.6,qr60:138.6,hl60:68.1,hr60:53.4,ql120:120,qr120:113.6,hl120:37.7,hr120:46.5,ql180:103.6,qr180:105.1,hl180:34.2,hr180:24.5,
    qlr60:0.899,hlr60:0.716,qlr120:0.947,hlr120:0.811,qlr180:0.986,hlr180:0.716,
    lhq60:0.547,rhq60:0.385,lhq120:0.314,rhq120:0.409,lhq180:0.330,rhq180:0.233,
    lr_class:'Moderate Imbalance',hq_class:'Moderate Imbalance',priority:'Posterior Chain' },
  { name:'Jodie-Rachel Pierre',date:'2026-04-30',season:'2025-26',phase:'Post Season',
    ql60:166.4,qr60:161.3,hl60:55.7,hr60:81.8,ql120:126.6,qr120:151.6,hl120:44.5,hr120:68.2,ql180:92.2,qr180:85,hl180:10.4,hr180:27.4,
    qlr60:0.969,hlr60:0.681,qlr120:0.835,hlr120:0.652,qlr180:0.922,hlr180:0.380,
    lhq60:0.335,rhq60:0.507,lhq120:0.352,rhq120:0.450,lhq180:0.113,rhq180:0.322,
    lr_class:'Moderate Imbalance',hq_class:'Moderate Imbalance',priority:'Posterior Chain' },
  { name:'Teighan Stoukas',    date:'2026-04-30',season:'2025-26',phase:'Post Season',
    ql60:132.5,qr60:137.5,hl60:73.8,hr60:56.7,ql120:116.1,qr120:123.8,hl120:63.5,hr120:56.4,ql180:99.8,qr180:97.8,hl180:59.9,hr180:55.9,
    qlr60:0.964,hlr60:0.768,qlr120:0.938,hlr120:0.888,qlr180:0.980,hlr180:0.933,
    lhq60:0.557,rhq60:0.412,lhq120:0.547,rhq120:0.456,lhq180:0.600,rhq180:0.572,
    lr_class:'Moderate Imbalance',hq_class:'Moderate Imbalance',priority:'Posterior Chain' },
  { name:'Teighan Stoukas',    date:'2025-09-04',season:'2025-26',phase:'Pre Season',
    ql60:97.6,qr60:111.2,hl60:110.2,hr60:147.9,ql120:88.1,qr120:101,hl120:67.4,hr120:75.2,ql180:85.3,qr180:94.9,hl180:36.3,hr180:39.9,
    qlr60:0.878,hlr60:0.745,qlr120:0.872,hlr120:0.896,qlr180:0.899,hlr180:0.910,
    lhq60:1.129,rhq60:1.330,lhq120:0.765,rhq120:0.745,lhq180:0.426,rhq180:0.420,
    lr_class:'Monitoring',hq_class:'Monitoring',priority:'Posterior Chain' },
  { name:'Tito Akinnusi',      date:'2026-05-20',season:'2026-27',phase:'Other',
    ql60:182.4,qr60:235.1,hl60:104.8,hr60:104.7,ql120:158.4,qr120:206.2,hl120:93.6,hr120:97.5,ql180:128.3,qr180:162,hl180:80.8,hr180:86,
    qlr60:0.776,hlr60:0.999,qlr120:0.768,hlr120:0.960,qlr180:0.792,hlr180:0.940,
    lhq60:0.575,rhq60:0.445,lhq120:0.591,rhq120:0.473,lhq180:0.630,rhq180:0.531,
    lr_class:'Moderate Imbalance',hq_class:'Moderate Imbalance',priority:'Posterior Chain' },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('Seeding athletes...');
    const idMap = {};
    for (const a of ATHLETES) {
      const r = await client.query(
        `INSERT INTO athletes(name,position,program,hometown,birthday,height_cm)
         VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT(name) DO UPDATE SET position=EXCLUDED.position
         RETURNING id`,
        [a.name, a.position||null, a.program||null, a.hometown||null, a.birthday||null, a.height_cm||null]
      );
      idMap[a.name] = r.rows[0].id;
    }
    console.log('Seeding roster entries...');
    for (const r of ROSTER) {
      await client.query(
        `INSERT INTO roster_entries(athlete_id,season,roster_status,training_bucket,accommodation,notes)
         VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT(athlete_id,season) DO UPDATE SET training_bucket=EXCLUDED.training_bucket`,
        [idMap[r.name], r.season, r.status, r.bucket, r.accom, r.notes]
      );
    }
    console.log('Seeding BIOPOD data...');
    for (const b of BIOPOD_DATA) {
      await client.query(
        `INSERT INTO bodpod(athlete_id,test_date,season,test_phase,weight_lbs,body_fat_pct,fat_free_mass_lbs,height_cm)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT DO NOTHING`,
        [idMap[b.name], b.date, b.season, b.phase, b.w, b.bf, b.ffm, b.h]
      );
    }
    console.log('Seeding Biodex data...');
    for (const b of BIODEX_DATA) {
      await client.query(
        `INSERT INTO biodex(athlete_id,test_date,season,test_phase,
          quad_l_60,quad_r_60,ham_l_60,ham_r_60,quad_l_120,quad_r_120,ham_l_120,ham_r_120,
          quad_l_180,quad_r_180,ham_l_180,ham_r_180,
          quad_lr_60,ham_lr_60,quad_lr_120,ham_lr_120,quad_lr_180,ham_lr_180,
          lhq_60,rhq_60,lhq_120,rhq_120,lhq_180,rhq_180,
          lr_class,hq_class,training_priority)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
         ON CONFLICT DO NOTHING`,
        [idMap[b.name],b.date,b.season,b.phase,
         b.ql60,b.qr60,b.hl60,b.hr60,b.ql120,b.qr120,b.hl120,b.hr120,
         b.ql180,b.qr180,b.hl180,b.hr180,
         b.qlr60,b.hlr60,b.qlr120,b.hlr120,b.qlr180,b.hlr180,
         b.lhq60,b.rhq60,b.lhq120,b.rhq120,b.lhq180,b.rhq180,
         b.lr_class,b.hq_class,b.priority]
      );
    }
    await client.query('COMMIT');
    console.log('✅  Seed complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌  Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
