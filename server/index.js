import express from 'express';
import 'dotenv/config';
import ivrRouter from './routes/ivr.js';
import adminRouter from './routes/admin.js';
import customerRouter from './routes/customer.js';
import { initDb } from './db/init.js';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// בריאות
app.get('/health', (req, res) => res.json({ ok: true, service: 'mekusharim' }));

// שלוחת ה-IVR (ימות פונה לכאן)
app.use('/', ivrRouter);

// ניהול
app.use('/admin', adminRouter);

// לקוחות (ציבורי)
app.use('/api', customerRouter);

// ממשק ניהול סטטי
app.use('/panel', express.static('admin'));

// פורטל לקוחות
app.use('/my', express.static('customer'));

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
