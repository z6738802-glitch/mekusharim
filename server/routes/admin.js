import express from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
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
  const { phone, phone2, phone3, name, synagogue } = req.body;
  const { rows } = await query(
    `insert into contacts (phone, phone2, phone3, name, synagogue) values ($1,$2,$3,$4,$5)
     on conflict (phone) do update set phone2=$2, phone3=$3, name=$4, synagogue=$5
     returning *`,
    [phone, phone2 || null, phone3 || null, name || null, synagogue || null]
  );
  res.json(rows[0]);
});

router.put('/contacts/:id', async (req, res) => {
  const { phone, phone2, phone3, name, synagogue } = req.body;
  const { rows } = await query(
    `update contacts set phone=$1, phone2=$2, phone3=$3, name=$4, synagogue=$5 where id=$6 returning *`,
    [phone, phone2 || null, phone3 || null, name || null, synagogue || null, req.params.id]
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

// הורדת תבנית אקסל לדוגמה
router.get('/contacts/template', (req, res) => {
  const rows = [
    { 'טלפון': '0501234567', 'טלפון נוסף': '', 'טלפון נוסף 2': '', 'שם': 'ישראל ישראלי', 'בית כנסת': 'בית כנסת מרכזי' },
    { 'טלפון': '0527654321', 'טלפון נוסף': '0507654321', 'טלפון נוסף 2': '', 'שם': 'משה כהן', 'בית כנסת': 'חסידי גור' },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'לקוחות');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename=contacts_template.xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ייבוא מקובץ אקסל/CSV
router.post('/contacts/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    let inserted = 0;
    let skipped = 0;

    // ניקוי תווים נסתרים ורווחים
    const clean = (v) => v == null ? null :
      String(v).replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, '').trim();

    for (const r of rows) {
      const phone = clean(r['טלפון'] || r.phone || r.Phone || '');
      const phone2 = clean(r['טלפון נוסף'] || r.phone2 || '');
      const phone3 = clean(r['טלפון נוסף 2'] || r.phone3 || '');
      const name = clean(r['שם'] || r.name || r.Name || '');
      const synagogue = clean(r['בית כנסת'] || r.synagogue || r.Synagogue || '');

      // דילוג על שורות בלי טלפון תקין (או '0')
      if (!phone || phone === '0' || phone.length < 7) {
        skipped++;
        continue;
      }

      await query(
        `insert into contacts (phone, phone2, phone3, name, synagogue) values ($1,$2,$3,$4,$5)
         on conflict (phone) do update set 
           phone2 = coalesce(nullif(EXCLUDED.phone2, ''), contacts.phone2),
           phone3 = coalesce(nullif(EXCLUDED.phone3, ''), contacts.phone3),
           name = coalesce(nullif(EXCLUDED.name, ''), contacts.name),
           synagogue = coalesce(nullif(EXCLUDED.synagogue, ''), contacts.synagogue)`,
        [phone, phone2 || null, phone3 || null, name || null, synagogue || null]
      );
      inserted++;
    }
    res.json({ inserted, skipped, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  const { name, type, total_stock, per_family, stackable, active, sort_order, group_id } = req.body;
  const { rows } = await query(
    `insert into benefits (name, type, total_stock, per_family, stackable, active, sort_order, group_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [name, type, total_stock || 0, per_family || 1, stackable || false, active ?? true, sort_order || 0, group_id || null]
  );
  res.json(rows[0]);
});

router.put('/benefits/:id', async (req, res) => {
  const { name, type, total_stock, per_family, stackable, active, sort_order, group_id } = req.body;
  const { rows } = await query(
    `update benefits set name=$1, type=$2, total_stock=$3, per_family=$4,
       stackable=$5, active=$6, sort_order=$7, group_id=$8 where id=$9 returning *`,
    [name, type, total_stock, per_family, stackable, active, sort_order, group_id || null, req.params.id]
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

// הורדת הקלטת ת"ז מימות (proxy)
router.get('/recording', async (req, res) => {
  const path = req.query.path;
  if (!path) return res.status(400).json({ error: 'missing path' });
  try {
    const url = `https://www.call2all.co.il/ym/api/DownloadFile?token=${encodeURIComponent(process.env.YEMOT_TOKEN)}&path=${encodeURIComponent(path)}`;
    const r = await fetch(url);
    if (!r.ok) return res.status(404).json({ error: 'not found' });
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `inline; filename="recording.wav"`);
    const buf = await r.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════ כרטסת לקוח ════════════
// כל המידע על לקוח בודד: פרטים + הזמנות + קופונים
router.get('/contacts/:id/card', async (req, res) => {
  const { rows: contactRows } = await query(`select * from contacts where id=$1`, [req.params.id]);
  if (!contactRows.length) return res.status(404).json({ error: 'not found' });
  const contact = contactRows[0];

  // כל ההזמנות של הלקוח (לפי טלפון)
  const { rows: selections } = await query(
    `select s.id, s.created_at, s.recording_path, b.id as benefit_id, b.name as benefit_name, b.type
       from selections s join benefits b on b.id = s.benefit_id
      where s.phone = $1 order by s.created_at desc`,
    [contact.phone]
  );

  // קופונים שהוקצו ללקוח
  const { rows: coupons } = await query(
    `select c.code, c.assigned_at, b.name as benefit_name
       from coupons c join benefits b on b.id = c.benefit_id
      where c.phone = $1 order by c.assigned_at desc`,
    [contact.phone]
  );

  res.json({ contact, selections, coupons });
});

// הוספת הזמנה ידנית ללקוח
router.post('/contacts/:id/selection', async (req, res) => {
  const { rows } = await query(`select phone from contacts where id=$1`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  const phone = rows[0].phone;
  const { benefit_id } = req.body;
  await query(`insert into selections (benefit_id, phone) values ($1,$2)`, [benefit_id, phone]);
  res.json({ ok: true });
});

// ביטול הזמנה ידנית (משחרר גם קופון אם יש)
router.delete('/selections/:id', async (req, res) => {
  // מוצא את ההזמנה כדי לשחרר קופון תואם
  const { rows } = await query(
    `select s.phone, s.benefit_id from selections s where s.id=$1`, [req.params.id]
  );
  if (rows.length) {
    const { phone, benefit_id } = rows[0];
    await query(
      `update coupons set phone=null, assigned_at=null where benefit_id=$1 and phone=$2`,
      [benefit_id, phone]
    );
  }
  await query(`delete from selections where id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// ════════════ דוח מפורט של הטבה ════════════
// מי הזמין הטבה מסוימת, עם פרטי הלקוח (לפילטר בית כנסת)
router.get('/benefits/:id/registrations', async (req, res) => {
  const { rows } = await query(
    `select s.id as selection_id, s.created_at, c.id as contact_id,
            c.phone, c.name, c.synagogue,
            (select code from coupons cp where cp.benefit_id=s.benefit_id and cp.phone=s.phone limit 1) as coupon
       from selections s
       left join contacts c on c.phone = s.phone
      where s.benefit_id = $1
      order by s.created_at desc`,
    [req.params.id]
  );
  res.json(rows);
});


// ════════════ דשבורד ════════════
router.get('/dashboard', async (req, res) => {
  const [
    contactsCount,
    benefitsStats,
    todayOrders,
    topSynagogues,
    recentOrders
  ] = await Promise.all([
    query(`select count(*)::int as n from contacts`),
    query(`select b.id, b.name, b.type, b.total_stock, b.per_family, b.active,
             count(s.id)::int as taken,
             (select count(*)::int from coupons c where c.benefit_id=b.id) as total_coupons,
             (select count(*)::int from coupons c where c.benefit_id=b.id and c.phone is null) as free_coupons
           from benefits b left join selections s on s.benefit_id=b.id
           group by b.id order by b.sort_order, b.id`),
    query(`select count(*)::int as n from selections where created_at >= current_date`),
    query(`select coalesce(c.synagogue, 'ללא בית כנסת') as synagogue, count(distinct s.phone)::int as n
             from selections s left join contacts c on c.phone=s.phone
             group by c.synagogue order by n desc limit 8`),
    query(`select s.id, s.created_at, s.phone, b.name as benefit_name, b.type,
             c.name as contact_name, c.synagogue
             from selections s
             join benefits b on b.id=s.benefit_id
             left join contacts c on c.phone=s.phone
             order by s.created_at desc limit 10`)
  ]);

  const totalOrders = benefitsStats.rows.reduce((s, b) => s + b.taken, 0);
  const activeBenefits = benefitsStats.rows.filter(b => b.active).length;
  const totalCoupons = benefitsStats.rows.reduce((s, b) => s + b.total_coupons, 0);
  const freeCoupons = benefitsStats.rows.reduce((s, b) => s + b.free_coupons, 0);

  res.json({
    contactsCount: contactsCount.rows[0].n,
    totalOrders,
    todayOrders: todayOrders.rows[0].n,
    activeBenefits,
    totalCoupons,
    freeCoupons,
    benefits: benefitsStats.rows,
    topSynagogues: topSynagogues.rows,
    recentOrders: recentOrders.rows,
  });
});
router.get('/report', async (req, res) => {
  const { rows } = await query(
    `select b.id, b.name, b.type, b.total_stock,
       count(s.id)::int as selections
     from benefits b
     left join selections s on s.benefit_id=b.id
     group by b.id order by b.sort_order`
  );
  res.json(rows);
});

export default router;
