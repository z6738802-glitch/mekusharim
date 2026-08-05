import express from 'express';
import 'dotenv/config';
import ivrRouter from './routes/ivr.js';
import adminRouter from './routes/admin.js';
import customerRouter from './routes/customer.js';
import filesRouter from './routes/files.js';
import { ivrLogger } from './services/logger.js';
import { initDb } from './db/init.js';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// debug log
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// בריאות
app.get('/health', (req, res) => res.json({ ok: true, service: 'mekusharim' }));

// שלוחת ה-IVR (ימות פונה לכאן) — עם לוגר
app.use('/ivr', ivrLogger, ivrRouter);

// ניהול
app.use('/admin', adminRouter);

// לקוחות (ציבורי)
app.use('/api', customerRouter);

// debug
app.post('/api/test', (req, res) => res.json({ ok: true }));

// ממשק ניהול סטטי
app.use('/panel', express.static('admin'));

// פורטל לקוחות
app.use('/my', express.static('customer'));

// דף נחיתה
app.use('/', express.static('landing'));

// אחסון קבצים ציבוריים
app.use('/uploads', express.static('uploads'));

// API של ניהול קבצים
app.use('/files-api', filesRouter);

// פאנל ניהול קבצים
app.use('/files', express.static('files-panel'));

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`מקושרים — שרת פועל על פורט ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('כשל באתחול ה-DB, השרת לא עלה:', err.message);
    process.exit(1);
  });
