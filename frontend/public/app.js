/* ============================================================
   WBB CHPH Analytics Dashboard — Frontend App
   All AI calls go through /api/ai/* (never client-side)
   ============================================================ */

// Auto-detect API base URL:
//   - file:// → local backend on port 3001
//   - custom domain / Render / Localtunnel → relative /api
const _isLocal   = window.location.protocol === 'file:';
const API = _isLocal ? 'http://localhost:3001/api' : '/api';

// Wrapped fetch: if API is null (GitHub Pages demo mode) always throw so fallbacks kick in
async function apiFetch(path, opts = {}) {
  if (!API) throw new Error('demo-mode');
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

// ── State ─────────────────────────────────────────────────
const STATE = {
  athletes: [], BIOPOD: [], biodex: [],
  aiRisks: null, aiAnomalies: null, aiForecasts: null,
  aiSummaries: {},
  filters: { season: '2025-26', phase: 'all', bucket: 'all' },
  activePage: 'overview',
  biodexSpeed: 60,
  charts: {},
  recentImports: [],
};

// ── Chart palette (color-blind safe) ──────────────────────
const PALETTE = [
  '#c8a84b','#4b8ec8','#68d391','#f687b3',
  '#b794f4','#76e4f7','#f6ad55','#fc8181',
  '#90cdf4','#fbd38d','#9ae6b4','#e9d8fd','#fed7d7'
];

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#7a8299', font: { size: 11, family: 'Inter' }, padding: 12 } },
    tooltip: {
      backgroundColor: '#1a1d2e', titleColor: '#c8a84b',
      bodyColor: '#e8eaf0', borderColor: '#2a2f4a', borderWidth: 1,
      padding: 10, cornerRadius: 8,
    },
  },
  scales: {
    x: { ticks: { color: '#7a8299', font: { size: 11 } }, grid: { color: '#2a2f4a55' } },
    y: { ticks: { color: '#7a8299', font: { size: 11 } }, grid: { color: '#2a2f4a55' } },
  },
};

// ── Helpers ────────────────────────────────────────────────
const fmtPct = v => v != null ? (v * 100).toFixed(1) + '%' : '—';
const fmtNum = (v, d = 1) => v != null ? (+v).toFixed(d) : '—';
const initials = n => n.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

function flagBF(bf) {
  if (!bf) return 'nodata';
  if (bf > 0.25) return 'concern';
  if (bf >= 0.20) return 'monitoring';
  return 'noconcern';
}
function flagLR(ratio) {
  if (ratio == null) return 'nodata';
  if (ratio < 0.80) return 'concern';
  if (ratio < 0.90) return 'monitoring';
  return 'noconcern';
}
function combinedFlag(bfFlag, lrFlag) {
  const rank = { concern: 2, monitoring: 1, noconcern: 0, nodata: -1 };
  const top = rank[bfFlag] >= rank[lrFlag] ? bfFlag : lrFlag;
  return top === 'nodata' ? 'nodata' : top;
}
function badgeHtml(flag) {
  const map = {
    concern: ['badge-concern', 'Concern'],
    monitoring: ['badge-monitoring', 'Monitoring'],
    noconcern: ['badge-noconcern', 'No Concern'],
    nodata: ['badge-nodata', 'No Data'],
  };
  const [cls, label] = map[flag] || map.nodata;
  return `<span class="badge ${cls}">${label}</span>`;
}
function scoreColor(score) {
  if (score >= 75) return '#e53e3e';
  if (score >= 50) return '#dd6b20';
  if (score >= 25) return '#c8a84b';
  return '#38a169';
}

function mkChart(id, config) {
  if (STATE.charts[id]) STATE.charts[id].destroy();
  const ctx = document.getElementById(id);
  if (!ctx) return null;
  const chart = new Chart(ctx, config);
  STATE.charts[id] = chart;
  return chart;
}

// ── Toast ──────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 4000) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', ai: '🤖' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function setLoadingStatus(msg) {
  const el = document.getElementById('loadingStatus');
  if (el) el.textContent = msg;
}

function showAIBar(show) {
  document.getElementById('aiLoadingBar').classList.toggle('hidden', !show);
}

// ── Table sort ─────────────────────────────────────────────
document.addEventListener('click', e => {
  const th = e.target.closest('th[data-sort]');
  if (!th) return;
  const tbody = th.closest('table').querySelector('tbody');
  const idx = +th.dataset.col;
  const asc = th.classList.toggle('asc');
  th.closest('thead').querySelectorAll('th').forEach(t => {
    if (t !== th) t.classList.remove('asc', 'desc');
  });
  th.classList.toggle('desc', !asc);
  const rows = [...tbody.querySelectorAll('tr')];
  rows.sort((a, b) => {
    const va = a.cells[idx]?.textContent.trim() || '';
    const vb = b.cells[idx]?.textContent.trim() || '';
    const na = parseFloat(va), nb = parseFloat(vb);
    if (!isNaN(na) && !isNaN(nb)) return asc ? na - nb : nb - na;
    return asc ? va.localeCompare(vb) : vb.localeCompare(va);
  });
  rows.forEach(r => tbody.appendChild(r));
});

// ── Page switching ─────────────────────────────────────────
function switchPage(btn) {
  const page = btn.dataset.page;
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.remove('hidden');
  btn.classList.add('active');
  STATE.activePage = page;
  if (page === 'overview')  renderOverview();
  if (page === 'BIOPOD')    renderBIOPOD();
  if (page === 'biodex')    renderBiodex();
  if (page === 'forecast')  renderForecast();
  if (page === 'watchlist') renderWatchlist();
  if (page === 'upload')    loadUploadHistory();
  if (page === 'compare')   { renderComparison(); renderSportComparison(); }
}

function applyFilters() {
  STATE.filters.season = document.getElementById('fSeason').value;
  STATE.filters.phase  = document.getElementById('fPhase').value;
  STATE.filters.bucket = document.getElementById('fBucket').value;
  STATE.filters.sport  = document.getElementById('fSport')?.value || 'all';
  if (STATE.activePage === 'overview') renderOverview();
  if (STATE.activePage === 'BIOPOD')   renderBIOPOD();
  if (STATE.activePage === 'biodex')   renderBiodex();
}

// ── Filtered data helpers ──────────────────────────────────
function filteredBIOPOD() {
  return STATE.BIOPOD.filter(r => {
    if (STATE.filters.season !== 'all' && r.season !== STATE.filters.season) return false;
    if (STATE.filters.phase  !== 'all' && r.test_phase !== STATE.filters.phase) return false;
    if (STATE.filters.bucket !== 'all' && !String(r.training_bucket || '').includes(STATE.filters.bucket)) return false;
    return true;
  });
}
function filteredBiodex() {
  return STATE.biodex.filter(r => {
    if (STATE.filters.season !== 'all' && r.season !== STATE.filters.season) return false;
    if (STATE.filters.phase  !== 'all' && r.test_phase !== STATE.filters.phase) return false;
    return true;
  });
}
function latestBP(name) {
  return [...STATE.BIOPOD].filter(r => r.athlete_name === name)
    .sort((a, b) => b.test_date.localeCompare(a.test_date))[0] || null;
}
function latestBDX(name) {
  return [...STATE.biodex].filter(r => r.athlete_name === name)
    .sort((a, b) => b.test_date.localeCompare(a.test_date))[0] || null;
}

// ── Overview Page ──────────────────────────────────────────
function renderOverview() {
  renderScorecards();
  renderBFChart();
  renderRiskPie();
  renderFFMChart();
  renderQuadLRChart();
  renderTeamCards();
  loadAnomalies();
  loadTeamInsight();
  renderLatestDataAttached();
}

function renderLatestDataAttached() {
  const el = document.getElementById('latestDataAttachedBody');
  if (!el) return;
  const latestBP = STATE.BIOPOD.map(r => ({ ...r, type: 'BOD POD', icon: '⚖️' }));
  const latestBdx = STATE.biodex.map(r => ({ ...r, type: 'Biodex', icon: '💪' }));
  const combined = [...latestBP, ...latestBdx].sort((a, b) => b.test_date.localeCompare(a.test_date)).slice(0, 10);
  
  if (!combined.length) {
    el.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#7a8299;padding:20px">No recent data attached...</td></tr>';
    return;
  }
  
  el.innerHTML = combined.map(r => {
    const isRecent = STATE.recentImports.some(ri => ri.name === r.athlete_name);
    return `<tr>
      <td style="padding:8px 10px;color:#e8eaf0">${isRecent ? '<span style="color:#c8a84b;margin-right:6px">✨</span>' : ''}<strong>${r.athlete_name}</strong></td>
      <td style="padding:8px 10px;color:#b8bcd0">${r.icon} ${r.type}</td>
      <td style="padding:8px 10px;color:#b8bcd0">${r.test_date}</td>
      <td style="padding:8px 10px;color:#68d391"><span class="status-pill imported">Attached</span></td>
    </tr>`;
  }).join('');
}

function renderScorecards() {
  const latest = STATE.athletes.map(a => ({
    a, bp: latestBP(a.name), bdx: latestBDX(a.name)
  }));
  const concerns   = latest.filter(({ bp, bdx }) => combinedFlag(flagBF(bp?.body_fat_pct), flagLR(bdx?.quad_lr_60)) === 'concern').length;
  const monitoring = latest.filter(({ bp, bdx }) => combinedFlag(flagBF(bp?.body_fat_pct), flagLR(bdx?.quad_lr_60)) === 'monitoring').length;
  const bpRows = filteredBIOPOD();
  const avgBF  = bpRows.length ? (bpRows.reduce((s, r) => s + (r.body_fat_pct || 0), 0) / bpRows.length * 100).toFixed(1) : '—';
  const avgLR  = STATE.biodex.length ? (STATE.biodex.reduce((s, r) => s + (r.quad_lr_60 || 0), 0) / STATE.biodex.filter(r => r.quad_lr_60).length * 100).toFixed(1) : '—';

  document.getElementById('overviewScorecards').innerHTML = `
    <div class="scorecard"><div class="scorecard-label">Active Athletes</div>
      <div class="scorecard-value">${STATE.athletes.length}<span class="scorecard-unit">athletes</span></div>
      <div class="scorecard-change c-muted">2025–26 Season</div></div>
    <div class="scorecard" style="border-top-color:var(--danger)"><div class="scorecard-label">Risk: Concern</div>
      <div class="scorecard-value c-danger">${concerns}<span class="scorecard-unit">athletes</span></div>
      <div class="scorecard-change c-danger">Require immediate attention</div></div>
    <div class="scorecard" style="border-top-color:var(--warning)"><div class="scorecard-label">Monitoring</div>
      <div class="scorecard-value c-warning">${monitoring}<span class="scorecard-unit">athletes</span></div>
      <div class="scorecard-change c-warning">Being watched</div></div>
    <div class="scorecard"><div class="scorecard-label">Team Avg BF%</div>
      <div class="scorecard-value">${avgBF}<span class="scorecard-unit">%</span></div>
      <div class="scorecard-change c-muted">Current filtered view</div></div>`;
}

function renderBFChart() {
  const data = STATE.athletes.map(a => ({ name: a.name, bp: latestBP(a.name) }))
    .filter(d => d.bp).sort((a, b) => b.bp.body_fat_pct - a.bp.body_fat_pct);
  mkChart('ov_bfChart', {
    type: 'bar',
    data: {
      labels: data.map(d => d.name.split(' ').slice(-1)[0]),
      datasets: [{
        label: 'Body Fat %', borderRadius: 6,
        data: data.map(d => +(d.bp.body_fat_pct * 100).toFixed(1)),
        backgroundColor: data.map(d => d.bp.body_fat_pct > 0.25 ? '#e53e3e88' : d.bp.body_fat_pct >= 0.20 ? '#dd6b2088' : '#38a16988'),
        borderColor:     data.map(d => d.bp.body_fat_pct > 0.25 ? '#e53e3e'   : d.bp.body_fat_pct >= 0.20 ? '#dd6b20'   : '#38a169'),
        borderWidth: 2,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: { ...CHART_DEFAULTS.plugins,
        annotation: { annotations: {
          l1: { type: 'line', yMin: 25, yMax: 25, borderColor: '#e53e3e', borderWidth: 1, borderDash: [5, 4], label: { display: true, content: 'Concern 25%', color: '#e53e3e', font: { size: 10 }, position: 'end', backgroundColor: 'transparent' } },
          l2: { type: 'line', yMin: 20, yMax: 20, borderColor: '#dd6b20', borderWidth: 1, borderDash: [5, 4] },
        }},
      },
    },
  });
}

function renderRiskPie() {
  const counts = { Concern: 0, Monitoring: 0, 'No Concern': 0, 'No Data': 0 };
  STATE.athletes.forEach(a => {
    const bp = latestBP(a.name), bdx = latestBDX(a.name);
    const f = combinedFlag(flagBF(bp?.body_fat_pct), flagLR(bdx?.quad_lr_60));
    const k = f === 'concern' ? 'Concern' : f === 'monitoring' ? 'Monitoring' : f === 'noconcern' ? 'No Concern' : 'No Data';
    counts[k]++;
  });
  mkChart('ov_riskPie', {
    type: 'doughnut',
    data: {
      labels: Object.keys(counts),
      datasets: [{ data: Object.values(counts), backgroundColor: ['#e53e3e88','#dd6b2088','#38a16988','#4b8ec888'], borderColor: ['#e53e3e','#dd6b20','#38a169','#4b8ec8'], borderWidth: 2 }],
    },
    options: { ...CHART_DEFAULTS, cutout: '62%', plugins: { ...CHART_DEFAULTS.plugins, legend: { position: 'bottom', labels: { color: '#7a8299', padding: 14, font: { size: 11 } } } } },
  });
}

function renderFFMChart() {
  const data = STATE.athletes.map(a => ({ name: a.name, bp: latestBP(a.name) }))
    .filter(d => d.bp).sort((a, b) => b.bp.fat_free_mass_lbs - a.bp.fat_free_mass_lbs);
  mkChart('ov_ffmChart', {
    type: 'bar',
    data: {
      labels: data.map(d => d.name.split(' ').slice(-1)[0]),
      datasets: [{ label: 'Fat Free Mass (lb)', data: data.map(d => +d.bp.fat_free_mass_lbs.toFixed(1)), backgroundColor: '#4b8ec888', borderColor: '#4b8ec8', borderWidth: 2, borderRadius: 6 }],
    },
    options: CHART_DEFAULTS,
  });
}

function renderQuadLRChart() {
  const bdx = Object.values(STATE.biodex.reduce((m, r) => {
    if (!m[r.athlete_name] || r.test_date > m[r.athlete_name].test_date) m[r.athlete_name] = r;
    return m;
  }, {}));
  mkChart('ov_quadLR', {
    type: 'bar',
    data: {
      labels: bdx.map(r => r.athlete_name.split(' ').slice(-1)[0]),
      datasets: [{
        label: 'Quad L:R 60°',
        data: bdx.map(r => r.quad_lr_60 != null ? +(r.quad_lr_60 * 100).toFixed(1) : null),
        backgroundColor: bdx.map(r => r.quad_lr_60 < 0.80 ? '#e53e3e88' : r.quad_lr_60 < 0.90 ? '#dd6b2088' : '#38a16988'),
        borderColor:     bdx.map(r => r.quad_lr_60 < 0.80 ? '#e53e3e'   : r.quad_lr_60 < 0.90 ? '#dd6b20'   : '#38a169'),
        borderWidth: 2, borderRadius: 6,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, min: 60, max: 110, title: { display: true, text: 'L:R %', color: '#7a8299' } } },
      plugins: { ...CHART_DEFAULTS.plugins, annotation: { annotations: {
        l1: { type: 'line', yMin: 80, yMax: 80, borderColor: '#e53e3e', borderWidth: 1, borderDash: [5, 4] },
        l2: { type: 'line', yMin: 90, yMax: 90, borderColor: '#dd6b20', borderWidth: 1, borderDash: [5, 4] },
      }}},
    },
  });
}

function renderTeamCards() {
  const html = STATE.athletes.map(a => {
    const bp = latestBP(a.name), bdx = latestBDX(a.name);
    const bfF = flagBF(bp?.body_fat_pct);
    const lrF = flagLR(bdx?.quad_lr_60);
    const cf  = combinedFlag(bfF, lrF);
    return `<div class="athlete-card ${cf}" onclick="openAthleteModal('${a.name.replace(/'/g, "\\'")}')">
      ${badgeHtml(cf)}
      <div class="ac-name">${a.name}</div>
      <div class="ac-sub">${a.position || a.training_bucket || '—'} · ${a.training_bucket || '—'}</div>
      <div class="ac-stats">
        <div><div class="ac-stat-label">Body Fat</div><div class="ac-stat-val" style="color:var(--${bfF === 'concern' ? 'danger' : bfF === 'monitoring' ? 'warning' : 'success'})">${bp ? fmtPct(bp.body_fat_pct) : '—'}</div></div>
        <div><div class="ac-stat-label">FFM (lb)</div><div class="ac-stat-val">${bp ? fmtNum(bp.fat_free_mass_lbs) : '—'}</div></div>
        <div><div class="ac-stat-label">Quad L:R</div><div class="ac-stat-val" style="color:var(--${lrF === 'concern' ? 'danger' : lrF === 'monitoring' ? 'warning' : 'success'})">${bdx ? fmtPct(bdx.quad_lr_60) : '—'}</div></div>
        <div><div class="ac-stat-label">Ham L:R</div><div class="ac-stat-val">${bdx ? fmtPct(bdx.ham_lr_60) : '—'}</div></div>
      </div>
    </div>`;
  }).join('');
  document.getElementById('teamCards').innerHTML = html;
}

// ── AI: Anomalies ──────────────────────────────────────────
async function loadAnomalies() {
  const el = document.getElementById('anomalyContent');
  el.innerHTML = '<div style="color:var(--muted);padding:20px;text-align:center">🤖 Analyzing data for anomalies...</div>';
  showAIBar(true);
  try {
    const data = await apiFetch(`/ai/anomalies?season=${STATE.filters.season}`);
    STATE.aiAnomalies = data;
    if (data.fallback) { el.innerHTML = '<div style="color:var(--muted);padding:20px">AI service unavailable — showing cached or fallback data.</div>'; return; }
    const anomalies = data.anomalies || [];
    if (!anomalies.length) { el.innerHTML = '<div style="color:var(--success);padding:20px">✅ No significant anomalies detected for this period.</div>'; return; }
    el.innerHTML = anomalies.map(a => `
      <div class="anomaly-card ${a.flag_level}">
        <div class="anomaly-name">${a.athlete_name}</div>
        <div class="anomaly-metric">${a.metric}</div>
        <div class="anomaly-values">
          <div class="anomaly-val">Current: <span>${fmtNum(a.current_value, 2)}</span></div>
          <div class="anomaly-val">Baseline: <span>${fmtNum(a.baseline_value, 2)}</span></div>
          <div class="anomaly-val" style="color:${a.flag_level === 'concern' ? 'var(--danger)' : 'var(--warning)'}">Δ ${a.deviation_pct > 0 ? '+' : ''}${fmtNum(a.deviation_pct, 1)}%</div>
        </div>
        <div class="anomaly-desc">${a.description}</div>
      </div>`).join('');
    toast(`${anomalies.length} anomalie(s) detected`, 'ai');
  } catch (err) {
    el.innerHTML = `<div style="color:var(--danger);padding:20px">⚠️ Anomaly detection unavailable: ${err.message}</div>`;
    toast('Anomaly detection failed — API may be down', 'error');
  } finally {
    showAIBar(false);
  }
}

// ── AI: Team Insight Banner ────────────────────────────────
async function loadTeamInsight() {
  try {
    showAIBar(true);
    const data = await apiFetch(`/ai/team?season=${STATE.filters.season}`);
    if (data.team_summary) {
      document.getElementById('teamSummaryText').textContent = data.team_summary;
      document.getElementById('teamInsightBanner').classList.remove('hidden');
    }
  } catch (_) { /* silent fail — banner stays hidden */ }
  finally { showAIBar(false); }
}

// ── BIOPOD Page ────────────────────────────────────────────
function renderBIOPOD() {
  const data = filteredBIOPOD().sort((a, b) => a.test_date.localeCompare(b.test_date));
  const athletes = [...new Set(data.map(r => r.athlete_name))];

  const buildDatasets = (key, multiplier = 1) => athletes.map((n, i) => ({
    label: n,
    data: data.filter(r => r.athlete_name === n).map(r => ({ x: r.test_date, y: +(r[key] * multiplier).toFixed(2) })),
    borderColor: PALETTE[i % PALETTE.length],
    backgroundColor: PALETTE[i % PALETTE.length] + '33',
    tension: 0.4, pointRadius: 5, pointHoverRadius: 8, fill: false,
  }));

  const trendOpts = (yLabel) => ({
    ...CHART_DEFAULTS,
    parsing: { xAxisKey: 'x', yAxisKey: 'y' },
    scales: {
      x: { ...CHART_DEFAULTS.scales.x, type: 'category' },
      y: { ...CHART_DEFAULTS.scales.y, title: { display: true, text: yLabel, color: '#7a8299' } },
    },
  });

  mkChart('bp_bfTrend', { type: 'line', data: { datasets: buildDatasets('body_fat_pct', 100) },
    options: { ...trendOpts('Body Fat %'), plugins: { ...CHART_DEFAULTS.plugins,
      annotation: { annotations: {
        l1: { type: 'line', yMin: 25, yMax: 25, borderColor: '#e53e3e', borderWidth: 1, borderDash: [5, 4] },
        l2: { type: 'line', yMin: 20, yMax: 20, borderColor: '#dd6b20', borderWidth: 1, borderDash: [5, 4] },
      }},
    }},
  });
  mkChart('bp_ffmTrend',    { type: 'line', data: { datasets: buildDatasets('fat_free_mass_lbs') }, options: trendOpts('Fat Free Mass (lb)') });
  mkChart('bp_weightTrend', { type: 'line', data: { datasets: buildDatasets('weight_lbs') },        options: trendOpts('Weight (lb)') });

  // Ranking bar — latest per athlete
  const latest = athletes.map(n => {
    const rows = data.filter(r => r.athlete_name === n).sort((a, b) => b.test_date.localeCompare(a.test_date));
    return rows[0];
  }).filter(Boolean).sort((a, b) => b.body_fat_pct - a.body_fat_pct);

  mkChart('bp_ranking', {
    type: 'bar',
    data: {
      labels: latest.map(r => r.athlete_name.split(' ').slice(-1)[0]),
      datasets: [{
        label: 'Body Fat % (latest)', data: latest.map(r => +(r.body_fat_pct * 100).toFixed(1)),
        backgroundColor: latest.map(r => r.body_fat_pct > 0.25 ? '#e53e3e88' : r.body_fat_pct >= 0.20 ? '#dd6b2088' : '#38a16988'),
        borderColor:     latest.map(r => r.body_fat_pct > 0.25 ? '#e53e3e'   : r.body_fat_pct >= 0.20 ? '#dd6b20'   : '#38a169'),
        borderWidth: 2, borderRadius: 6,
      }],
    },
    options: { ...CHART_DEFAULTS, indexAxis: 'y' },
  });

  // Table
  buildTable('BIOPODTable',
    ['Athlete', 'Date', 'Season', 'Phase', 'Weight (lb)', 'Body Fat %', 'Fat Free Mass (lb)', 'Height (cm)', 'Status'],
    data.sort((a, b) => b.test_date.localeCompare(a.test_date)).map(r => {
      const isRecent = STATE.recentImports.some(ri => ri.name === r.athlete_name);
      const nameHtml = isRecent ? `<span style="color:#c8a84b;margin-right:6px" title="Recently imported">✨</span><strong>${r.athlete_name}</strong>` : `<strong>${r.athlete_name}</strong>`;
      return [
        nameHtml,
        r.test_date,
        r.season,
        r.test_phase,
        fmtNum(r.weight_lbs),
        `<span style="color:${r.body_fat_pct > 0.25 ? 'var(--danger)' : r.body_fat_pct >= 0.20 ? 'var(--warning)' : 'var(--success)'}">${fmtPct(r.body_fat_pct)}</span>`,
        fmtNum(r.fat_free_mass_lbs),
        r.height_cm || '—',
        badgeHtml(flagBF(r.body_fat_pct)),
      ];
    }),
    r => openAthleteModal(r[0].replace('✨', '').trim())
  );
}

// ── Biodex Page ────────────────────────────────────────────
let _bdxSpeed = 60;
function setBiodexSpeed(btn, speed) {
  document.querySelectorAll('#bdxSpeedTabs .tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _bdxSpeed = speed;
  renderBiodex();
}

function renderBiodex() {
  const s = _bdxSpeed;
  const latest = Object.values(filteredBiodex().reduce((m, r) => {
    if (!m[r.athlete_name] || r.test_date > m[r.athlete_name].test_date) m[r.athlete_name] = r;
    return m;
  }, {}));
  const names = latest.map(r => r.athlete_name.split(' ').slice(-1)[0]);

  mkChart('bdx_quad', { type: 'bar', data: { labels: names, datasets: [
    { label: 'Quad L', data: latest.map(r => r[`quad_l_${s}`]), backgroundColor: '#4b8ec888', borderColor: '#4b8ec8', borderWidth: 2, borderRadius: 4 },
    { label: 'Quad R', data: latest.map(r => r[`quad_r_${s}`]), backgroundColor: '#c8a84b88', borderColor: '#c8a84b', borderWidth: 2, borderRadius: 4 },
  ]}, options: { ...CHART_DEFAULTS, scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, title: { display: true, text: 'Peak Torque (Nm)', color: '#7a8299' } } } }});

  mkChart('bdx_ham', { type: 'bar', data: { labels: names, datasets: [
    { label: 'Ham L', data: latest.map(r => r[`ham_l_${s}`]), backgroundColor: '#68d39188', borderColor: '#68d391', borderWidth: 2, borderRadius: 4 },
    { label: 'Ham R', data: latest.map(r => r[`ham_r_${s}`]), backgroundColor: '#f687b388', borderColor: '#f687b3', borderWidth: 2, borderRadius: 4 },
  ]}, options: CHART_DEFAULTS });

  mkChart('bdx_asym', { type: 'bar', data: { labels: names, datasets: [
    {
      label: `Quad L:R ${s}°`,
      data: latest.map(r => r[`quad_lr_${s}`] != null ? +(r[`quad_lr_${s}`] * 100).toFixed(1) : null),
      backgroundColor: latest.map(r => r[`quad_lr_${s}`] < 0.80 ? '#e53e3e88' : r[`quad_lr_${s}`] < 0.90 ? '#dd6b2088' : '#38a16888'),
      borderColor:     latest.map(r => r[`quad_lr_${s}`] < 0.80 ? '#e53e3e'   : r[`quad_lr_${s}`] < 0.90 ? '#dd6b20'   : '#38a169'),
      borderWidth: 2, borderRadius: 4,
    },
    {
      label: `Ham L:R ${s}°`,
      data: latest.map(r => r[`ham_lr_${s}`] != null ? +(r[`ham_lr_${s}`] * 100).toFixed(1) : null),
      backgroundColor: latest.map(r => r[`ham_lr_${s}`] < 0.80 ? '#e53e3eaa' : r[`ham_lr_${s}`] < 0.90 ? '#dd6b20aa' : '#38a169aa'),
      borderColor:     latest.map(r => r[`ham_lr_${s}`] < 0.80 ? '#e53e3e'   : r[`ham_lr_${s}`] < 0.90 ? '#dd6b20'   : '#38a169'),
      borderWidth: 2, borderRadius: 4,
    },
  ]}, options: {
    ...CHART_DEFAULTS,
    scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, min: 50, max: 115, title: { display: true, text: 'L:R %', color: '#7a8299' } } },
    plugins: { ...CHART_DEFAULTS.plugins, annotation: { annotations: {
      l1: { type: 'line', yMin: 80, yMax: 80, borderColor: '#e53e3e', borderWidth: 1, borderDash: [5, 4], label: { display: true, content: '80% Concern', color: '#e53e3e', font: { size: 9 }, position: 'end', backgroundColor: 'transparent' } },
      l2: { type: 'line', yMin: 90, yMax: 90, borderColor: '#dd6b20', borderWidth: 1, borderDash: [5, 4] },
    }}},
  }});

  mkChart('bdx_hq', { type: 'bar', data: { labels: names, datasets: [
    { label: `L H:Q ${s}°`, data: latest.map(r => r[`lhq_${s}`] != null ? +(r[`lhq_${s}`] * 100).toFixed(1) : null), backgroundColor: '#b794f488', borderColor: '#b794f4', borderWidth: 2, borderRadius: 4 },
    { label: `R H:Q ${s}°`, data: latest.map(r => r[`rhq_${s}`] != null ? +(r[`rhq_${s}`] * 100).toFixed(1) : null), backgroundColor: '#76e4f788', borderColor: '#76e4f7', borderWidth: 2, borderRadius: 4 },
  ]}, options: {
    ...CHART_DEFAULTS,
    scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, min: 0, max: 100, title: { display: true, text: 'H:Q Ratio %', color: '#7a8299' } } },
    plugins: { ...CHART_DEFAULTS.plugins, annotation: { annotations: {
      l1: { type: 'line', yMin: 50, yMax: 50, borderColor: '#dd6b20', borderWidth: 1, borderDash: [5, 4], label: { display: true, content: '50% Threshold', color: '#dd6b20', font: { size: 9 }, position: 'end', backgroundColor: 'transparent' } },
      l2: { type: 'line', yMin: 40, yMax: 40, borderColor: '#e53e3e', borderWidth: 1, borderDash: [5, 4] },
    }}},
  }});

  buildTable('biodexTable',
    ['Athlete', 'Date', 'Phase', `Q-L ${s}°`, `Q-R ${s}°`, `H-L ${s}°`, `H-R ${s}°`, 'Q L:R', 'H L:R', 'L H:Q', 'R H:Q', 'Imbalance', 'Flag'],
    [...filteredBiodex()].sort((a, b) => b.test_date.localeCompare(a.test_date)).map(r => {
      const qf = flagLR(r[`quad_lr_${s}`]);
      const hf = flagLR(r[`ham_lr_${s}`]);
      const isRecent = STATE.recentImports.some(ri => ri.name === r.athlete_name);
      const nameHtml = isRecent ? `<span style="color:#c8a84b;margin-right:6px" title="Recently imported">✨</span><strong>${r.athlete_name}</strong>` : `<strong>${r.athlete_name}</strong>`;
      return [
        nameHtml, r.test_date, r.test_phase,
        fmtNum(r[`quad_l_${s}`]), fmtNum(r[`quad_r_${s}`]),
        fmtNum(r[`ham_l_${s}`]),  fmtNum(r[`ham_r_${s}`]),
        `<span style="color:var(--${qf === 'concern' ? 'danger' : qf === 'monitoring' ? 'warning' : 'success'})">${fmtPct(r[`quad_lr_${s}`])}</span>`,
        `<span style="color:var(--${hf === 'concern' ? 'danger' : hf === 'monitoring' ? 'warning' : 'success'})">${fmtPct(r[`ham_lr_${s}`])}</span>`,
        fmtPct(r[`lhq_${s}`]), fmtPct(r[`rhq_${s}`]),
        r.lr_class || '—',
        badgeHtml(combinedFlag(qf, hf)),
      ];
    }),
    r => openAthleteModal(r[0].replace('✨', '').trim())
  );
}

// ── AI: Forecast — local statistical fallback ──────────────
function computeLocalForecast(data) {
  // Group by athlete name
  const byAthlete = {};
  data.forEach(r => {
    if (!byAthlete[r.athlete_name]) byAthlete[r.athlete_name] = [];
    byAthlete[r.athlete_name].push(r);
  });

  const forecasts = [];
  const phaseOrder = ['Training Camp','Pre Season','Mid Season','Post Season','Other'];

  Object.entries(byAthlete).forEach(([name, rows]) => {
    const sorted = [...rows].sort((a, b) => a.test_date.localeCompare(b.test_date));
    if (sorted.length < 2) return;

    const metrics = [
      { key: 'body_fat_pct', label: 'Body Fat %', multiplier: 100, unit: '%' },
      { key: 'fat_free_mass_lbs', label: 'Fat Free Mass (lb)', multiplier: 1, unit: ' lb' },
    ];

    metrics.forEach(({ key, label, multiplier }) => {
      const pts = sorted.filter(r => r[key] != null);
      if (pts.length < 2) return;

      // Simple linear regression
      const n = pts.length;
      const xs = pts.map((_, i) => i);
      const ys = pts.map(r => r[key] * multiplier);
      const sumX = xs.reduce((s, x) => s + x, 0);
      const sumY = ys.reduce((s, y) => s + y, 0);
      const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
      const sumX2 = xs.reduce((s, x) => s + x * x, 0);
      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;

      const projectY = (idx) => +(intercept + slope * idx).toFixed(2);

      // Determine next phases for projection labels
      const lastPhase = pts[pts.length - 1].test_phase || 'Post Season';
      const phaseIdx = phaseOrder.indexOf(lastPhase);
      const nextPhase1 = phaseOrder[(phaseIdx + 1) % phaseOrder.length] || 'Next Phase';
      const nextPhase2 = phaseOrder[(phaseIdx + 2) % phaseOrder.length] || 'Phase +2';

      const direction = slope < -0.3 ? 'improving' : slope > 0.3 ? 'declining' : 'stable';
      // For BF%, declining is bad; for FFM, improving is good
      const displayDir = key === 'body_fat_pct'
        ? (slope < -0.3 ? 'improving' : slope > 0.3 ? 'declining' : 'stable')
        : (slope > 0.3 ? 'improving' : slope < -0.3 ? 'declining' : 'stable');

      const projected_points = [
        ...pts.map((r, i) => ({ label: r.test_date, value: +(r[key] * multiplier).toFixed(2), is_forecast: false, confidence: 'high' })),
        { label: `${nextPhase1} (proj)`, value: projectY(n),     is_forecast: true, confidence: pts.length >= 3 ? 'medium' : 'low' },
        { label: `${nextPhase2} (proj)`, value: projectY(n + 1), is_forecast: true, confidence: 'low' },
      ];

      const absSlopeStr = Math.abs(slope).toFixed(2);
      const confidence_note = pts.length >= 3
        ? `Based on ${pts.length} data points · trend: ${absSlopeStr} ${multiplier===100?'%':' lb'}/phase`
        : `Only ${pts.length} data point${pts.length > 1 ? 's' : ''} — low confidence`;

      forecasts.push({
        athlete_id:      null,
        athlete_name:    name,
        metric:          label,
        projected_points,
        trend_direction: displayDir,
        confidence_note,
        local_computed:  true,
      });
    });
  });

  return { forecasts, fallback: true, source: 'local' };
}

async function renderForecast() {
  const container = document.getElementById('forecastTable');
  container.innerHTML = '<div style="color:var(--muted);padding:20px;text-align:center">🤖 AI generating forecasts...</div>';
  showAIBar(true);

  let data = null;
  try {
    data = await apiFetch(`/ai/forecasts?season=${STATE.filters.season}`);
    STATE.aiForecasts = data;
  } catch (_) {
    // Backend unavailable — compute locally
    data = null;
  }

  // If API returned an error/fallback with no usable forecasts, compute locally
  if (!data || (data.fallback && !(data.forecasts || []).length) || !(data.forecasts || []).length) {
    const bpData = filteredBIOPOD().map(r => ({
      athlete_name: r.athlete_name,
      test_date: r.test_date,
      test_phase: r.test_phase,
      body_fat_pct: r.body_fat_pct,
      fat_free_mass_lbs: r.fat_free_mass_lbs,
    }));
    data = computeLocalForecast(bpData);
    STATE.aiForecasts = data;
    if (!data.fallback) {
      toast('AI forecasts loaded', 'ai');
    } else {
      toast('AI unavailable — showing statistical projections', 'info', 5000);
    }
  } else {
    toast('AI forecasts loaded', 'ai');
    if (data.fallback) toast('Using cached/fallback forecast data', 'info');
  }

  try {
    const forecasts = data.forecasts || [];

    // Build two charts — BF% and FFM from forecast + actual
    const bpActual = filteredBIOPOD().sort((a, b) => a.test_date.localeCompare(b.test_date));
    const athletes = [...new Set(bpActual.map(r => r.athlete_name))];

    const buildFC = (key, multiplier = 1) => {
      const datasets = [];
      athletes.forEach((n, i) => {
        const actual = bpActual.filter(r => r.athlete_name === n).map(r => ({
          x: r.test_date, y: +(r[key] * multiplier).toFixed(2),
        }));
        if (!actual.length) return;

        // Find matching forecast
        const fc = forecasts.find(f =>
          f.athlete_name === n &&
          (f.metric.toLowerCase().includes(key === 'body_fat_pct' ? 'fat' : 'free') ||
           f.metric.toLowerCase().includes(key === 'body_fat_pct' ? 'bf' : 'ffm') ||
           f.metric.toLowerCase().includes(key === 'body_fat_pct' ? 'body fat' : 'fat free mass'))
        );

        datasets.push({
          label: n,
          data: actual,
          borderColor: PALETTE[i % PALETTE.length],
          backgroundColor: PALETTE[i % PALETTE.length] + '22',
          tension: 0.4, pointRadius: 4, fill: false,
        });

        if (fc?.projected_points?.length) {
          const projPts = fc.projected_points.filter(p => p.is_forecast);
          if (projPts.length) {
            // Stitch forecast to last actual point
            const lastActual = actual[actual.length - 1];
            datasets.push({
              label: `${n} ↗ forecast`,
              data: [lastActual, ...projPts.map(p => ({ x: p.label, y: p.value }))],
              borderColor: PALETTE[i % PALETTE.length],
              backgroundColor: 'transparent',
              borderDash: [6, 4],
              tension: 0.3,
              pointRadius: 5,
              pointStyle: 'triangle',
              fill: false,
            });
          }
        }
      });
      return datasets;
    };

    const lineOpts = (yLabel) => ({
      ...CHART_DEFAULTS,
      parsing: { xAxisKey: 'x', yAxisKey: 'y' },
      scales: {
        x: { ...CHART_DEFAULTS.scales.x, type: 'category' },
        y: { ...CHART_DEFAULTS.scales.y, title: { display: true, text: yLabel, color: '#7a8299' } },
      },
    });

    mkChart('fc_bfChart',  { type: 'line', data: { datasets: buildFC('body_fat_pct', 100) },    options: lineOpts('BF%') });
    mkChart('fc_ffmChart', { type: 'line', data: { datasets: buildFC('fat_free_mass_lbs') },    options: lineOpts('FFM (lb)') });

    if (!forecasts.length) {
      container.innerHTML = '<div style="color:var(--muted);padding:20px">Not enough data points for forecasting (need ≥2 per metric).</div>';
      showAIBar(false);
      return;
    }

    // Group forecasts by athlete for a cleaner table
    const byAthlete = {};
    forecasts.forEach(f => {
      if (!byAthlete[f.athlete_name]) byAthlete[f.athlete_name] = [];
      byAthlete[f.athlete_name].push(f);
    });

    container.innerHTML = `
      <div style="margin-bottom:10px;padding:6px 10px;background:#12152a;border-radius:6px;font-size:.78rem;color:#7a8299;display:flex;align-items:center;gap:8px">
        ${data.source === 'local'
          ? '<span style="color:#c8a84b">📊 Statistical projection</span> — Linear regression from historical data points. Connect backend + Anthropic API for AI-powered forecasts.'
          : '<span style="color:#68d391">🤖 AI-powered forecast</span> — Claude AI projection based on observed trajectories.'}
      </div>
      <div style="display:grid;gap:10px">
        ${Object.entries(byAthlete).map(([name, fcs]) => {
          const bfF = fcs.find(f => f.metric.toLowerCase().includes('fat') || f.metric.toLowerCase().includes('bf'));
          const ffmF = fcs.find(f => f.metric.toLowerCase().includes('free') || f.metric.toLowerCase().includes('ffm') || f.metric.toLowerCase().includes('mass'));
          return `
          <div style="background:#12152a;border:1px solid #2a2f4a;border-radius:10px;padding:14px 16px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <div style="font-weight:700;color:#e8eaf0;font-size:.92rem">${name}</div>
              ${bfF ? `<span class="forecast-direction ${bfF.trend_direction}" style="font-size:.78rem;padding:3px 10px;border-radius:20px;font-weight:700;background:${bfF.trend_direction==='improving'?'#0f2a1a':bfF.trend_direction==='declining'?'#2a0a0a':'#1a1d2e'};color:${bfF.trend_direction==='improving'?'#68d391':bfF.trend_direction==='declining'?'#fc8181':'#c8a84b'}">
                ${bfF.trend_direction === 'improving' ? '↑ Improving' : bfF.trend_direction === 'declining' ? '↓ Declining' : '→ Stable'}
              </span>` : ''}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              ${bfF ? `<div>
                <div style="font-size:.72rem;color:#7a8299;margin-bottom:4px">BODY FAT % TREND</div>
                <div style="font-size:.82rem;color:#7a8299">${bfF.confidence_note}</div>
                ${bfF.projected_points?.filter(p => p.is_forecast).slice(0,2).map(p =>
                  `<div style="margin-top:4px;font-size:.82rem"><span style="color:#c8a84b;font-weight:600">${p.label}:</span> <span style="color:#e8eaf0">${p.value}%</span> <span style="font-size:.7rem;color:#${p.confidence==='high'?'68d391':p.confidence==='medium'?'c8a84b':'e53e3e'}">(${p.confidence})</span></div>`
                ).join('') || ''}
              </div>` : ''}
              ${ffmF ? `<div>
                <div style="font-size:.72rem;color:#7a8299;margin-bottom:4px">FAT FREE MASS TREND</div>
                <div style="font-size:.82rem;color:#7a8299">${ffmF.confidence_note}</div>
                ${ffmF.projected_points?.filter(p => p.is_forecast).slice(0,2).map(p =>
                  `<div style="margin-top:4px;font-size:.82rem"><span style="color:#4b8ec8;font-weight:600">${p.label}:</span> <span style="color:#e8eaf0">${p.value} lb</span> <span style="font-size:.7rem;color:#${p.confidence==='high'?'68d391':p.confidence==='medium'?'c8a84b':'e53e3e'}">(${p.confidence})</span></div>`
                ).join('') || ''}
              </div>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>`;
  } catch (err) {
    container.innerHTML = `<div style="color:var(--danger);padding:20px">⚠️ Forecast render error: ${err.message}</div>`;
  } finally {
    showAIBar(false);
  }
}

// ── AI: Watchlist Page ─────────────────────────────────────
async function renderWatchlist() {
  const el = document.getElementById('watchlistContent');
  el.innerHTML = '<div style="color:var(--muted);padding:40px;text-align:center;width:100%">🤖 AI calculating risk scores...</div>';
  showAIBar(true);
  try {
    const [riskData, summaryPromises] = await Promise.all([
      apiFetch(`/ai/risks?season=${STATE.filters.season}`),
      Promise.resolve(null),
    ]);
    STATE.aiRisks = riskData;
    const scores = riskData.risk_scores || [];
    if (!scores.length) { el.innerHTML = '<div style="color:var(--muted);padding:40px;text-align:center;width:100%">No risk data available.</div>'; return; }

    // Render cards first with summary loading state
    el.innerHTML = scores.map((r, i) => `
      <div class="watchlist-card ${r.risk_tier}">
        <div class="wl-rank">#${i + 1}</div>
        <div class="wl-name">${r.athlete_name}</div>
        <div class="wl-tier ${r.risk_tier}">${r.risk_tier.toUpperCase()} · ${r.risk_score}/100</div>
        <div class="wl-score-bar"><div class="wl-score-fill" style="width:${r.risk_score}%;background:${scoreColor(r.risk_score)}"></div></div>
        <div class="wl-concerns">${(r.primary_concerns || []).map(c => `<span class="wl-tag">${c}</span>`).join('')}</div>
        <div class="wl-summary c-muted" id="wl-reasoning-${i}">${r.reasoning || 'Loading AI summary...'}</div>
        <div id="wl-summary-${i}" class="wl-summary" style="margin-top:6px"><span style="color:var(--muted)">Loading coaching summary...</span></div>
        <div id="wl-rec-${i}" class="wl-recommendation" style="display:none"></div>
        <button class="wl-btn" onclick="openAthleteModal('${r.athlete_name.replace(/'/g, "\\'")}')">View Full Profile →</button>
      </div>`).join('');

    toast('Risk scores loaded', 'ai');

    // Load individual summaries async
    const athleteIds = STATE.athletes.reduce((m, a) => { m[a.name] = a.id; return m; }, {});
    scores.forEach(async (r, i) => {
      const aid = athleteIds[r.athlete_name];
      if (!aid) return;
      try {
        const sum = await apiFetch(`/ai/summary/${aid}`);
        const summaryEl = document.getElementById(`wl-summary-${i}`);
        const recEl = document.getElementById(`wl-rec-${i}`);
        if (summaryEl) summaryEl.innerHTML = `<strong style="color:var(--text)">${sum.key_positive ? '✅ ' + sum.key_positive : ''}</strong>${sum.summary ? '<br>' + sum.summary : ''}`;
        if (recEl && sum.recommendation) { recEl.textContent = '💡 ' + sum.recommendation; recEl.style.display = 'block'; }
      } catch (_) {}
    });

  } catch (err) {
    el.innerHTML = `<div style="color:var(--danger);padding:40px;text-align:center;width:100%">⚠️ Risk scoring unavailable: ${err.message}</div>`;
    toast('Risk scoring failed', 'error');
  } finally { showAIBar(false); }
}

// ── Athlete Profile Page ───────────────────────────────────
async function loadAthleteProfile(name) {
  if (!name) return;
  const athlete = STATE.athletes.find(a => a.name === name);
  if (!athlete) return;
  const bp  = STATE.BIOPOD.filter(r => r.athlete_name === name).sort((a, b) => b.test_date.localeCompare(a.test_date));
  const bdx = STATE.biodex.filter(r => r.athlete_name === name).sort((a, b) => b.test_date.localeCompare(a.test_date));
  const latBP = bp[0], latBDX = bdx[0];
  const bfF = flagBF(latBP?.body_fat_pct);
  const lrF = flagLR(latBDX?.quad_lr_60);
  const cf  = combinedFlag(bfF, lrF);

  document.getElementById('athleteProfileContent').innerHTML = `
    <div class="profile-hero">
      <div class="profile-avatar">${initials(name)}</div>
      <div>
        <div class="profile-name">${name}</div>
        <div class="profile-meta">${athlete.position || '—'} · ${athlete.training_bucket || '—'} · ${athlete.program || '—'}</div>
        <div class="profile-badges">${badgeHtml(cf)} <span class="badge badge-blue">${athlete.roster_status || 'Full'}</span> ${athlete.accommodation ? `<span class="badge badge-gold">${athlete.accommodation}</span>` : ''}</div>
      </div>
    </div>
    <div class="scorecard-row">
      <div class="scorecard" style="border-top-color:${bfF === 'concern' ? 'var(--danger)' : bfF === 'monitoring' ? 'var(--warning)' : 'var(--success)'}">
        <div class="scorecard-label">Body Fat %</div>
        <div class="scorecard-value c-${bfF === 'concern' ? 'danger' : bfF === 'monitoring' ? 'warning' : 'success'}">${latBP ? fmtPct(latBP.body_fat_pct) : '—'}</div>
        <div class="scorecard-change c-muted">${latBP?.test_date || 'No data'}</div>
      </div>
      <div class="scorecard"><div class="scorecard-label">Fat Free Mass</div><div class="scorecard-value">${latBP ? fmtNum(latBP.fat_free_mass_lbs) : '—'}<span class="scorecard-unit">lb</span></div></div>
      <div class="scorecard" style="border-top-color:${lrF === 'concern' ? 'var(--danger)' : lrF === 'monitoring' ? 'var(--warning)' : 'var(--success)'}">
        <div class="scorecard-label">Quad L:R @ 60°</div>
        <div class="scorecard-value c-${lrF === 'concern' ? 'danger' : lrF === 'monitoring' ? 'warning' : 'success'}">${latBDX ? fmtPct(latBDX.quad_lr_60) : '—'}</div>
      </div>
      <div class="scorecard"><div class="scorecard-label">Ham L:R @ 60°</div>
        <div class="scorecard-value" style="color:${flagLR(latBDX?.ham_lr_60) === 'concern' ? 'var(--danger)' : 'var(--success)'}">${latBDX ? fmtPct(latBDX.ham_lr_60) : '—'}</div>
      </div>
    </div>
    <div id="aiSummaryCard" class="ai-banner hidden"><div class="ai-banner-icon">🤖</div><div class="ai-banner-content"><div class="ai-banner-title">AI Coaching Summary</div><div id="aiSummaryText" class="ai-banner-text">Loading...</div></div></div>
    <div class="grid-2">
      <div class="card"><div class="card-header"><span class="card-title">Body Composition Trend</span></div><div class="chart-wrap h260"><canvas id="prof_bfChart"></canvas></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Biodex Radar Profile</span></div><div class="chart-wrap h260"><canvas id="prof_radarChart"></canvas></div></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-header"><span class="card-title">BIOPOD History</span></div>
        <div class="table-wrap"><table class="data-table" id="prof_bpTable"></table></div>
      </div>
      <div class="card"><div class="card-header"><span class="card-title">Biodex History</span></div>
        <div class="table-wrap"><table class="data-table" id="prof_bdxTable"></table></div>
      </div>
    </div>`;

  // BF chart
  if (bp.length) {
    const bpSorted = [...bp].reverse();
    mkChart('prof_bfChart', { type: 'line', data: { labels: bpSorted.map(r => r.test_date), datasets: [
      { label: 'BF%', data: bpSorted.map(r => +(r.body_fat_pct * 100).toFixed(1)), borderColor: '#c8a84b', backgroundColor: '#c8a84b22', tension: 0.4, pointRadius: 6, fill: true },
      { label: 'FFM (lb)', data: bpSorted.map(r => r.fat_free_mass_lbs), borderColor: '#4b8ec8', backgroundColor: 'transparent', tension: 0.4, pointRadius: 5, yAxisID: 'y2' },
    ]}, options: { ...CHART_DEFAULTS, scales: { x: CHART_DEFAULTS.scales.x, y: { ...CHART_DEFAULTS.scales.y, title: { display: true, text: 'BF%', color: '#7a8299' } }, y2: { type: 'linear', position: 'right', ticks: { color: '#7a8299', font: { size: 10 } }, grid: { drawOnChartArea: false }, title: { display: true, text: 'FFM lb', color: '#7a8299' } } } } });
  }

  // Biodex radar
  if (bdx.length) {
    const labels = ['Q L:R 60°','H L:R 60°','Q L:R 120°','H L:R 120°','Q L:R 180°','H L:R 180°'];
    mkChart('prof_radarChart', { type: 'radar', data: { labels, datasets: bdx.slice(0, 2).map((r, i) => ({
      label: r.test_date,
      data: [r.quad_lr_60, r.ham_lr_60, r.quad_lr_120, r.ham_lr_120, r.quad_lr_180, r.ham_lr_180].map(v => v != null ? +(v * 100).toFixed(1) : null),
      borderColor: PALETTE[i], backgroundColor: PALETTE[i] + '33', pointRadius: 4,
    }))}, options: { ...CHART_DEFAULTS, scales: { r: { angleLines: { color: '#2a2f4a' }, grid: { color: '#2a2f4a' }, pointLabels: { color: '#7a8299', font: { size: 10 } }, ticks: { color: '#7a8299', backdropColor: 'transparent', font: { size: 9 } }, suggestedMin: 50, suggestedMax: 110 } } } });
  }

  buildTable('prof_bpTable', ['Date','Phase','Weight','BF%','FFM','Status'],
    bp.map(r => [r.test_date, r.test_phase, fmtNum(r.weight_lbs), `<span style="color:${r.body_fat_pct > 0.25 ? 'var(--danger)' : r.body_fat_pct >= 0.20 ? 'var(--warning)' : 'var(--success)'}">${fmtPct(r.body_fat_pct)}</span>`, fmtNum(r.fat_free_mass_lbs), badgeHtml(flagBF(r.body_fat_pct))]));
  buildTable('prof_bdxTable', ['Date','Phase','Q L:R','H L:R','L H:Q','R H:Q','Flag'],
    bdx.map(r => [r.test_date, r.test_phase, `<span style="color:${r.quad_lr_60 < 0.80 ? 'var(--danger)' : r.quad_lr_60 < 0.90 ? 'var(--warning)' : 'var(--success)'}">${fmtPct(r.quad_lr_60)}</span>`, `<span style="color:${r.ham_lr_60 < 0.80 ? 'var(--danger)' : r.ham_lr_60 < 0.90 ? 'var(--warning)' : 'var(--success)'}">${fmtPct(r.ham_lr_60)}</span>`, fmtPct(r.lhq_60), fmtPct(r.rhq_60), badgeHtml(combinedFlag(flagLR(r.quad_lr_60), flagLR(r.ham_lr_60)))]));

  // Load AI summary
  if (athlete.id) {
    document.getElementById('aiSummaryCard').classList.remove('hidden');
    document.getElementById('aiSummaryText').textContent = 'Loading AI coaching summary...';
    try {
      const sum = await apiFetch(`/ai/summary/${athlete.id}`);
      document.getElementById('aiSummaryText').innerHTML = `<strong>${sum.key_positive || ''}</strong>${sum.summary ? ' — ' + sum.summary : ''}<br><br><em>💡 ${sum.recommendation || ''}</em>`;
    } catch (_) {
      document.getElementById('aiSummaryText').textContent = 'AI summary unavailable.';
    }
  }
}

// ── Comparison Page ────────────────────────────────────────
function renderComparison() {
  const a1     = document.getElementById('cmp1').value;
  const a2     = document.getElementById('cmp2').value;
  const metric = document.getElementById('cmpMetric').value;
  const el     = document.getElementById('compareContent');

  if (!a1 || !a2 || a1 === a2) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">⚡</div><div class="empty-text">Select two different athletes to compare</div></div>';
    return;
  }

  const isBP   = metric === 'BIOPOD';
  const label1 = a1.split(' ').slice(-1)[0];
  const label2 = a2.split(' ').slice(-1)[0];
  const PHASES = ['Training Camp','Pre Season','Mid Season','Post Season','Other'];

  // gather data
  const d1bp  = STATE.BIOPOD.filter(r => r.athlete_name === a1).sort((a,b) => a.test_date.localeCompare(b.test_date));
  const d2bp  = STATE.BIOPOD.filter(r => r.athlete_name === a2).sort((a,b) => a.test_date.localeCompare(b.test_date));
  const d1bdx = STATE.biodex.filter(r => r.athlete_name === a1).sort((a,b) => a.test_date.localeCompare(b.test_date));
  const d2bdx = STATE.biodex.filter(r => r.athlete_name === a2).sort((a,b) => a.test_date.localeCompare(b.test_date));
  const lat1bp  = d1bp[d1bp.length - 1];
  const lat2bp  = d2bp[d2bp.length - 1];
  const lat1bdx = d1bdx[d1bdx.length - 1];
  const lat2bdx = d2bdx[d2bdx.length - 1];

  function statRow(label, v1, v2, lowerIsBetter, unit) {
    const n1 = parseFloat(v1), n2 = parseFloat(v2);
    let c1 = '#e8eaf0', c2 = '#e8eaf0';
    if (!isNaN(n1) && !isNaN(n2) && n1 !== n2) {
      const better = lowerIsBetter ? (n1 < n2 ? 1 : 2) : (n1 > n2 ? 1 : 2);
      c1 = better === 1 ? '#68d391' : '#fc8181';
      c2 = better === 2 ? '#68d391' : '#fc8181';
    }
    const fmt = v => (v != null && !isNaN(parseFloat(v))) ? parseFloat(v).toFixed(1) + (unit||'') : '—';
    return `<tr><td style="color:#7a8299;font-size:.82rem;padding:7px 10px">${label}</td><td style="color:${c1};font-weight:600;text-align:center;padding:7px 10px">${fmt(v1)}</td><td style="color:${c2};font-weight:600;text-align:center;padding:7px 10px">${fmt(v2)}</td></tr>`;
  }

  // Stats rows
  let statsRows = '';
  if (isBP) {
    const delta1 = d1bp.length >= 2 ? ((d1bp[d1bp.length-1].body_fat_pct - d1bp[0].body_fat_pct) * 100) : null;
    const delta2 = d2bp.length >= 2 ? ((d2bp[d2bp.length-1].body_fat_pct - d2bp[0].body_fat_pct) * 100) : null;
    statsRows = [
      statRow('Body Fat %',        lat1bp?.body_fat_pct != null ? lat1bp.body_fat_pct*100 : null, lat2bp?.body_fat_pct != null ? lat2bp.body_fat_pct*100 : null, true, '%'),
      statRow('Fat Free Mass (lb)', lat1bp?.fat_free_mass_lbs, lat2bp?.fat_free_mass_lbs, false, ' lb'),
      statRow('Weight (lb)',        lat1bp?.weight_lbs,        lat2bp?.weight_lbs,        false, ' lb'),
      statRow('Fat Mass (kg)',      lat1bp?.fat_mass_kg,       lat2bp?.fat_mass_kg,       true, ' kg'),
      statRow('Body Density',       lat1bp?.body_density,      lat2bp?.body_density,      false, ''),
      statRow('Activity Level',     lat1bp?.activity_level,    lat2bp?.activity_level,    false, ''),
      statRow('# Tests',            d1bp.length,               d2bp.length,               false, ''),
      statRow('BF% Season Change',  delta1, delta2, true, '%'),
    ].join('');
  } else {
    statsRows = [
      statRow('Quad L:R 60°',  lat1bdx?.quad_lr_60  != null ? lat1bdx.quad_lr_60*100  : null, lat2bdx?.quad_lr_60  != null ? lat2bdx.quad_lr_60*100  : null, false, '%'),
      statRow('Ham L:R 60°',   lat1bdx?.ham_lr_60   != null ? lat1bdx.ham_lr_60*100   : null, lat2bdx?.ham_lr_60   != null ? lat2bdx.ham_lr_60*100   : null, false, '%'),
      statRow('Quad L:R 120°', lat1bdx?.quad_lr_120 != null ? lat1bdx.quad_lr_120*100 : null, lat2bdx?.quad_lr_120 != null ? lat2bdx.quad_lr_120*100 : null, false, '%'),
      statRow('Ham L:R 120°',  lat1bdx?.ham_lr_120  != null ? lat1bdx.ham_lr_120*100  : null, lat2bdx?.ham_lr_120  != null ? lat2bdx.ham_lr_120*100  : null, false, '%'),
      statRow('L H:Q 60°',     lat1bdx?.lhq_60 != null ? lat1bdx.lhq_60*100 : null, lat2bdx?.lhq_60 != null ? lat2bdx.lhq_60*100 : null, false, '%'),
      statRow('R H:Q 60°',     lat1bdx?.rhq_60 != null ? lat1bdx.rhq_60*100 : null, lat2bdx?.rhq_60 != null ? lat2bdx.rhq_60*100 : null, false, '%'),
      statRow('Quad L Peak 60°', lat1bdx?.quad_l_60, lat2bdx?.quad_l_60, false, ' Nm'),
      statRow('Quad R Peak 60°', lat1bdx?.quad_r_60, lat2bdx?.quad_r_60, false, ' Nm'),
      statRow('Ham L Peak 60°',  lat1bdx?.ham_l_60,  lat2bdx?.ham_l_60,  false, ' Nm'),
      statRow('Ham R Peak 60°',  lat1bdx?.ham_r_60,  lat2bdx?.ham_r_60,  false, ' Nm'),
      statRow('# Tests',        d1bdx.length, d2bdx.length, false, ''),
    ].join('');
  }

  // Phase-by-phase rows
  let phaseRows = '';
  PHASES.forEach(ph => {
    const src1 = isBP ? d1bp : d1bdx;
    const src2 = isBP ? d2bp : d2bdx;
    const r1s = src1.filter(r => r.test_phase === ph);
    const r2s = src2.filter(r => r.test_phase === ph);
    if (!r1s.length && !r2s.length) return;
    const avg = (arr, k) => arr.length ? arr.reduce((s,r)=>s+(r[k]||0),0)/arr.length : null;
    const v1 = isBP ? avg(r1s,'body_fat_pct') : avg(r1s,'quad_lr_60');
    const v2 = isBP ? avg(r2s,'body_fat_pct') : avg(r2s,'quad_lr_60');
    const c1 = v1 != null ? (isBP ? (v1>0.25?'#e53e3e':v1>=0.20?'#dd6b20':'#68d391') : (v1<0.80?'#e53e3e':v1<0.90?'#dd6b20':'#68d391')) : '#7a8299';
    const c2 = v2 != null ? (isBP ? (v2>0.25?'#e53e3e':v2>=0.20?'#dd6b20':'#68d391') : (v2<0.80?'#e53e3e':v2<0.90?'#dd6b20':'#68d391')) : '#7a8299';
    phaseRows += `<tr><td style="color:#7a8299;padding:6px 10px;font-size:.8rem">${ph}</td><td style="text-align:center;padding:6px 10px;font-size:.82rem;color:${c1}">${v1!=null?(v1*100).toFixed(1)+'%':'—'}</td><td style="text-align:center;padding:6px 10px;font-size:.82rem;color:${c2}">${v2!=null?(v2*100).toFixed(1)+'%':'—'}</td></tr>`;
  });

  // Local insight
  const insights = [];
  if (isBP && lat1bp && lat2bp) {
    const bf1 = lat1bp.body_fat_pct*100, bf2 = lat2bp.body_fat_pct*100;
    insights.push(`${bf1 < bf2 ? a1 : a2} has a ${Math.abs(bf1-bf2).toFixed(1)}% lower body fat — a meaningful edge in power-to-weight ratio.`);
    if (lat1bp.fat_free_mass_lbs && lat2bp.fat_free_mass_lbs) {
      const more = lat1bp.fat_free_mass_lbs > lat2bp.fat_free_mass_lbs ? a1 : a2;
      insights.push(`${more} carries ${Math.abs(lat1bp.fat_free_mass_lbs - lat2bp.fat_free_mass_lbs).toFixed(1)} lb more fat-free mass — greater absolute strength potential.`);
    }
    if (d1bp.length >= 2 && d2bp.length >= 2) {
      const delta1 = (d1bp[d1bp.length-1].body_fat_pct - d1bp[0].body_fat_pct)*100;
      const delta2 = (d2bp[d2bp.length-1].body_fat_pct - d2bp[0].body_fat_pct)*100;
      if (Math.abs(delta1-delta2) > 1) insights.push(`${delta1 < delta2 ? a1 : a2} shows a more favourable body composition trajectory over the tracked period.`);
    }
  } else if (!isBP && lat1bdx && lat2bdx) {
    const lr1 = lat1bdx.quad_lr_60*100, lr2 = lat2bdx.quad_lr_60*100;
    insights.push(`${lr1 > lr2 ? a1 : a2} has a ${Math.abs(lr1-lr2).toFixed(1)}% better quad L:R symmetry — reducing ACL injury risk.`);
    if (lat1bdx.lhq_60 && lat2bdx.lhq_60) {
      const hq1 = lat1bdx.lhq_60, hq2 = lat2bdx.lhq_60;
      insights.push(`${hq1 > hq2 ? a1 : a2} has a superior H:Q ratio (${(Math.max(hq1,hq2)*100).toFixed(0)}% vs ${(Math.min(hq1,hq2)*100).toFixed(0)}%), offering better hamstring protection.`);
    }
  }
  if (!insights.length) insights.push('Select both athletes with overlapping data to generate comparison insights.');

  el.innerHTML = `
    <div class="grid-2" style="margin-bottom:16px">
      <div class="card"><div class="card-header"><span class="card-title">${a1} vs ${a2} — ${isBP ? 'Body Fat % Trend' : 'Strength Asymmetry'}</span></div><div class="chart-wrap h300"><canvas id="cmp_bar"></canvas></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Profile Radar</span></div><div class="chart-wrap h300"><canvas id="cmp_radar"></canvas></div></div>
    </div>
    <div class="grid-2" style="margin-bottom:16px">
      <div class="card">
        <div class="card-header"><span class="card-title">Head-to-Head Stats</span></div>
        <div class="table-wrap"><table style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="padding:8px 10px;text-align:left;color:#7a8299;font-size:.78rem;border-bottom:1px solid #2a2f4a">Metric</th>
            <th style="padding:8px 10px;text-align:center;color:#c8a84b;font-size:.78rem;border-bottom:1px solid #2a2f4a">${label1}</th>
            <th style="padding:8px 10px;text-align:center;color:#4b8ec8;font-size:.78rem;border-bottom:1px solid #2a2f4a">${label2}</th>
          </tr></thead>
          <tbody>${statsRows}</tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Phase-by-Phase ${isBP ? 'Avg BF%' : 'Avg Quad L:R'}</span></div>
        <div class="chart-wrap h200"><canvas id="cmp_phase"></canvas></div>
        ${phaseRows ? `<div class="table-wrap" style="margin-top:8px"><table style="width:100%;border-collapse:collapse"><thead><tr>
          <th style="padding:6px 10px;text-align:left;color:#7a8299;font-size:.75rem;border-bottom:1px solid #2a2f4a">Phase</th>
          <th style="padding:6px 10px;text-align:center;color:#c8a84b;font-size:.75rem;border-bottom:1px solid #2a2f4a">${label1}</th>
          <th style="padding:6px 10px;text-align:center;color:#4b8ec8;font-size:.75rem;border-bottom:1px solid #2a2f4a">${label2}</th>
        </tr></thead><tbody>${phaseRows}</tbody></table></div>` : '<div style="color:var(--muted);padding:16px;font-size:.82rem">No phase data available.</div>'}
      </div>
    </div>
    <div class="card" style="border-left:3px solid #c8a84b">
      <div class="card-header">
        <span class="card-title">🤖 Comparison Insight</span>
        <button class="btn-ghost" onclick="loadComparisonAI('${a1.replace(/'/g,"\\'")}','${a2.replace(/'/g,"\\'")}','${metric}')">Get AI Analysis</button>
      </div>
      <div id="cmpInsight" style="padding:14px 0">
        ${insights.map(s => `<div style="display:flex;gap:10px;margin-bottom:8px;font-size:.85rem;color:#b8bcd0"><span style="color:#c8a84b;flex-shrink:0">◆</span><span>${s}</span></div>`).join('')}
      </div>
    </div>`;

  setTimeout(() => {
    if (isBP) {
      const allDates = [...new Set([...d1bp,...d2bp].map(r=>r.test_date))].sort();
      mkChart('cmp_bar', { type:'line', data:{ labels:allDates, datasets:[
        { label:`${a1} BF%`, data:allDates.map(d=>{const r=d1bp.find(x=>x.test_date===d);return r?+(r.body_fat_pct*100).toFixed(1):null;}), borderColor:PALETTE[0], backgroundColor:PALETTE[0]+'33', spanGaps:true, tension:0.4, pointRadius:5, fill:true },
        { label:`${a2} BF%`, data:allDates.map(d=>{const r=d2bp.find(x=>x.test_date===d);return r?+(r.body_fat_pct*100).toFixed(1):null;}), borderColor:PALETTE[1], backgroundColor:PALETTE[1]+'22', spanGaps:true, tension:0.4, pointRadius:5, fill:true },
      ]}, options:{ ...CHART_DEFAULTS, plugins:{ ...CHART_DEFAULTS.plugins, annotation:{ annotations:{ l1:{ type:'line',yMin:25,yMax:25,borderColor:'#e53e3e',borderWidth:1,borderDash:[5,4] } }} }} });
      mkChart('cmp_radar', { type:'radar', data:{ labels:['BF%','FFM (lb)','Weight (lb)'], datasets:[
        { label:a1, data:lat1bp?[+(lat1bp.body_fat_pct*100).toFixed(1),lat1bp.fat_free_mass_lbs,lat1bp.weight_lbs]:[], borderColor:PALETTE[0], backgroundColor:PALETTE[0]+'33', pointRadius:4 },
        { label:a2, data:lat2bp?[+(lat2bp.body_fat_pct*100).toFixed(1),lat2bp.fat_free_mass_lbs,lat2bp.weight_lbs]:[], borderColor:PALETTE[1], backgroundColor:PALETTE[1]+'33', pointRadius:4 },
      ]}, options:{ ...CHART_DEFAULTS, scales:{ r:{ angleLines:{color:'#2a2f4a'},grid:{color:'#2a2f4a'},pointLabels:{color:'#7a8299'},ticks:{color:'#7a8299',backdropColor:'transparent'} } } } });
      const pLabels = PHASES.filter(ph=>[...d1bp,...d2bp].some(r=>r.test_phase===ph));
      const avgBF = (arr,ph)=>{ const rows=arr.filter(r=>r.test_phase===ph); return rows.length?+(rows.reduce((s,r)=>s+r.body_fat_pct*100,0)/rows.length).toFixed(1):null; };
      mkChart('cmp_phase', { type:'bar', data:{ labels:pLabels, datasets:[
        { label:a1, data:pLabels.map(ph=>avgBF(d1bp,ph)), backgroundColor:PALETTE[0]+'88', borderColor:PALETTE[0], borderWidth:2, borderRadius:4 },
        { label:a2, data:pLabels.map(ph=>avgBF(d2bp,ph)), backgroundColor:PALETTE[1]+'88', borderColor:PALETTE[1], borderWidth:2, borderRadius:4 },
      ]}, options:CHART_DEFAULTS });
    } else {
      const rL = ['Q L:R 60°','H L:R 60°','Q L:R 120°','H L:R 120°','Q L:R 180°','H L:R 180°'];
      const vals = r => r?[r.quad_lr_60,r.ham_lr_60,r.quad_lr_120,r.ham_lr_120,r.quad_lr_180,r.ham_lr_180].map(v=>v!=null?+(v*100).toFixed(1):null):[];
      mkChart('cmp_bar', { type:'bar', data:{ labels:rL, datasets:[
        { label:a1, data:vals(lat1bdx), backgroundColor:PALETTE[0]+'88', borderColor:PALETTE[0], borderWidth:2, borderRadius:4 },
        { label:a2, data:vals(lat2bdx), backgroundColor:PALETTE[1]+'88', borderColor:PALETTE[1], borderWidth:2, borderRadius:4 },
      ]}, options:{ ...CHART_DEFAULTS, plugins:{ ...CHART_DEFAULTS.plugins, annotation:{ annotations:{ l1:{ type:'line',yMin:80,yMax:80,borderColor:'#e53e3e',borderWidth:1,borderDash:[5,4] },l2:{ type:'line',yMin:90,yMax:90,borderColor:'#dd6b20',borderWidth:1,borderDash:[5,4] } }} }} });
      mkChart('cmp_radar', { type:'radar', data:{ labels:rL, datasets:[
        { label:a1, data:vals(lat1bdx), borderColor:PALETTE[0], backgroundColor:PALETTE[0]+'33', pointRadius:4 },
        { label:a2, data:vals(lat2bdx), borderColor:PALETTE[1], backgroundColor:PALETTE[1]+'33', pointRadius:4 },
      ]}, options:{ ...CHART_DEFAULTS, scales:{ r:{ angleLines:{color:'#2a2f4a'},grid:{color:'#2a2f4a'},pointLabels:{color:'#7a8299',font:{size:10}},ticks:{color:'#7a8299',backdropColor:'transparent',font:{size:9}},suggestedMin:50,suggestedMax:110 } } } });
      const pLabels = PHASES.filter(ph=>[...d1bdx,...d2bdx].some(r=>r.test_phase===ph));
      const avgLR = (arr,ph)=>{ const rows=arr.filter(r=>r.test_phase===ph); return rows.length?+(rows.reduce((s,r)=>s+(r.quad_lr_60||0)*100,0)/rows.length).toFixed(1):null; };
      mkChart('cmp_phase', { type:'bar', data:{ labels:pLabels, datasets:[
        { label:a1, data:pLabels.map(ph=>avgLR(d1bdx,ph)), backgroundColor:PALETTE[0]+'88', borderColor:PALETTE[0], borderWidth:2, borderRadius:4 },
        { label:a2, data:pLabels.map(ph=>avgLR(d2bdx,ph)), backgroundColor:PALETTE[1]+'88', borderColor:PALETTE[1], borderWidth:2, borderRadius:4 },
      ]}, options:CHART_DEFAULTS });
    }
  }, 80);
}

async function loadComparisonAI(a1, a2, metric) {
  const el = document.getElementById('cmpInsight');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--muted);padding:12px;text-align:center">🤖 Asking AI for comparison analysis...</div>';
  showAIBar(true);
  try {
    const a1Data = STATE.athletes.find(a => a.name === a1);
    const a2Data = STATE.athletes.find(a => a.name === a2);
    if (!a1Data?.id || !a2Data?.id) throw new Error('Athlete IDs not found — AI summaries require a live backend.');
    const [s1, s2] = await Promise.all([ apiFetch(`/ai/summary/${a1Data.id}`), apiFetch(`/ai/summary/${a2Data.id}`) ]);
    el.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div style="background:#12152a;border-radius:8px;padding:12px;border-left:3px solid ${PALETTE[0]}">
        <div style="font-weight:700;color:#e8eaf0;margin-bottom:6px">${a1}</div>
        <div style="font-size:.82rem;color:#b8bcd0">${s1.summary||'—'}</div>
        ${s1.recommendation?`<div style="font-size:.78rem;color:#c8a84b;margin-top:6px">💡 ${s1.recommendation}</div>`:''}
      </div>
      <div style="background:#12152a;border-radius:8px;padding:12px;border-left:3px solid ${PALETTE[1]}">
        <div style="font-weight:700;color:#e8eaf0;margin-bottom:6px">${a2}</div>
        <div style="font-size:.82rem;color:#b8bcd0">${s2.summary||'—'}</div>
        ${s2.recommendation?`<div style="font-size:.78rem;color:#c8a84b;margin-top:6px">💡 ${s2.recommendation}</div>`:''}
      </div>
    </div>`;
    toast('AI comparison analysis loaded', 'ai');
  } catch (err) {
    el.innerHTML = `<div style="color:var(--danger);font-size:.82rem;padding:10px">⚠️ AI analysis unavailable: ${err.message}</div>`;
  } finally { showAIBar(false); }
}

// ── Athlete Modal ──────────────────────────────────────────
function openAthleteModal(name) {
  if (!name) return;
  document.getElementById('athleteSelect').value = name;
  const page = document.getElementById('page-athlete');
  if (page) {
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    page.classList.remove('hidden');
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-page="athlete"]')?.classList.add('active');
    loadAthleteProfile(name);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
function closeModal() {
  document.getElementById('athleteModal').classList.add('hidden');
}
document.getElementById('athleteModal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('athleteModal')) closeModal();
});

// ── Table builder ──────────────────────────────────────────
function buildTable(id, headers, rows, onRowClick) {
  const tbl = document.getElementById(id);
  if (!tbl) return;
  tbl.innerHTML = `
    <thead><tr>${headers.map((h, i) => `<th data-sort data-col="${i}">${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((cells, ri) => `<tr ${onRowClick ? `onclick="(${onRowClick.toString()})(this._cells)"` : ''} data-row="${ri}">${cells.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
  // Attach click data
  if (onRowClick) {
    tbl.querySelectorAll('tbody tr').forEach((tr, i) => {
      tr._cells = rows[i].map(c => c.replace(/<[^>]*>/g, ''));
      tr.onclick = () => onRowClick(tr._cells);
    });
  }
}

// ── Search ─────────────────────────────────────────────────
document.getElementById('globalSearch').addEventListener('input', function () {
  const q = this.value.toLowerCase().trim();
  const dd = document.getElementById('searchDropdown');
  if (!q) { dd.classList.add('hidden'); return; }
  const matches = STATE.athletes.filter(a => a.name.toLowerCase().includes(q)).slice(0, 8);
  if (!matches.length) { dd.classList.add('hidden'); return; }
  dd.innerHTML = matches.map(a => `<div class="search-option" onclick="openAthleteModal('${a.name.replace(/'/g, "\\'")}')">${a.name}</div>`).join('');
  dd.classList.remove('hidden');
});
document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrap')) document.getElementById('searchDropdown').classList.add('hidden');
});

// ── Populate athlete selects ───────────────────────────────
function populateSelects() {
  const selects = ['athleteSelect', 'cmp1', 'cmp2'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    STATE.athletes.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.name; opt.text = a.name;
      el.appendChild(opt);
    });
  });
}

// ── Bootstrap ──────────────────────────────────────────────
async function init() {
  const overlay = document.getElementById('loadingOverlay');
  STATE.filters.sport = document.getElementById('fSport')?.value || "Women's Basketball";
  try {
    setLoadingStatus('Checking connection...');
    await apiFetch('/health');

    setLoadingStatus('Loading athletes...');
    const sport = STATE.filters.sport === 'all' ? '' : `&sport=${encodeURIComponent(STATE.filters.sport)}`;
    STATE.athletes = await apiFetch(`/athletes?season=2025-26${sport}`);

    setLoadingStatus('Loading body composition data...');
    STATE.BIOPOD = await apiFetch('/bodpod');

    setLoadingStatus('Loading Biodex data...');
    STATE.biodex = await apiFetch('/biodex');

    setLoadingStatus('Ready!');
    populateSelects();
    renderOverview();

    overlay.classList.add('fade-out');
    setTimeout(() => overlay.remove(), 600);
    toast('Dashboard loaded successfully', 'success', 3000);

  } catch (err) {
    // If API is down, run in demo mode with embedded data
    console.warn('API unavailable — running in demo mode:', err.message);
    setLoadingStatus('Running in demo mode (no backend)...');
    loadDemoData();
    populateSelects();
    renderOverview();
    overlay.classList.add('fade-out');
    setTimeout(() => overlay.remove(), 600);
    toast('Running in demo mode — connect backend for full features', 'info', 6000);
  }
}

// ── Demo Data (fallback when no backend) ──────────────────
function loadDemoData() {
  STATE.athletes = [
    { id:1, name:'Abby Cullion',        position:'Point Guard', training_bucket:'Get Right',  accommodation:'Posterior Chain', roster_status:'Full' },
    { id:2, name:'Mackenzie Fineman',   position:'Guard',       training_bucket:'Get Right',  accommodation:'Posterior Chain', roster_status:'Full' },
    { id:3, name:'Kali Grootenboer',    position:'Forward',     training_bucket:'Individual', accommodation:'',               roster_status:'Full' },
    { id:4, name:'Maliyah Ogorek',      position:'Point Guard', training_bucket:'Get Right',  accommodation:'Posterior Chain', roster_status:'Full' },
    { id:5, name:'Jodie-Rachel Pierre', position:'Centre',      training_bucket:'Individual', accommodation:'Other',           roster_status:'Full' },
    { id:6, name:'Teighan Stoukas',     position:'Guard',       training_bucket:'Get Right',  accommodation:'Posterior Chain', roster_status:'Full' },
    { id:7, name:'Leah Tate',           position:'Guard',       training_bucket:'Individual', accommodation:'',               roster_status:'Full' },
    { id:8, name:'Maysa Arabi',         position:'Guard',       training_bucket:'General',    accommodation:'',               roster_status:'Full' },
    { id:9, name:'Leah Shannon',        position:'Guard',       training_bucket:'General',    accommodation:'',               roster_status:'Full' },
    { id:10,name:'Helena Lasic',        position:'',            training_bucket:'General',    accommodation:'',               roster_status:'Full' },
    { id:11,name:'Tito Akinnusi',       position:'',            training_bucket:'Individual', accommodation:'',               roster_status:'Full' },
    { id:12,name:'Mackenzie Marenchin', position:'Guard',       training_bucket:'General',    accommodation:'',               roster_status:'Full' },
    { id:13,name:'Lita Sutor',          position:'Guard',       training_bucket:'General',    accommodation:'',               roster_status:'Full' },
  ];
  STATE.BIOPOD = [
    { athlete_name:'Teighan Stoukas',  test_date:'2026-04-02', season:'2025-26', test_phase:'Post Season',   weight_lbs:126.06, body_fat_pct:0.179, fat_free_mass_lbs:103.50, height_cm:160.5, training_bucket:'Get Right' },
    { athlete_name:'Teighan Stoukas',  test_date:'2025-12-03', season:'2025-26', test_phase:'Mid Season',    weight_lbs:125.1,  body_fat_pct:0.164, fat_free_mass_lbs:104.58, height_cm:null, training_bucket:'Get Right' },
    { athlete_name:'Teighan Stoukas',  test_date:'2025-07-10', season:'2025-26', test_phase:'Training Camp', weight_lbs:128.2,  body_fat_pct:0.193, fat_free_mass_lbs:103.46, height_cm:160.5, training_bucket:'Get Right' },
    { athlete_name:'Abby Cullion',     test_date:'2026-04-02', season:'2025-26', test_phase:'Post Season',   weight_lbs:166.32, body_fat_pct:0.280, fat_free_mass_lbs:119.75, height_cm:167, training_bucket:'Get Right' },
    { athlete_name:'Abby Cullion',     test_date:'2025-12-03', season:'2025-26', test_phase:'Mid Season',    weight_lbs:164.12, body_fat_pct:0.271, fat_free_mass_lbs:119.64, height_cm:null, training_bucket:'Get Right' },
    { athlete_name:'Abby Cullion',     test_date:'2025-07-10', season:'2025-26', test_phase:'Training Camp', weight_lbs:158.3,  body_fat_pct:0.216, fat_free_mass_lbs:124.11, height_cm:168.3, training_bucket:'Get Right' },
    { athlete_name:'Mackenzie Fineman',test_date:'2026-04-02', season:'2025-26', test_phase:'Post Season',   weight_lbs:174.9,  body_fat_pct:0.310, fat_free_mass_lbs:120.68, height_cm:168, training_bucket:'Get Right' },
    { athlete_name:'Mackenzie Fineman',test_date:'2025-12-03', season:'2025-26', test_phase:'Mid Season',    weight_lbs:173.31, body_fat_pct:0.280, fat_free_mass_lbs:124.78, height_cm:null, training_bucket:'Get Right' },
    { athlete_name:'Kali Grootenboer', test_date:'2026-04-02', season:'2025-26', test_phase:'Post Season',   weight_lbs:215.16, body_fat_pct:0.236, fat_free_mass_lbs:164.38, height_cm:194, training_bucket:'Individual' },
    { athlete_name:'Kali Grootenboer', test_date:'2025-12-03', season:'2025-26', test_phase:'Mid Season',    weight_lbs:212.5,  body_fat_pct:0.225, fat_free_mass_lbs:164.69, height_cm:null, training_bucket:'Individual' },
    { athlete_name:'Maliyah Ogorek',   test_date:'2026-04-02', season:'2025-26', test_phase:'Post Season',   weight_lbs:137.72, body_fat_pct:0.146, fat_free_mass_lbs:117.61, height_cm:169.6, training_bucket:'Get Right' },
    { athlete_name:'Jodie-Rachel Pierre',test_date:'2026-04-02',season:'2025-26',test_phase:'Post Season',  weight_lbs:167.86, body_fat_pct:0.191, fat_free_mass_lbs:135.80, height_cm:183, training_bucket:'Individual' },
    { athlete_name:'Leah Tate',        test_date:'2026-04-02', season:'2025-26', test_phase:'Post Season',   weight_lbs:158.18, body_fat_pct:0.128, fat_free_mass_lbs:137.93, height_cm:175, training_bucket:'Individual' },
    { athlete_name:'Tito Akinnusi',    test_date:'2026-05-20', season:'2026-27', test_phase:'Other',         weight_lbs:171.105,body_fat_pct:0.228, fat_free_mass_lbs:132.09, height_cm:174, training_bucket:'Individual' },
  ];
  STATE.biodex = [
    { athlete_name:'Abby Cullion',       test_date:'2026-04-30', season:'2025-26', test_phase:'Post Season', quad_l_60:177.3,quad_r_60:143.6,ham_l_60:81.6,ham_r_60:72.9,quad_l_120:145.6,quad_r_120:128,ham_l_120:73.5,ham_r_120:71.2,quad_l_180:112.4,quad_r_180:100.7,ham_l_180:45.4,ham_r_180:43.9,quad_lr_60:0.810,ham_lr_60:0.893,quad_lr_120:0.879,ham_lr_120:0.969,quad_lr_180:0.896,ham_lr_180:0.967,lhq_60:0.460,rhq_60:0.508,lhq_120:0.505,rhq_120:0.556,lhq_180:0.404,rhq_180:0.436,lr_class:'Moderate Imbalance',hq_class:'Moderate Imbalance' },
    { athlete_name:'Mackenzie Fineman',  test_date:'2026-04-30', season:'2025-26', test_phase:'Post Season', quad_l_60:191,quad_r_60:229.5,ham_l_60:98.2,ham_r_60:93.8,quad_l_120:145.3,quad_r_120:171.6,ham_l_120:83,ham_r_120:74.7,quad_l_180:127.2,quad_r_180:121.6,ham_l_180:67,ham_r_180:72.3,quad_lr_60:0.832,ham_lr_60:0.955,quad_lr_120:0.847,ham_lr_120:0.900,quad_lr_180:0.956,ham_lr_180:0.927,lhq_60:0.514,rhq_60:0.409,lhq_120:0.571,rhq_120:0.435,lhq_180:0.527,rhq_180:0.595,lr_class:'Moderate Imbalance',hq_class:'Moderate Imbalance' },
    { athlete_name:'Kali Grootenboer',   test_date:'2026-04-30', season:'2025-26', test_phase:'Post Season', quad_l_60:254.9,quad_r_60:273.7,ham_l_60:133.8,ham_r_60:138.4,quad_l_120:211.1,quad_r_120:211.9,ham_l_120:116.1,ham_r_120:123.2,quad_l_180:174.4,quad_r_180:175.2,ham_l_180:99.9,ham_r_180:99.8,quad_lr_60:0.931,ham_lr_60:0.967,quad_lr_120:0.996,ham_lr_120:0.942,quad_lr_180:0.995,ham_lr_180:0.999,lhq_60:0.525,rhq_60:0.506,lhq_120:0.550,rhq_120:0.581,lhq_180:0.573,rhq_180:0.570,lr_class:'No Imbalance',hq_class:'Moderate Imbalance' },
    { athlete_name:'Maliyah Ogorek',     test_date:'2026-04-30', season:'2025-26', test_phase:'Post Season', quad_l_60:124.6,quad_r_60:138.6,ham_l_60:68.1,ham_r_60:53.4,quad_l_120:120,quad_r_120:113.6,ham_l_120:37.7,ham_r_120:46.5,quad_l_180:103.6,quad_r_180:105.1,ham_l_180:34.2,ham_r_180:24.5,quad_lr_60:0.899,ham_lr_60:0.716,quad_lr_120:0.947,ham_lr_120:0.811,quad_lr_180:0.986,ham_lr_180:0.716,lhq_60:0.547,rhq_60:0.385,lhq_120:0.314,rhq_120:0.409,lhq_180:0.330,rhq_180:0.233,lr_class:'Moderate Imbalance',hq_class:'Moderate Imbalance' },
    { athlete_name:'Jodie-Rachel Pierre',test_date:'2026-04-30', season:'2025-26', test_phase:'Post Season', quad_l_60:166.4,quad_r_60:161.3,ham_l_60:55.7,ham_r_60:81.8,quad_l_120:126.6,quad_r_120:151.6,ham_l_120:44.5,ham_r_120:68.2,quad_l_180:92.2,quad_r_180:85,ham_l_180:10.4,ham_r_180:27.4,quad_lr_60:0.969,ham_lr_60:0.681,quad_lr_120:0.835,ham_lr_120:0.652,quad_lr_180:0.922,ham_lr_180:0.380,lhq_60:0.335,rhq_60:0.507,lhq_120:0.352,rhq_120:0.450,lhq_180:0.113,rhq_180:0.322,lr_class:'Moderate Imbalance',hq_class:'Moderate Imbalance' },
    { athlete_name:'Teighan Stoukas',    test_date:'2026-04-30', season:'2025-26', test_phase:'Post Season', quad_l_60:132.5,quad_r_60:137.5,ham_l_60:73.8,ham_r_60:56.7,quad_l_120:116.1,quad_r_120:123.8,ham_l_120:63.5,ham_r_120:56.4,quad_l_180:99.8,quad_r_180:97.8,ham_l_180:59.9,ham_r_180:55.9,quad_lr_60:0.964,ham_lr_60:0.768,quad_lr_120:0.938,ham_lr_120:0.888,quad_lr_180:0.980,ham_lr_180:0.933,lhq_60:0.557,rhq_60:0.412,lhq_120:0.547,rhq_120:0.456,lhq_180:0.600,rhq_180:0.572,lr_class:'Moderate Imbalance',hq_class:'Moderate Imbalance' },
    { athlete_name:'Tito Akinnusi',      test_date:'2026-05-20', season:'2026-27', test_phase:'Other',       quad_l_60:182.4,quad_r_60:235.1,ham_l_60:104.8,ham_r_60:104.7,quad_l_120:158.4,quad_r_120:206.2,ham_l_120:93.6,ham_r_120:97.5,quad_l_180:128.3,quad_r_180:162,ham_l_180:80.8,ham_r_180:86,quad_lr_60:0.776,ham_lr_60:0.999,quad_lr_120:0.768,ham_lr_120:0.960,quad_lr_180:0.792,ham_lr_180:0.940,lhq_60:0.575,rhq_60:0.445,lhq_120:0.591,rhq_120:0.473,lhq_180:0.630,rhq_180:0.531,lr_class:'Moderate Imbalance',hq_class:'Moderate Imbalance' },
  ];
}

// ── Sport filter ───────────────────────────────────────────
function onSportChange() {
  STATE.filters.sport = document.getElementById('fSport').value;
  const subtitle = document.getElementById('headerSubtitle');
  if (subtitle) subtitle.textContent = `University of Windsor · ${STATE.filters.sport === 'all' ? 'Multi-Sport Dashboard' : STATE.filters.sport}`;
  reloadData();
}

async function reloadData() {
  try {
    const sport  = STATE.filters.sport === 'all' ? '' : `&sport=${encodeURIComponent(STATE.filters.sport)}`;
    const season = STATE.filters.season;

    // Fetch athletes with "all" season fallback so imported athletes in any season always show up
    // We request the current filtered season but also accept anyone with data in the db
    const [athletes, BIOPOD, biodex] = await Promise.all([
      apiFetch(`/athletes?season=all${sport}`).catch(() => apiFetch(`/athletes?season=${season}${sport}`)),
      apiFetch(`/bodpod?season=${season}${sport}`).catch(() => []),
      apiFetch(`/biodex?season=${season}${sport}`).catch(() => []),
    ]);

    STATE.athletes = athletes;
    STATE.BIOPOD   = BIOPOD;
    STATE.biodex   = biodex;

    // Refresh all athlete select dropdowns
    ['athleteSelect','cmp1','cmp2'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const prev = el.value;
      while (el.options.length > 1) el.remove(1);
      STATE.athletes.forEach(a => {
        const o = document.createElement('option');
        o.value = a.name; o.text = a.name;
        el.appendChild(o);
      });
      el.value = prev;
    });

    if (STATE.activePage === 'overview')  renderOverview();
    if (STATE.activePage === 'BIOPOD')    renderBIOPOD();
    if (STATE.activePage === 'biodex')    renderBiodex();
    if (STATE.activePage === 'compare')   renderComparison();
    toast(`Data refreshed · ${STATE.athletes.length} athletes loaded`, 'success', 2000);
  } catch (err) {
    toast(`Failed to reload data: ${err.message}`, 'error');
  }
}

// ── Compare page with sport-level comparison ───────────────
function renderSportComparison() {
  const metric = document.getElementById('sportCmpMetric')?.value || 'bf';
  const grouped = {};
  if (metric === 'bf') {
    STATE.BIOPOD.forEach(r => {
      const sport = r.sport || "Women's Basketball";
      if (!grouped[sport]) grouped[sport] = [];
      if (r.body_fat_pct) grouped[sport].push(r.body_fat_pct * 100);
    });
  } else if (metric === 'ffm') {
    STATE.BIOPOD.forEach(r => {
      const sport = r.sport || "Women's Basketball";
      if (!grouped[sport]) grouped[sport] = [];
      if (r.fat_free_mass_lbs) grouped[sport].push(+r.fat_free_mass_lbs);
    });
  } else {
    STATE.biodex.forEach(r => {
      const sport = r.sport || "Women's Basketball";
      if (!grouped[sport]) grouped[sport] = [];
      if (r.quad_lr_60) grouped[sport].push(r.quad_lr_60 * 100);
    });
  }
  const labels = Object.keys(grouped);
  const avgs   = labels.map(s => { const arr = grouped[s]; return arr.length ? +(arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1) : 0; });
  mkChart('sport_cmpChart', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: metric === 'bf' ? 'Avg Body Fat %' : metric === 'ffm' ? 'Avg Fat Free Mass (lbs)' : 'Avg Quad L:R %',
        data: avgs,
        backgroundColor: labels.map((_,i) => PALETTE[i % PALETTE.length] + '88'),
        borderColor:     labels.map((_,i) => PALETTE[i % PALETTE.length]),
        borderWidth: 2, borderRadius: 6,
      }],
    },
    options: { ...CHART_DEFAULTS, indexAxis: labels.length > 5 ? 'y' : 'x' },
  });
}

// ── Page switching (updated to include upload/compare extras) ──
const _origSwitchPage = switchPage;

// ── PDF Upload page ────────────────────────────────────────
function handleFileSelect(event) {
  const files = Array.from(event.target.files);
  if (!files.length) return;
  processUploadFiles(files);
}

// Drag-and-drop setup
document.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('uploadZone');
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    if (files.length) processUploadFiles(files);
  });
});

// ── ETL Progress animation ─────────────────────────────────
const ETL_STEPS = [
  { id:'upload',  icon:'📤', label:'Uploading PDF to server',           detail:'Transferring file via multipart upload' },
  { id:'detect',  icon:'🔍', label:'Detecting report type',             detail:'Scanning for Biodex / BOD POD markers' },
  { id:'extract', icon:'📊', label:'Extracting data fields from PDF',   detail:'Python pdfplumber parsing pages' },
  { id:'parse',   icon:'🧠', label:'Computing ratios & classifications', detail:'L:R ratios · H:Q ratios · asymmetry flags' },
  { id:'match',   icon:'🏃', label:'Matching athlete record',           detail:'Fuzzy name resolution against DB' },
  { id:'store',   icon:'💾', label:'Storing extraction in database',    detail:'Writing to pdf_uploads (status: pending)' },
];

function showETLProgress(fileCount) {
  const resultsEl = document.getElementById('uploadResults');
  const steps = [
    { icon: '📤', label: 'Uploading file(s) to server...', pct: 15 },
    { icon: '🔍', label: 'Detecting report type (Biodex / BOD POD)...', pct: 30 },
    { icon: '📊', label: 'Extracting data fields from PDF...', pct: 55 },
    { icon: '🧠', label: 'Parsing values & computing ratios...', pct: 75 },
    { icon: '🏃', label: 'Matching athlete records...', pct: 88 },
    { icon: '✅', label: 'Finalising extraction...', pct: 98 },
  ];

  resultsEl.innerHTML = `
    <div id="etlProgressBox" style="background:#1a1d2e;border:1px solid #2a2f4a;border-radius:12px;padding:24px;margin-top:8px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">
        <span style="font-size:1.6rem;animation:etlSpin 1.2s linear infinite" id="etlIcon">⚙️</span>
        <div>
          <div style="font-weight:700;color:#e8eaf0;font-size:.95rem">ETL Pipeline Running</div>
          <div style="font-size:.78rem;color:#7a8299">${fileCount} file${fileCount !== 1 ? 's' : ''} · Python extractor active</div>
        </div>
        <div style="margin-left:auto;font-size:.85rem;color:#c8a84b;font-weight:700;font-variant-numeric:tabular-nums" id="etlPct">0%</div>
      </div>
      <div style="background:#12152a;border-radius:20px;height:10px;overflow:hidden;margin-bottom:20px">
        <div id="etlBar" style="height:100%;background:linear-gradient(90deg,#c8a84b,#f6ad55);border-radius:20px;width:0%;transition:width .5s cubic-bezier(.4,0,.2,1)"></div>
      </div>
      <div id="etlTimeline" style="display:flex;flex-direction:column;gap:0">
        ${ETL_STEPS.map((s, i) => `
          <div id="etl-step-${i}" style="display:flex;align-items:flex-start;gap:12px;padding:9px 0;border-bottom:${i < ETL_STEPS.length - 1 ? '1px solid #1e2238' : 'none'};opacity:.35;transition:opacity .3s,transform .3s;transform:translateX(-4px)">
            <div style="width:28px;height:28px;border-radius:50%;background:#12152a;border:2px solid #2a2f4a;display:flex;align-items:center;justify-content:center;font-size:.9rem;flex-shrink:0;transition:all .3s" id="etl-dot-${i}">${s.icon}</div>
            <div>
              <div style="font-size:.83rem;font-weight:600;color:#7a8299;transition:color .3s" id="etl-label-${i}">${s.label}</div>
              <div style="font-size:.72rem;color:#4a5068;margin-top:2px">${s.detail}</div>
            </div>
            <div style="margin-left:auto;font-size:.72rem;font-weight:600;padding:2px 8px;border-radius:10px;opacity:0;transition:opacity .3s" id="etl-badge-${i}">waiting</div>
          </div>`).join('')}
      </div>
    </div>`;

  const pcts = [15, 30, 50, 68, 84, 96];
  let stepIdx = 0;

  function activateStep(i) {
    const row   = document.getElementById(`etl-step-${i}`);
    const dot   = document.getElementById(`etl-dot-${i}`);
    const label = document.getElementById(`etl-label-${i}`);
    const badge = document.getElementById(`etl-badge-${i}`);
    const bar   = document.getElementById('etlBar');
    const pctEl = document.getElementById('etlPct');
    if (row)   { row.style.opacity = '1'; row.style.transform = 'translateX(0)'; }
    if (dot)   { dot.style.background = '#c8a84b'; dot.style.borderColor = '#c8a84b'; dot.style.boxShadow = '0 0 8px #c8a84b88'; }
    if (label) { label.style.color = '#e8eaf0'; }
    if (badge) { badge.style.opacity = '1'; badge.textContent = 'running'; badge.style.background = '#2d2a1a'; badge.style.color = '#c8a84b'; }
    if (bar)   bar.style.width = pcts[i] + '%';
    if (pctEl) pctEl.textContent = pcts[i] + '%';
    // Mark previous step done
    if (i > 0) {
      const prevDot   = document.getElementById(`etl-dot-${i - 1}`);
      const prevBadge = document.getElementById(`etl-badge-${i - 1}`);
      if (prevDot)   { prevDot.style.background = '#38a169'; prevDot.style.borderColor = '#38a169'; prevDot.style.boxShadow = '0 0 6px #38a16988'; prevDot.textContent = '✓'; }
      if (prevBadge) { prevBadge.textContent = 'done'; prevBadge.style.background = '#1a2e22'; prevBadge.style.color = '#68d391'; }
    }
  }

  const interval = setInterval(() => {
    if (stepIdx >= ETL_STEPS.length) { clearInterval(interval); return; }
    activateStep(stepIdx);
    stepIdx++;
  }, 700);

  // Return cleanup fn
  return () => clearInterval(interval);
}

function showExtractionDoneModal(uploads) {
  document.getElementById('extractionDoneModal')?.remove();
  const ok  = uploads.filter(u => u.status !== 'error').length;
  const err = uploads.filter(u => u.status === 'error').length;

  const modal = document.createElement('div');
  modal.id = 'extractionDoneModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;animation:fadeIn .2s ease';
  modal.innerHTML = `
    <div style="background:#1a1d2e;border:1px solid #c8a84b;border-radius:16px;padding:28px 32px;max-width:460px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.6)">
      <div style="font-size:2.8rem;margin-bottom:10px">${err === uploads.length ? '❌' : '🎯'}</div>
      <div style="font-size:1.15rem;font-weight:700;color:#e8eaf0;margin-bottom:6px">
        ${err === uploads.length ? 'Extraction Failed' : 'Data Extracted!'}
      </div>
      <div style="font-size:.85rem;color:#7a8299;margin-bottom:18px">
        ${ok > 0  ? `<span style="color:#68d391;font-weight:600">${ok} file${ok!==1?'s':''} ready to import</span>` : ''}
        ${err > 0 ? `<span style="color:#fc8181;font-weight:600;margin-left:${ok>0?'8px':'0'}">${err} failed</span>` : ''}
      </div>
      ${ok > 0 ? `
        <div style="background:#12152a;border-radius:8px;padding:10px 12px;margin-bottom:18px;text-align:left">
          ${uploads.filter(u=>u.status!=='error').map(u=>`
            <div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:.82rem;border-bottom:1px solid #1e2238">
              <span>${u.pdf_type==='biodex'?'💪':'⚖️'}</span>
              <span style="color:#e8eaf0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${u.file_name}</span>
              <span style="color:#c8a84b;font-size:.72rem;font-weight:700">${(u.pdf_type||'').toUpperCase()}</span>
            </div>`).join('')}
        </div>
        <div style="font-size:.8rem;color:#c8a84b;margin-bottom:18px">👇 Scroll down · confirm athlete · click <strong>Import to DB</strong></div>
      ` : ''}
      <button onclick="document.getElementById('extractionDoneModal').remove()"
        style="background:#c8a84b;color:#0d0f1e;border:none;border-radius:8px;padding:10px 28px;font-weight:700;cursor:pointer;font-size:.88rem">
        Got it — Review & Import
      </button>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  setTimeout(() => modal?.remove(), 10000);
}

async function processUploadFiles(files) {
  const sport   = document.getElementById('upSport')?.value  || "Women's Basketball";
  const season  = document.getElementById('upSeason')?.value || '2025-26';
  const phase   = document.getElementById('upPhase')?.value  || 'Post Season';
  const dateVal = document.getElementById('upDate')?.value   || '';

  const stopProgress = showETLProgress(files.length);

  const formData = new FormData();
  files.forEach(f => formData.append('pdfs', f));
  formData.append('sport', sport);
  formData.append('season', season);
  formData.append('phase', phase);
  if (dateVal) formData.append('test_date', dateVal);

  try {
    const res = await fetch(`${API}/upload`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    const data = await res.json();
    stopProgress();

    // Mark all steps done, bar to 100% green
    const bar   = document.getElementById('etlBar');
    const pctEl = document.getElementById('etlPct');
    const icon  = document.getElementById('etlIcon');
    if (bar)   { bar.style.width = '100%'; bar.style.background = 'linear-gradient(90deg,#38a169,#68d391)'; }
    if (pctEl) pctEl.textContent = '100%';
    if (icon)  { icon.style.animation = 'none'; icon.textContent = '✅'; }
    ETL_STEPS.forEach((_, i) => {
      const dot   = document.getElementById(`etl-dot-${i}`);
      const badge = document.getElementById(`etl-badge-${i}`);
      const row   = document.getElementById(`etl-step-${i}`);
      if (dot)   { dot.style.background='#38a169'; dot.style.borderColor='#38a169'; dot.style.boxShadow='0 0 6px #38a16988'; dot.textContent='✓'; }
      if (badge) { badge.style.opacity='1'; badge.textContent='done'; badge.style.background='#1a2e22'; badge.style.color='#68d391'; }
      if (row)   { row.style.opacity='1'; row.style.transform='translateX(0)'; }
    });

    setTimeout(() => {
      renderUploadResults(data.uploads || [], sport, season, phase, dateVal);
      loadUploadHistory();
      showExtractionDoneModal(data.uploads || []);
    }, 500);

  } catch (err) {
    stopProgress();
    const resultsEl = document.getElementById('uploadResults');
    resultsEl.innerHTML = `<div style="color:var(--danger);padding:20px;background:#1a1d2e;border-radius:8px;border:1px solid #e53e3e">❌ ${err.message}</div>`;
    toast('Upload failed: ' + err.message, 'error');
  }
}

function renderUploadResults(uploads, sport, season, phase, dateOverride) {
  const el = document.getElementById('uploadResults');
  if (!uploads.length) { el.innerHTML = ''; return; }

  el.innerHTML = uploads.map(u => {
    const p        = u.preview || {};
    const header   = p.header || {};
    const isError  = u.status === 'error';
    const isBiodex = u.pdf_type === 'biodex';
    const isBodpod = u.pdf_type === 'bodpod';
    const typeIcon = isBiodex ? '💪' : isBodpod ? '⚖️' : '📄';
    const typeLabel = isBiodex ? 'Biodex' : isBodpod ? 'BOD POD' : 'Unknown';

    // Build preview fields grid
    const fields = [];
    if (isBodpod) {
      if (p.body_fat_pct   != null) fields.push(['Body Fat %',    (p.body_fat_pct * 100).toFixed(1) + '%', p.body_fat_pct > 0.25 ? '#e53e3e' : p.body_fat_pct >= 0.20 ? '#dd6b20' : '#68d391']);
      if (p.fat_free_mass_lbs != null) fields.push(['FFM (lbs)',  (+p.fat_free_mass_lbs).toFixed(1), '#c8a84b']);
      if (p.weight_lbs     != null) fields.push(['Weight (lbs)',  (+p.weight_lbs).toFixed(1), '#e8eaf0']);
      if (p.fat_mass_kg    != null) fields.push(['Fat Mass (kg)', (+p.fat_mass_kg).toFixed(2), '#e8eaf0']);
      if (p.body_density   != null) fields.push(['Body Density',  (+p.body_density).toFixed(4), '#e8eaf0']);
      if (p.ree_kcal       != null) fields.push(['REE (kcal/d)',  p.ree_kcal, '#e8eaf0']);
      if (p.tee_kcal       != null) fields.push(['TEE (kcal/d)',  p.tee_kcal, '#e8eaf0']);
      if (p.activity_level)         fields.push(['Activity',      p.activity_level, '#4b8ec8']);
    } else if (isBiodex) {
      if (p.quad_l_60  != null) fields.push(['Quad L 60°',  p.quad_l_60 + ' Nm', '#4b8ec8']);
      if (p.quad_r_60  != null) fields.push(['Quad R 60°',  p.quad_r_60 + ' Nm', '#4b8ec8']);
      if (p.ham_l_60   != null) fields.push(['Ham L 60°',   p.ham_l_60  + ' Nm', '#68d391']);
      if (p.ham_r_60   != null) fields.push(['Ham R 60°',   p.ham_r_60  + ' Nm', '#68d391']);
      if (p.quad_lr_60 != null) fields.push(['Quad L:R 60°', (p.quad_lr_60*100).toFixed(1)+'%', p.quad_lr_60<0.80?'#e53e3e':p.quad_lr_60<0.90?'#dd6b20':'#68d391']);
      if (p.ham_lr_60  != null) fields.push(['Ham L:R 60°',  (p.ham_lr_60*100).toFixed(1)+'%',  p.ham_lr_60<0.80?'#e53e3e':p.ham_lr_60<0.90?'#dd6b20':'#68d391']);
      if (p.lhq_60     != null) fields.push(['L H:Q 60°',   (p.lhq_60*100).toFixed(1)+'%',  '#b794f4']);
      if (p.rhq_60     != null) fields.push(['R H:Q 60°',   (p.rhq_60*100).toFixed(1)+'%',  '#b794f4']);
      if (p.lr_class)            fields.push(['L:R Class',   p.lr_class, p.lr_class?.includes('Moderate')?'#dd6b20':'#68d391']);
      if (p.hq_class)            fields.push(['H:Q Class',   p.hq_class, p.hq_class?.includes('Moderate')?'#dd6b20':'#68d391']);
    }

    // matchedName: directly use the PDF filename as requested
    const matchedName = u.file_name ? u.file_name.replace(/\.pdf$/i, '').trim() : '';
    const nameHint = `<span style="font-size:.72rem;color:#68d391;margin-left:6px">✓ from filename</span>`;

    // Build athlete dropdown: existing athletes + extracted name if not already in list
    const isMatch = (dbName) => matchedName && dbName.toLowerCase().trim() === matchedName.toLowerCase().trim();
    const extractedNotInList = matchedName && !STATE.athletes.find(a => isMatch(a.name));
    const athleteOptions = [
      `<option value="">— Select or confirm athlete —</option>`,
      ...STATE.athletes.map(a =>
        `<option value="${a.id}" data-name="${a.name}" ${isMatch(a.name) ? 'selected' : ''}>${a.name}</option>`
      ),
      // Always show "create new" option; if name was extracted from PDF and not in DB, pre-fill it
      `<option value="__new__" data-name="${matchedName}" ${extractedNotInList ? 'selected' : ''}>+ Create new: "${matchedName || 'Enter name below'}"</option>`,
    ].join('');

    // If extracted name not in DB, show a name-edit input
    const newNameInput = `
      <div id="ar-newname-wrap-${u.upload_id}" style="display:${extractedNotInList ? 'block' : 'none'};margin-top:6px">
        <input id="ar-newname-${u.upload_id}" type="text" value="${matchedName}"
          placeholder="Full athlete name..."
          style="background:#12152a;border:1px solid #c8a84b;border-radius:6px;color:#e8eaf0;padding:7px 10px;font-size:.82rem;width:100%"
        />
        <div style="font-size:.72rem;color:#c8a84b;margin-top:3px">
          ⚠️ This name was extracted from the PDF but isn't in the database yet. A new athlete record will be created on import.
        </div>
      </div>`;

    // Status track: extracted → pending → imported
    const track = `
      <div style="display:flex;align-items:center;gap:0;margin:14px 0 10px;font-size:.72rem;font-weight:600">
        <div style="display:flex;align-items:center;gap:6px;color:#68d391">
          <div style="width:20px;height:20px;border-radius:50%;background:#38a169;display:flex;align-items:center;justify-content:center;font-size:.7rem">✓</div>
          Extracted
        </div>
        <div style="flex:1;height:2px;background:${isError ? '#2a2f4a' : '#c8a84b'};margin:0 8px"></div>
        <div id="track-pending-${u.upload_id}" style="display:flex;align-items:center;gap:6px;color:${isError ? '#4a5068' : '#c8a84b'}">
          <div style="width:20px;height:20px;border-radius:50%;background:${isError ? '#1a1d2e' : '#2d2a1a'};border:2px solid ${isError ? '#2a2f4a' : '#c8a84b'};display:flex;align-items:center;justify-content:center;font-size:.7rem">${isError ? '—' : '⏳'}</div>
          ${isError ? 'Skipped' : 'Pending'}
        </div>
        <div style="flex:1;height:2px;background:#2a2f4a;margin:0 8px" id="track-line-${u.upload_id}"></div>
        <div id="track-imported-${u.upload_id}" style="display:flex;align-items:center;gap:6px;color:#4a5068">
          <div style="width:20px;height:20px;border-radius:50%;background:#1a1d2e;border:2px solid #2a2f4a;display:flex;align-items:center;justify-content:center;font-size:.7rem">○</div>
          Imported
        </div>
      </div>`;

    return `
      <div class="upload-card ${isError ? 'error' : 'pending'}" id="uc-${u.upload_id}" style="transition:border-color .4s,background .4s">
        <div class="uc-header">
          <div style="flex:1;min-width:0">
            <div class="uc-name" style="display:flex;align-items:center;gap:8px">
              <span style="font-size:1.1rem">${typeIcon}</span>
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${u.file_name}</span>
            </div>
            <div class="uc-meta">
              ${typeLabel}${header.test_date ? ' · 📅 ' + header.test_date : ''}${header.patient_name ? ' · 👤 ' + header.patient_name : ''}${nameHint}
            </div>
          </div>
          <span id="uc-badge-${u.upload_id}" class="badge ${isError ? 'badge-concern' : 'badge-monitoring'}" style="white-space:nowrap;flex-shrink:0">
            ${isError ? '❌ Error' : '⏳ Pending Import'}
          </span>
        </div>

        ${track}

        ${isError ? `<div style="color:var(--danger);font-size:.82rem;margin:8px 0;padding:10px;background:#1a0a0a;border-radius:6px;border-left:3px solid #e53e3e">⚠️ ${u.error}</div>` : ''}

        ${fields.length ? `
          <div class="uc-grid" style="margin:10px 0">
            ${fields.map(([l,v,c]) => `
              <div class="uc-field">
                <div class="uc-field-label">${l}</div>
                <div class="uc-field-val" style="color:${c || '#c8a84b'}">${v}</div>
              </div>`).join('')}
          </div>` : ''}

        ${!isError ? `
          <div class="athlete-resolve" id="ar-row-${u.upload_id}" style="margin-top:4px">
            <select id="ar-athlete-${u.upload_id}"
              style="background:#12152a;border:1px solid #2a2f4a;border-radius:6px;color:#e8eaf0;padding:7px 10px;font-size:.82rem;flex:1"
              onchange="onAthleteSelectChange(${u.upload_id})">
              ${athleteOptions}
            </select>
            <button class="btn-import" id="btn-import-${u.upload_id}" onclick="confirmImport(${u.upload_id}, '${sport}', '${season}', '${phase}', '${dateOverride}')">
              Import to DB
            </button>
          </div>
          ${newNameInput}` : ''}
      </div>`;
  }).join('');
}

// Show/hide new-athlete name input when "__new__" option chosen
function onAthleteSelectChange(uploadId) {
  const sel = document.getElementById(`ar-athlete-${uploadId}`);
  const wrap = document.getElementById(`ar-newname-wrap-${uploadId}`);
  if (!sel || !wrap) return;
  if (sel.value === '__new__') {
    wrap.style.display = 'block';
    // Pre-fill with data-name from the selected option
    const input = document.getElementById(`ar-newname-${uploadId}`);
    const dataName = sel.options[sel.selectedIndex]?.dataset?.name || '';
    if (input && dataName && !input.value) input.value = dataName;
  } else {
    wrap.style.display = 'none';
  }
}

async function confirmImport(uploadId, sport, season, phase, dateOverride) {
  const athleteSel = document.getElementById(`ar-athlete-${uploadId}`);
  const selVal     = athleteSel?.value;
  let athleteId = null, athleteName = null, createAthlete = false;

  if (selVal === '__new__') {
    // Get name from the editable input first, fall back to dropdown data-name
    const nameInput = document.getElementById(`ar-newname-${uploadId}`);
    const rawName   = (nameInput?.value || athleteSel.options[athleteSel.selectedIndex]?.dataset?.name || '').trim();
    if (!rawName) {
      toast('Please enter a name for the new athlete', 'error');
      if (nameInput) { nameInput.style.border = '1px solid #e53e3e'; nameInput.focus(); }
      return;
    }
    athleteName   = rawName;
    createAthlete = true;
  } else if (selVal) {
    athleteId   = parseInt(selVal);
    athleteName = athleteSel.options[athleteSel.selectedIndex].dataset.name || athleteSel.options[athleteSel.selectedIndex].text;
  } else {
    toast('Please select an athlete first', 'error');
    return;
  }

  const btn   = document.getElementById(`btn-import-${uploadId}`);
  const card  = document.getElementById(`uc-${uploadId}`);
  const badge = document.getElementById(`uc-badge-${uploadId}`);
  const trackLine = document.getElementById(`track-line-${uploadId}`);

  // ── State: IMPORTING ──────────────────────────────────
  if (btn)  { btn.disabled = true; btn.textContent = '⏳ Importing…'; btn.style.background='#1a1d2e'; btn.style.color='#c8a84b'; btn.style.border='1px solid #c8a84b'; }
  if (badge){ badge.style.cssText='background:#2d2a1a;color:#c8a84b;border:1px solid #c8a84b;font-weight:700;padding:4px 12px;border-radius:10px;white-space:nowrap;font-size:.78rem'; badge.textContent='⏳ Importing…'; }
  if (trackLine) { trackLine.style.background='linear-gradient(90deg,#c8a84b,#4b8ec8)'; trackLine.style.animation='etlPulse 1s infinite'; }

  try {
    const payload = { athlete_id: athleteId, athlete_name: athleteName, sport, season, phase, create_athlete: createAthlete };
    if (dateOverride) payload.test_date = dateOverride;

    const res = await fetch(`${API}/upload/import/${uploadId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed');

    // Detect pdf type from the card meta text
    const metaEl  = document.querySelector(`#uc-${uploadId} .uc-meta`);
    const pdfType = metaEl?.textContent?.toLowerCase().includes('biodex') ? 'biodex' : 'bodpod';
    const pageId  = pdfType === 'biodex' ? 'biodex' : 'BIOPOD';
    const pageIcon = pdfType === 'biodex' ? '💪' : '⚖️';
    const pageName = pdfType === 'biodex' ? 'Biodex' : 'BOD POD';

    // ── State: DONE ────────────────────────────────────
    // Card visual
    if (card) {
      card.classList.remove('pending', 'error');
      card.classList.add('imported');          // triggers doneFlash animation + green bg
    }

    // Badge — bright green "✅ Done"
    if (badge) {
      badge.style.cssText = 'background:#1a3a22;color:#68d391;border:1px solid #38a169;font-weight:800;padding:5px 14px;border-radius:10px;white-space:nowrap;font-size:.82rem;letter-spacing:.02em';
      badge.textContent   = '✅ Done';
    }

    // Status track — all green
    const pendingNode  = document.getElementById(`track-pending-${uploadId}`);
    const importedNode = document.getElementById(`track-imported-${uploadId}`);
    if (trackLine) { trackLine.style.animation='none'; trackLine.style.background='#38a169'; }
    if (pendingNode) {
      pendingNode.style.color = '#68d391';
      const d = pendingNode.querySelector('div');
      if (d) { d.style.cssText='width:20px;height:20px;border-radius:50%;background:#38a169;border:none;display:flex;align-items:center;justify-content:center;font-size:.7rem'; d.textContent='✓'; }
    }
    if (importedNode) {
      importedNode.style.color = '#68d391';
      const d = importedNode.querySelector('div');
      if (d) { d.style.cssText='width:20px;height:20px;border-radius:50%;background:#38a169;border:none;display:flex;align-items:center;justify-content:center;font-size:.7rem;box-shadow:0 0 8px #38a16988'; d.textContent='✓'; }
    }

    // Add to recent imports for highlighting
    STATE.recentImports.push({ name: athleteName });
    
    // Reload data to merge the newly imported PDF immediately
    await reloadData();

    // Replace the athlete-select row with a done banner + action buttons
    const arRow = document.getElementById(`ar-row-${uploadId}`);
    if (arRow) {
      arRow.outerHTML = `
        <div class="uc-done-banner">
          <div class="uc-done-checkmark">✓</div>
          <div class="uc-done-text">
            <strong>Imported to database</strong>
            <span>Athlete: ${athleteName} · ${pageName}</span>
          </div>
        </div>
        <div class="uc-action-btns">
          <button class="btn-view-analytics" onclick="(function(){const b=document.querySelector('[data-page=\\'${pageId}\\']');if(b)switchPage(b);window.scrollTo({top:0,behavior:'smooth'});})()">
            READY TO VIEW DATA ANALYTICS
          </button>
          <button class="btn-athlete-profile" onclick="openAthleteModal('${athleteName.replace(/'/g,"\\'")}')" >
            🎯 Athlete Profile
          </button>
        </div>`;
    }

    // Success popup
    showImportSuccessModal(athleteName, pdfType);
    toast(`✅ Imported for ${athleteName}`, 'success');
    loadUploadHistory();
    reloadData();

  } catch (err) {
    // ── State: ERROR ──────────────────────────────────
    toast('Import failed: ' + err.message, 'error');
    if (btn)  { btn.disabled=false; btn.textContent='⚠️ Retry Import'; btn.style.background='#c8a84b'; btn.style.color='#0d0f1e'; btn.style.border='none'; }
    if (badge){ badge.style.cssText='background:#2d0f0f;color:#fc8181;border:1px solid #e53e3e;font-weight:700;padding:4px 12px;border-radius:10px;white-space:nowrap;font-size:.78rem'; badge.textContent='❌ Error'; }
    if (trackLine) { trackLine.style.animation='none'; trackLine.style.background='#e53e3e33'; }
  }
}

function viewAnalytics(pdfType, athleteName) {
  const targetPage = pdfType === 'biodex' ? 'biodex' : 'BIOPOD';
  const tabBtn = document.querySelector(`[data-page="${targetPage}"]`);
  if (tabBtn) switchPage(tabBtn);
  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showImportSuccessModal(athleteName, pdfType) {
  document.getElementById('importSuccessModal')?.remove();
  const pageName = pdfType === 'biodex' ? 'Biodex' : 'BOD POD';
  const pageId   = pdfType === 'biodex' ? 'biodex' : 'BIOPOD';
  const pageIcon = pdfType === 'biodex' ? '💪' : '⚖️';
  const modal = document.createElement('div');
  modal.id = 'importSuccessModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;animation:fadeIn .15s ease';
  modal.innerHTML = `
    <div style="background:#0f1a14;border:2px solid #38a169;border-radius:16px;padding:32px;max-width:420px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.7)">
      <div style="font-size:3rem;margin-bottom:8px;animation:fadeIn .3s .1s both">🎉</div>
      <div style="font-size:1.15rem;font-weight:700;color:#68d391;margin-bottom:6px">Import Successful!</div>
      <div style="font-size:.88rem;color:#7a8299;margin-bottom:24px">
        <strong style="color:#e8eaf0">${athleteName}</strong>'s ${pageName} data is live in PostgreSQL.
      </div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <button id="_imp_view_btn"
          style="background:#c8a84b;color:#0d0f1e;border:none;border-radius:8px;padding:10px 20px;font-weight:700;cursor:pointer;font-size:.85rem">
          READY TO VIEW DATA ANALYTICS
        </button>
        <button id="_imp_athlete_btn"
          style="background:#12152a;color:#c8a84b;border:1px solid #c8a84b;border-radius:8px;padding:10px 20px;font-weight:700;cursor:pointer;font-size:.85rem">
          🎯 Athlete Profile
        </button>
        <button onclick="document.getElementById('importSuccessModal').remove()"
          style="background:#12152a;color:#7a8299;border:1px solid #2a2f4a;border-radius:8px;padding:10px 14px;cursor:pointer;font-size:.82rem">✕</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  document.getElementById('_imp_view_btn').onclick = () => {
    modal.remove();
    const btn = document.querySelector(`[data-page="${pageId}"]`);
    if (btn) switchPage(btn);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  document.getElementById('_imp_athlete_btn').onclick = () => {
    modal.remove();
    openAthleteModal(athleteName);
  };
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  setTimeout(() => modal?.remove(), 14000);
}

async function loadUploadHistory() {
  const tbody = document.getElementById('historyBody');
  if (!tbody) return;
  try {
    const history = await apiFetch('/upload/history?limit=30');
    if (!history.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#7a8299;padding:20px">No uploads yet — drop a PDF above to get started.</td></tr>';
      return;
    }
    tbody.innerHTML = history.map(h => {
      const isPending  = h.status === 'pending';
      const isImported = h.status === 'imported';
      const isError    = h.status === 'error';

      // Animated status pill
      const statusHtml = isPending
        ? `<span class="status-pill pending" style="display:inline-flex;align-items:center;gap:5px">
             <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#c8a84b;animation:etlPulse .9s infinite"></span>
             pending
           </span>`
        : isImported
        ? `<span class="status-pill imported" style="display:inline-flex;align-items:center;gap:5px">
             <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#63b3ed"></span>
             imported
           </span>`
        : `<span class="status-pill error" title="${h.error_msg||''}" style="display:inline-flex;align-items:center;gap:5px">
             <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#fc8181"></span>
             error
           </span>`;

      const actionHtml = isPending
        ? `<span style="color:#c8a84b;font-size:.75rem">👆 Select athlete above &amp; Import</span>`
        : isImported
        ? `<div style="display:flex;gap:6px;align-items:center">
             <span style="color:#7a8299;font-size:.72rem">${h.imported_at || ''}</span>
             <button onclick="viewAnalytics('${h.pdf_type}','${(h.athlete_name||'').replace(/'/g,"\\'")}')"
               style="background:#1a1d2e;border:1px solid #4b8ec8;border-radius:6px;color:#4b8ec8;padding:3px 8px;font-size:.72rem;cursor:pointer;font-weight:600">📊 View</button>
             <button onclick="openAthleteModal('${(h.athlete_name||'').replace(/'/g,"\\'")}')"
               style="background:#1a1d2e;border:1px solid #c8a84b;border-radius:6px;color:#c8a84b;padding:3px 8px;font-size:.72rem;cursor:pointer;font-weight:600">🎯 Profile</button>
           </div>`
        : `<span style="color:#fc8181;font-size:.75rem">${h.error_msg || 'Extraction failed'}</span>`;

      return `<tr style="${isImported ? 'background:#0c1510' : ''}">
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${h.original_name}">${h.original_name}</td>
        <td>${h.pdf_type === 'biodex' ? '💪 Biodex' : h.pdf_type === 'bodpod' ? '⚖️ BOD POD' : '❓'}</td>
        <td>${h.athlete_name || '<span style="color:#7a8299">—</span>'}</td>
        <td>${h.test_date || '—'}</td>
        <td>${statusHtml}</td>
        <td style="color:#7a8299;font-size:.78rem">${h.uploaded_at || ''}</td>
        <td>${actionHtml}</td>
      </tr>`;
    }).join('');

    // Update status summary bar
    const total    = history.length;
    const imported = history.filter(h => h.status === 'imported').length;
    const pending  = history.filter(h => h.status === 'pending').length;
    const errors   = history.filter(h => h.status === 'error').length;
    const summaryEl = document.getElementById('historyStats');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <span style="color:#63b3ed">✅ ${imported} imported</span>
        <span style="color:#fbd38d;margin-left:12px">⏳ ${pending} pending</span>
        ${errors ? `<span style="color:#fc8181;margin-left:12px">❌ ${errors} error${errors!==1?'s':''}</span>` : ''}
        <span style="color:#7a8299;margin-left:12px">/ ${total} total</span>`;
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--danger);padding:12px">Failed to load history: ${err.message}</td></tr>`;
  }
}

// Also init sport filter state
STATE.filters.sport = "Women's Basketball";

document.addEventListener('DOMContentLoaded', init);
