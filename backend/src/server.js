require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');
const { initDB } = require('./db/postgres');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Security middleware ──────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"]
    }
  }
}));
app.use(compression());
app.use(cors({
  origin: process.env.NODE_ENV === 'development' ? true : (process.env.CORS_ORIGIN || '*'),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' }));

// ── Rate limiting ─────────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
}));

// AI endpoints get a tighter limiter since they call Anthropic
app.use('/api/ai/', rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'AI endpoint rate limit reached. Responses are cached — try again in a minute.' },
}));

// ── Routes ────────────────────────────────────────────────────
app.use('/api/athletes', require('./routes/athletes'));
app.use('/api/bodpod',   require('./routes/bodpod'));
app.use('/api/biodex',   require('./routes/biodex'));
app.use('/api/performance', require('./routes/performance'));
app.use('/api/ai',       require('./routes/ai'));
app.use('/api/upload',   require('./routes/upload'));
app.use('/api/health',   require('./routes/health'));

// ── Serve Frontend ────────────────────────────────────────────
const path = require('path');
app.use(express.static(path.join(__dirname, '../../frontend/public')));

// Fallback to index.html for SPA routing (if any)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/public/index.html'));
});

// ── 404 & error handlers ──────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ── Boot ──────────────────────────────────────────────────────
async function start() {
  try {
    await initDB();
    app.listen(PORT, () => {
      logger.info(`WBB Dashboard API running on port ${PORT} [${process.env.NODE_ENV}]`);
    });
  } catch (err) {
    logger.error('Failed to start server', err);
    process.exit(1);
  }
}

start();
module.exports = app;
