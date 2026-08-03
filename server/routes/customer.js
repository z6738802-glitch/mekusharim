import express from 'express';
import { query } from '../db/index.js';
import * as B from '../services/benefits.js';
import * as C from '../services/coupons.js';

const router = express.Router();

// אחסון קודי אימות זמניים (בזיכרון, 10 דקות תוקף)
const verifyCodes = new Map();
// הגבלת קצב לצינתוקים (60 שניות בין צינתוקים, מקסימום 3 בשעה)
const rateLimit = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of verifyCodes) if (now - v.at > 10*60*1000) verifyCodes.delete(k);
  for (const [k, v] of rateLimit) if (now - v.firstAt > 60*60*1000) rateLimit.delete(k);
}, 60*1000);

// ── שליחת קוד אימות בצינתוק ──
router.post('/verify/send', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'missing phone' });

  // 1. בדיקה שהטלפון רשום
  const { rows } = await query(
    `select id, phone from mekusharim.contacts where phone=$1 or phone2=$1 or phone3=$1 limit 1`,
    [phone]
  );
  if (!rows.length) return res.status(401).json({ error: 'not_authorized' });

  // 2. הגבלת קצב
  const now = Date.now();
  const rl = rateLimit.get(phone) || { count: 0, lastAt: 0, firstAt: now };
  if (now - rl.firstAt > 60*60*1000) { rl.count = 0; rl.firstAt = now; } // חלון של שעה
  if (rl.count >= 3) {
    const waitMin = Math.ceil((60*60*1000 - (now - rl.firstAt)) / 60000);
    return res.status(429).json({ error: 'rate_limit_hour', waitMinutes: waitMin });
  }
  if (rl.lastAt && now - rl.lastAt < 60*1000) {
    const waitSec = Math.ceil((60*1000 - (now - rl.lastAt)) / 1000);
    return res.status(429).json({ error: 'rate_limit_seconds', waitSeconds: waitSec });
  }
  rl.count++;
  rl.lastAt = now;
  rateLimit.set(phone, rl);

  // 3. הפעלת צינתוק דרך ימות (ימות מייצרת את הקוד בעצמה)
  try {
    const params = new URLSearchParams({
      token: process.env.YEMOT_TOKEN,
      callerId: 'RAND',
      TzintukTimeOut: '9',
      phones: JSON.stringify([phone]),
    });
    const url = `https://www.call2all.co.il/ym/api/RunTzintuk?${params}`;
    const r = await fetch(url);
    const data = await r.json();
    console.log('Tzintuk response:', data);
    if (data.responseStatus !== 'OK') {
      return res.status(500).json({ error: 'tzintuk_failed', details: data });
    }
    // שומרים את הקוד שימות ייצרה (לא את שלנו)
    verifyCodes.set(phone, { code: String(data.verifyCode), at: Date.now() });
    res.json({ ok: true, message: 'צינתוק נשלח' });
  } catch (err) {
    console.error('Tzintuk error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── אימות הקוד ──
router.post('/verify/check', async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) return res.status(400).json({ error: 'missing fields' });

  const stored = verifyCodes.get(phone);
  if (!stored) return res.status(401).json({ error: 'no_code' });
  if (stored.code !== String(code).trim()) return res.status(401).json({ error: 'wrong_code' });

  verifyCodes.delete(phone);

  // מחזיר את פרטי הלקוח + טוקן פשוט
  const { rows } = await query(
    `select id, name, phone, synagogue from mekusharim.contacts where phone=$1 or phone2=$1 or phone3=$1 limit 1`,
    [phone]
  );
  if (!rows.length) return res.status(401).json({ error: 'not_authorized' });

  res.json({ ok: true, user: rows[0] });
});

// ── כניסה: בדיקת טלפון ──
router.post('/login', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'missing phone' });

  const { rows } = await query(
    `select id, name, phone, synagogue from mekusharim.contacts 
      where phone = $1 or phone2 = $1 or phone3 = $1 limit 1`,
    [phone]
  );
  if (!rows.length) return res.status(401).json({ error: 'not_authorized' });
  res.json(rows[0]);
});

// ── הטבות פעילות ──
router.get('/benefits', async (req, res) => {
  const benefits = await B.getActiveBenefits();
  res.json(benefits);
});

// ── סטטוס לקוח: מה הזמין ──
router.get('/my/:phone', async (req, res) => {
  const { phone } = req.params;

  const { rows: selections } = await query(
    `select s.id, s.created_at, b.id as benefit_id, b.name, b.type
       from mekusharim.selections s
       join mekusharim.benefits b on b.id = s.benefit_id
      where s.phone = $1 order by s.created_at desc`,
    [phone]
  );

  const { rows: coupons } = await query(
    `select c.code, c.assigned_at, b.name as benefit_name
       from mekusharim.coupons c
       join mekusharim.benefits b on b.id = c.benefit_id
      where c.phone = $1 order by c.assigned_at desc`,
    [phone]
  );

  res.json({ selections, coupons });
});

// ── הזמנה ──
router.get('/order', async (req, res) => {
  console.log('ORDER query:', JSON.stringify(req.query));
  const { phone, benefit_id: bid, qty, id_numbers } = req.query;
  const benefit_id = parseInt(bid, 10);

  if (!phone || !benefit_id || !qty) {
    return res.status(400).json({ error: 'missing fields' });
  }

  // בדיקת הרשאה
  const auth = await query(
    `select 1 from mekusharim.contacts where phone = $1`, [phone]
  );
  if (!auth.rows.length) return res.status(401).json({ error: 'not_authorized' });

  const benefit = await B.getBenefit(benefit_id);
  if (!benefit) return res.status(404).json({ error: 'benefit not found' });

  // בדיקה: כבר הזמין את אותה הטבה?
  const already = await B.familyCount(benefit_id, phone);
  if (already > 0) return res.status(400).json({ error: 'already_ordered', benefit_name: benefit.name });

  // בדיקה: כבר יש הטבה אחרת (שאינה ניתנת לצבירה)?
  if (!benefit.stackable) {
    const existing = await B.customerSelections(phone);
    const other = existing.filter(s => s.benefit_id !== benefit.id && !s.stackable);
    if (other.length > 0) return res.status(400).json({ error: 'has_other', benefit_name: other[0].name });
  }

  // בדיקת כמות
  if (qty < 1 || qty > benefit.per_family) {
    return res.status(400).json({ error: 'invalid_qty', max: benefit.per_family });
  }

  // בדיקת מלאי
  if (benefit.total_stock > 0) {
    const taken = await B.totalTaken(benefit_id);
    if (taken + qty > benefit.total_stock) {
      return res.status(400).json({ error: 'out_of_stock' });
    }
  }

  // ביצוע
  const recordingPath = id_numbers ? `text:${id_numbers}` : null;

  if (benefit.type === 'coupon') {
    const codes = [];
    for (let i = 0; i < qty; i++) {
      await B.addSelection(benefit_id, phone, recordingPath);
      const code = await C.assignCoupon(benefit_id, phone);
      if (code === null) {
        await C.releaseCoupons(benefit_id, phone);
        await B.removeAllSelections(benefit_id, phone);
        return res.status(400).json({ error: 'out_of_stock' });
      }
      codes.push(code);
    }
    return res.json({ ok: true, type: 'coupon', codes });
  } else {
    for (let i = 0; i < qty; i++) {
      await B.addSelection(benefit_id, phone, recordingPath);
    }
    return res.json({ ok: true, type: 'registration', qty });
  }
});

// ── ביטול הזמנה ──
router.get('/cancel/:phone/:benefit_id', async (req, res) => {
  const { phone, benefit_id } = req.params;
  await C.releaseCoupons(benefit_id, phone);
  await B.removeAllSelections(benefit_id, phone);
  res.json({ ok: true });
});

export default router;
