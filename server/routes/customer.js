import express from 'express';
import { query } from '../db/index.js';
import * as B from '../services/benefits.js';
import * as C from '../services/coupons.js';

const router = express.Router();

// ── כניסה: בדיקת טלפון ──
router.post('/login', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'missing phone' });

  const { rows } = await query(
    `select id, name, phone, synagogue from mekusharim.contacts where phone = $1`,
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
router.post('/order', async (req, res) => {
  console.log('ORDER body:', JSON.stringify(req.body));
  const { phone, benefit_id: bid, qty, id_numbers } = req.body;
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
  if (!benefit || !benefit.active) return res.status(404).json({ error: 'benefit not found' });

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
router.delete('/order/:phone/:benefit_id', async (req, res) => {
  const { phone, benefit_id } = req.params;
  await C.releaseCoupons(benefit_id, phone);
  await B.removeAllSelections(benefit_id, phone);
  res.json({ ok: true });
});

export default router;
