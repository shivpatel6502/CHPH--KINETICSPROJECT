# CHPH Performance Analytics — WBB Dashboard

Multi-sport athlete performance dashboard for the University of Windsor. Tracks body composition (BOD POD), strength asymmetry (Biodex), and surfaces AI-powered insights via Claude.

**Live demo (GitHub Pages):** https://shivpatel6502.github.io/wbb-dashboard

---

## Features

- **Overview** — scorecards, BF% chart, risk distribution pie, anomaly detection
- **BOD POD** — body composition trends, FFM, weight per athlete/phase
- **Biodex** — quad/ham peak torque, L:R asymmetry, H:Q ratios at 60°/120°/180°
- **AI Forecast** — statistical projection (local) + Claude AI trajectory forecasting
- **Watchlist** — AI risk scores (0–100) ranked by priority
- **Athlete Profile** — per-athlete drill-down with full history and AI coaching summary
- **Compare** — head-to-head stats table, phase-by-phase chart, radar profile, AI analysis
- **Upload PDF** — drag-and-drop Biodex/BOD POD PDFs → Python extractor → merge to DB

---

## Project Structure

```
wbb-dashboard/
├── frontend/public/       # Static HTML/CSS/JS (deployed to GitHub Pages)
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── backend/               # Node.js + Express API (deploy to Render)
│   ├── src/
│   │   ├── server.js
│   │   ├── routes/        # athletes, bodpod, biodex, ai, upload, health
│   │   ├── services/      # aiService.js (Claude), secretsService.js
│   │   └── db/postgres.js
│   └── scripts/           # migrate.js, seed.js, extract_pdf.py
├── .github/workflows/     # CI/CD: GitHub Pages + Render deploy
└── render.yaml            # Render service definition
```

---

## Quick Start (Local)

### Prerequisites
- Node.js ≥ 20, Python 3, PostgreSQL

```bash
# 1. Clone
git clone https://github.com/shivpatel6502/wbb-dashboard.git
cd wbb-dashboard

# 2. Backend
cd backend
cp .env.example .env          # fill in DB creds + ANTHROPIC_API_KEY
npm install
npm run migrate               # creates tables
npm run seed                  # loads demo data
npm start                     # API on http://localhost:3001

# 3. Frontend
# Open frontend/public/index.html in a browser
# Or serve with: npx serve frontend/public
```

The frontend auto-detects `localhost` and connects to `http://localhost:3001/api`.  
If the backend is unavailable it falls back to **demo mode** with embedded data.

---

## Free Hosting (No Credit Card)

### Frontend → GitHub Pages

1. Push this repo to GitHub (see below)
2. Go to **Settings → Pages → Source: GitHub Actions**
3. Every push to `main` auto-deploys via `.github/workflows/deploy-pages.yml`
4. Live at `https://shivpatel6502.github.io/wbb-dashboard`

### Backend → Render (free tier)

1. Sign up at [render.com](https://render.com) (free)
2. New Web Service → connect your GitHub repo → Root directory: `backend`
3. Set environment variables in Render dashboard (DB creds, ANTHROPIC_API_KEY, CORS_ORIGIN)
4. Copy the **Deploy Hook URL** and add it as `RENDER_DEPLOY_HOOK_URL` in GitHub repo secrets
5. Auto-deploys on every push to `main`

### Database → Neon (free PostgreSQL)

1. Sign up at [neon.tech](https://neon.tech) (free tier, no expiry)
2. Create project → copy connection string
3. Set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` in Render env vars
4. Run migrations: `npm run migrate` locally with the Neon connection string

---

## Pushing to GitHub

```bash
cd /path/to/wbb-dashboard
git init
git remote add origin https://github.com/shivpatel6502/wbb-dashboard.git
git add .
git commit -m "Initial commit — CHPH Performance Analytics Dashboard"
git branch -M main
git push -u origin main
```

---

## Environment Variables (Backend)

| Variable | Description |
|---|---|
| `DB_HOST` | PostgreSQL host (e.g. Neon hostname) |
| `DB_PORT` | PostgreSQL port (default: 5432) |
| `DB_NAME` | Database name |
| `DB_USER` | Database user |
| `DB_PASSWORD` | Database password |
| `ANTHROPIC_API_KEY` | Claude API key for AI features |
| `AI_CACHE_TTL` | AI response cache TTL in seconds (default: 43200) |
| `CORS_ORIGIN` | Allowed frontend origin (e.g. `https://shivpatel6502.github.io`) |
| `PORT` | Server port (default: 3001) |
