import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

const router = express.Router();
const UPLOAD_DIR = 'uploads';

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // ניקוי שם - שמירת הסיומת המקורית
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext)
      .replace(/[^\w\u0590-\u05FF-]/g, '_')
      .substring(0, 60);
    let name = base + ext;
    let i = 1;
    while (fs.existsSync(path.join(UPLOAD_DIR, name))) {
      name = `${base}_${i}${ext}`;
      i++;
    }
    cb(null, name);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// Auth middleware
function requireKey(req, res, next) {
  const key = req.headers['x-files-key'] || req.query.key;
  if (!key || key !== process.env.FILES_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

router.use(requireKey);

// רשימת קבצים
router.get('/list', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR)
      .filter(f => !f.startsWith('.'))
      .map(name => {
        const stat = fs.statSync(path.join(UPLOAD_DIR, name));
        return { name, size: stat.size, modified: stat.mtime };
      })
      .sort((a, b) => b.modified - a.modified);
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// העלאת קובץ
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  res.json({ name: req.file.filename, size: req.file.size });
});

// מחיקת קובץ
router.delete('/delete/:name', (req, res) => {
  const name = req.params.name;
  const filepath = path.join(UPLOAD_DIR, name);
  if (!filepath.startsWith(path.resolve(UPLOAD_DIR))) {
    return res.status(400).json({ error: 'invalid path' });
  }
  try {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
