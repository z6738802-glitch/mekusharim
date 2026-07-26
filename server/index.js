import express from 'express';
import 'dotenv/config';
import ivrRouter from './routes/ivr.js';
import adminRouter from './routes/admin.js';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// בריאות
app.get('/health', (req, res) => res.json({ ok: true, service: 'mekusharim' }));

// שלוחת ה-IVR (ימות פונה לכאן)
app.use('/', ivrRouter);

// ניהול
app.use('/admin', adminRouter);

// ממשק ניהול סטטי
app.use('/panel', express.static('admin'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`מקושרים — שרת פועל על פורט ${PORT}`);
});
