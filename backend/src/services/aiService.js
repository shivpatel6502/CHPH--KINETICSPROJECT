/**
 * AI Service — all Anthropic API calls are proxied here, never client-side.
 * Responses are cached in PostgreSQL (ai_insights_cache table).
 * Falls back gracefully if the API is unavailable.
 */
const Anthropic = require('@anthropic-ai/sdk');
const crypto    = require('crypto');
const { query } = require('../db/postgres');
const secrets   = require('./secretsService');
const logger    = require('../utils/logger');

const CACHE_TTL_SECONDS = parseInt(process.env.AI_CACHE_TTL || '43200'); // 12h
let _client = null;

async function getClient() {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY || await secrets.getApiKey();
  _client = new Anthropic({ apiKey: key });
  return _client;
}

function hashPayload(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

async function getCached(cacheKey) {
  const res = await query(
    `SELECT payload FROM ai_insights_cache
     WHERE cache_key = $1 AND expires_at > NOW()`,
    [cacheKey]
  );
  return res.rows[0]?.payload || null;
}

async function setCache(cacheKey, insightType, athleteId, payload, modelUsed, promptHash) {
  await query(
    `INSERT INTO ai_insights_cache(cache_key,insight_type,athlete_id,payload,model_used,prompt_hash,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,NOW() + INTERVAL '${CACHE_TTL_SECONDS} seconds')
     ON CONFLICT(cache_key) DO UPDATE
       SET payload=EXCLUDED.payload, expires_at=EXCLUDED.expires_at, created_at=NOW()`,
    [cacheKey, insightType, athleteId || null, JSON.stringify(payload), modelUsed, promptHash]
  );
}

// ── Anomaly Detection ─────────────────────────────────────────────────────────
async function detectAnomalies(athleteData) {
  const cacheKey = `anomaly:${hashPayload(athleteData)}`;
  const cached = await getCached(cacheKey);
  if (cached) { logger.info('Anomaly cache hit'); return cached; }

  const systemPrompt = `You are a sports science analyst for a university basketball program.
Analyze the provided athlete testing data and return ONLY valid JSON matching this exact schema — no markdown, no explanation:
{
  "anomalies": [
    {
      "athlete_id": number,
      "athlete_name": string,
      "metric": string,
      "current_value": number,
      "baseline_value": number,
      "deviation_pct": number,
      "flag_level": "concern" | "monitoring" | "normal",
      "description": string
    }
  ]
}
Rules:
- flag_level "concern" = deviation > 2 standard deviations from athlete's own historical mean OR > 15% single-phase change
- flag_level "monitoring" = 1–2 SD or 5–15% change
- Only include metrics with meaningful data (>=2 data points)
- Body fat % concern threshold: absolute >25% or >5% increase in one phase
- Asymmetry concern: any L:R ratio <0.80, monitoring: 0.80–0.90`;

  const userMessage = `Athlete testing data:\n${JSON.stringify(athleteData, null, 2)}\n\nReturn anomaly detection results as specified JSON.`;

  try {
    const client = await getClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    const text = response.content[0].text.trim();
    const result = JSON.parse(text);
    await setCache(cacheKey, 'anomaly', null, result, response.model, hashPayload(userMessage));
    return result;
  } catch (err) {
    logger.error('Anomaly detection failed', { message: err.message });
    return { anomalies: [], error: 'AI service unavailable', fallback: true };
  }
}

// ── Trend Forecasting ─────────────────────────────────────────────────────────
async function forecastTrends(athleteData) {
  const cacheKey = `forecast:${hashPayload(athleteData)}`;
  const cached = await getCached(cacheKey);
  if (cached) { logger.info('Forecast cache hit'); return cached; }

  const systemPrompt = `You are a sports scientist projecting athlete performance trajectories.
Return ONLY valid JSON matching this exact schema — no markdown:
{
  "forecasts": [
    {
      "athlete_id": number,
      "athlete_name": string,
      "metric": string,
      "projected_points": [
        { "label": string, "value": number, "is_forecast": true, "confidence": "high"|"medium"|"low" }
      ],
      "trend_direction": "improving" | "declining" | "stable",
      "confidence_note": string
    }
  ]
}
Project 1–2 future phases based on observed trajectory. Use linear or polynomial regression logic.
Only project if >= 3 data points exist. Include confidence_note explaining the projection.`;

  const userMessage = `Historical athlete data:\n${JSON.stringify(athleteData, null, 2)}\n\nReturn forecast results as specified JSON.`;

  try {
    const client = await getClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    const result = JSON.parse(response.content[0].text.trim());
    await setCache(cacheKey, 'forecast', null, result, response.model, hashPayload(userMessage));
    return result;
  } catch (err) {
    logger.error('Forecast failed', { message: err.message });
    return { forecasts: [], error: 'AI service unavailable', fallback: true };
  }
}

// ── Risk Scoring ──────────────────────────────────────────────────────────────
async function scoreRisks(teamData) {
  const cacheKey = `risk:${hashPayload(teamData)}`;
  const cached = await getCached(cacheKey);
  if (cached) { logger.info('Risk score cache hit'); return cached; }

  const systemPrompt = `You are a sports medicine analyst generating athlete monitoring priority scores.
Return ONLY valid JSON matching this exact schema — no markdown:
{
  "risk_scores": [
    {
      "athlete_id": number,
      "athlete_name": string,
      "risk_score": number,
      "risk_tier": "critical" | "high" | "moderate" | "low",
      "primary_concerns": [string],
      "reasoning": string
    }
  ]
}
Scoring rubric (0–100):
- Body fat >30%: +25 pts | 25–30%: +15 pts | >5% single-phase increase: +10 pts
- Any Biodex L:R ratio <0.80: +20 pts | 0.80–0.90: +10 pts
- H:Q ratio <0.40: +15 pts | 0.40–0.50: +8 pts
- Multiple concurrent flags: +10 pts compounding
- risk_tier: 75–100=critical, 50–74=high, 25–49=moderate, 0–24=low
Sort by risk_score descending.`;

  const userMessage = `Team data:\n${JSON.stringify(teamData, null, 2)}\n\nReturn risk scores as specified JSON.`;

  try {
    const client = await getClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    const result = JSON.parse(response.content[0].text.trim());
    await setCache(cacheKey, 'risk', null, result, response.model, hashPayload(userMessage));
    return result;
  } catch (err) {
    logger.error('Risk scoring failed', { message: err.message });
    return { risk_scores: [], error: 'AI service unavailable', fallback: true };
  }
}

// ── Athlete Summary ───────────────────────────────────────────────────────────
async function getAthleteSummary(athleteId, athleteData) {
  const cacheKey = `summary:${athleteId}:${hashPayload(athleteData)}`;
  const cached = await getCached(cacheKey);
  if (cached) { logger.info(`Summary cache hit for athlete ${athleteId}`); return cached; }

  const systemPrompt = `You are a strength and conditioning coach writing brief performance summaries.
Return ONLY valid JSON — no markdown:
{
  "athlete_id": number,
  "athlete_name": string,
  "summary": string,
  "key_positive": string,
  "key_concern": string,
  "recommendation": string
}
Rules:
- summary: 1–2 sentences, coach-readable, specific to the data
- key_positive: the athlete's strongest recent metric or improvement
- key_concern: the metric most needing attention (or "None identified" if clear)
- recommendation: one concrete, actionable next step`;

  const userMessage = `Athlete data:\n${JSON.stringify(athleteData, null, 2)}\n\nGenerate coaching summary.`;

  try {
    const client = await getClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    const result = JSON.parse(response.content[0].text.trim());
    await setCache(cacheKey, 'summary', athleteId, result, response.model, hashPayload(userMessage));
    return result;
  } catch (err) {
    logger.error(`Athlete summary failed for ${athleteId}`, { message: err.message });
    
    // Dynamically generate a heuristic summary based on the athlete's actual data
    let summary = "Athlete is maintaining baseline performance.";
    let key_positive = "Consistent Tracking";
    let key_concern = "None identified";
    let recommendation = "Continue current programming.";

    if (athleteData.biodex && athleteData.biodex.length > 0) {
      const latestBdx = athleteData.biodex[0];
      if (latestBdx.ham_lr_60 < 0.8) {
        key_concern = "Severe Hamstring Asymmetry";
        summary = "Significant left/right deficit detected in hamstring torque, increasing injury risk.";
        recommendation = "Prioritize unilateral eccentric hamstring work on the weaker side.";
      } else if (latestBdx.rhq_60 < 0.4 || latestBdx.lhq_60 < 0.4) {
        key_concern = "Low H:Q Ratio";
        summary = "Hamstring strength is disproportionately low compared to quadriceps output.";
        recommendation = "Add Romanian deadlifts and Nordic hamstring curls to balance anterior/posterior chain.";
      } else {
        key_positive = "Balanced Output";
        summary = "Left/right symmetry and H:Q ratios are within optimal ranges.";
        recommendation = "Focus on progressive overload to increase absolute peak torque.";
      }
    } else if (athleteData.BIOPOD && athleteData.BIOPOD.length > 0) {
      const latestBp = athleteData.BIOPOD[0];
      if (latestBp.body_fat_pct > 0.25) {
        key_concern = "Elevated Body Fat";
        summary = "Body composition trend indicates a gradual increase in fat mass relative to lean tissue.";
        recommendation = "Consult team nutritionist regarding caloric intake and macronutrient distribution.";
      }
    }

    return {
      athlete_id: athleteId,
      athlete_name: athleteData.name || 'Unknown',
      summary: summary,
      key_positive: key_positive, 
      key_concern: key_concern, 
      recommendation: recommendation,
      fallback: true,
    };
  }
}

// ── Team Overview Insights ────────────────────────────────────────────────────
async function getTeamInsights(teamData) {
  const cacheKey = `team:${hashPayload(teamData)}`;
  const cached = await getCached(cacheKey);
  if (cached) { logger.info('Team insights cache hit'); return cached; }

  const systemPrompt = `You are a head strength and conditioning coach for a university women's basketball team.
Return ONLY valid JSON — no markdown:
{
  "team_summary": string,
  "top_priority_athletes": [string],
  "team_strengths": [string],
  "team_concerns": [string],
  "recommendations": [string]
}
- team_summary: 2–3 sentences on overall team readiness
- top_priority_athletes: up to 3 names needing immediate attention
- recommendations: 3–5 actionable team-level interventions`;

  const userMessage = `Full team data:\n${JSON.stringify(teamData, null, 2)}\n\nProvide team insights.`;

  try {
    const client = await getClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    const result = JSON.parse(response.content[0].text.trim());
    await setCache(cacheKey, 'team', null, result, response.model, hashPayload(userMessage));
    return result;
  } catch (err) {
    logger.error('Team insights failed', { message: err.message });
    return {
      team_summary: 'aa',
      top_priority_athletes: [], team_strengths: [], team_concerns: [], recommendations: [],
      fallback: true,
    };
  }
}

module.exports = { detectAnomalies, forecastTrends, scoreRisks, getAthleteSummary, getTeamInsights };
