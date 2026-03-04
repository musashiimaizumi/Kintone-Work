const express = require('express');
const helmet = require('helmet');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');

dotenv.config();

const ZERO_RETENTION = process.env.ZERO_RETENTION === 'true';
const MEMORY_ONLY_PIPELINE = process.env.MEMORY_ONLY_PIPELINE === 'true';
const RETRY_BUFFER = process.env.RETRY_BUFFER === 'true';

const app = express();
app.use(helmet());
app.use(express.json({ limit: '1mb' }));

// JSONロガー（PIIレダクション）
const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
app.use((req, res, next) => {
  logger.info({ method: req.method, path: req.path, ip: req.ip, ua: req.headers['user-agent'] || '' }, 'request');
  next();
});

const limiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
app.use(limiter);

const admin = require('./routes/admin');
const adminAuthRoutes = require('./routes/adminAuth');
const setup = require('./routes/setup');
const { requireAdminAuth } = require('./services/adminAuth');
const publicDir = require('path').join(__dirname, 'public');
app.use('/admin/ui', express.static(publicDir, { index: 'admin.html' }));
const form = require('./routes/form');
const record = require('./routes/record');
const viewer = require('./routes/viewer');

app.use('/setup', setup);
app.use('/admin/auth', adminAuthRoutes);
app.use('/admin', requireAdminAuth, admin);
app.use('/:tenant/:app/form', form);
app.use('/:tenant/:app/record', record);
app.use('/:tenant/:app/viewer', viewer);

app.get('/health', (req, res) => {
  res.json({ ok: true, ZERO_RETENTION, MEMORY_ONLY_PIPELINE, RETRY_BUFFER });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  logger.info({ port }, 'server started');
});
