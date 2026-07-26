import express from 'express';
import multer from 'multer';
import { query } from '../db/index.js';
import { uploadRecording } from '../services/yemot.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ── הגנה בסיסית: מפתח admin ב-header ──
router.use((req, res, next) => {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

// ════════════ לקוחות ════════════
router.get('/contacts', async (req, res) => {
  const { rows } = await query(`select * from contacts order by name, phone`);
  res.json(rows);
});

router.post('/contacts', async (req, res) => {
  const { phone, name, synagogue } = req.body;
  const { rows } = await query(
    `insert into contacts (phone, name, synagogue) values ($1,$2,$3)
     on conflict (phone) do update set name=$2, synagogue=$3
     returning *`,
    [phone, name || null, synagogue || null]
  );
  res.json(rows[0]);
});

// העלאה מרובה (רשימת לקוחות)
router.post('/contacts/bulk', async (req, res) => {
  const list = req.body.contacts || [];
  let inserted = 0;
  for (const c of list) {
    if (!c.phone) continue;
    await query(
      `insert into contacts (phone, name, synagogue) values ($1,$2,$3)
       on conflict (phone) do update set name=$2, synagogue=$3`,
      [c.phone, c.name || null, c.synagogue || null]
    );
    inserted++;
  }
  res.json({ inserted });
});

router.delete('/contacts/:id', async (req, res) => {
  await query(`delete from contacts where id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// ════════════ הטבות ════════════
router.get('/benefits', async (req, res) => {
  const { rows } = await query(
    `select b.*,
       (select count(*) from selections s where s.benefit_id=b.id)::int as taken,
       (select count(*) from coupons c where c.benefit_id=b.id and c.phone is null)::int as coupons_free
     from benefits b order by sort_order, id`
  );
  res.json(rows);
});

router.post('/benefits', async (req, res) => {
  const { name, type, total_stock, per_family, stackable, active, sort_order } = req.body;
  const { rows } = await query(
    `insert into benefits (name, type, total_stock, per_family, stackable, active, sort_order)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [name, type, total_stock || 0, per_family || 1, stackable || false, active ?? true, sort_order || 0]
  );
  res.json(rows[0]);
});

router.put('/benefits/:id', async (req, res) => {
  const { name, type, total_stock, per_family, stackable, active, sort_order } = req.body;
  const { rows } = await query(
    `update benefits set name=$1, type=$2, total_stock=$3, per_family=$4,
       stackable=$5, active=$6, sort_order=$7 where id=$8 returning *`,
    [name, type, total_stock, per_family, stackable, active, sort_order, req.params.id]
  );
  res.json(rows[0]);
});

router.delete('/benefits/:id', async (req, res) => {
  await query(`delete from benefits where id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// העלאת הקלטת שם ההטבה לימות + שמירת הנתיב
router.post('/benefits/:id/recording', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  try {
    const fileName = `${req.params.id}.wav`;
    const result = await uploadRecording(req.file.buffer, fileName);
    const recPath = `Benefits/${req.params.id}`;
    await query(`update benefits set recording=$1 where id=$2`, [recPath, req.params.id]);
    res.json({ ok: true, path: recPath, yemot: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════ קופונים ════════════
router.get('/benefits/:id/coupons', async (req, res) => {
  const { rows } = await query(
    `select * from coupons where benefit_id=$1 order by id`,
    [req.params.id]
  );
  res.json(rows);
});

// הוספת קופונים בכמות (רשימת קודים)
router.post('/benefits/:id/coupons', async (req, res) => {
  const codes = req.body.codes || [];
  let added = 0;
  for (const code of codes) {
    if (!String(code).trim()) continue;
    await query(
      `insert into coupons (code, benefit_id) values ($1,$2)`,
      [String(code).trim(), req.params.id]
    );
    added++;
  }
  res.json({ added });
});

router.delete('/coupons/:id', async (req, res) => {
  await query(`delete from coupons where id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// ════════════ דוחות ════════════
router.get('/report', async (req, res) => {
  const { rows } = await query(
    `select b.name, b.type, b.total_stock,
       count(s.id)::int as selections
     from benefits b
     left join selections s on s.benefit_id=b.id
     group by b.id order by b.sort_order`
  );
  res.json(rows);
});

export default router;
