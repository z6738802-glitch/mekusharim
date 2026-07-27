import express from 'express';
import * as B from '../services/benefits.js';
import * as C from '../services/coupons.js';
import { play, read, file, tts, digits, number, hangup, respond } from '../services/yemot-response.js';

const router = express.Router();

const DIR = process.env.YEMOT_MAIN_DIR || '';

const REC = {
  notAuthorized:  `${DIR}/000`, // מספרך אינו מורשה
  choosePrefix:   `${DIR}/001`, // "לבחירת"
  pressPrefix:    `${DIR}/002`, // "הקישו"
  alreadyChose:   `${DIR}/003`, // כבר בחרת הטבה אחרת
  alreadyThisOne: `${DIR}/004`, // כבר בחרת הטבה זו
  changeMenu:     `${DIR}/005`, // לשינוי הקש 1, לביטול הקש 2
  couponMenu:     `${DIR}/006`, // לשמיעת קופון 1, למחיקה 2, לחזרה 3
  registered:     `${DIR}/007`, // בחירתך נרשמה תודה
  cancelled:      `${DIR}/008`, // בחירתך בוטלה
  outOfStock:     `${DIR}/009`, // המלאי אזל
  saveCouponNote: `${DIR}/010`, // שים לב שמור את מספר הקופון
  yourCouponIs:   `${DIR}/011`, // הקופון שלך הוא
  howMany:        `${DIR}/012`, // "הקישו את הכמות הרצויה, ניתן להזמין עד"
  units:          `${DIR}/013`, // "יחידות"
  overQuota:      `${DIR}/014`, // "עברת את מכסת המשפחה"
  noStock:        `${DIR}/015`, // "אין מספיק מלאי"
  approved:       `${DIR}/016`, // "אושרו"
  unitsThanks:    `${DIR}/017`, // "יחידות, תודה"
  recordID:       `${DIR}/018`, // "אנא הקלט את מספרי תעודת הזהות של הילדים"
};

// תיקיית הקלטות ת"ז בימות
const REC_DIR = process.env.YEMOT_MAIN_DIR ? `${DIR}/recordings` : '/mekusharim/recordings';

const benefitRec = (b) => b.recording || `${DIR}/Benefits/${b.id}`;

router.all('/ivr', async (req, res) => {
  const p = { ...req.query, ...req.body };
  const phone = p.ApiPhone;

  try {
    // שלב 0: הרשאה
    if (!(await B.isAuthorized(phone))) {
      return send(res, respond(play(file(REC.notAuthorized)), hangup()));
    }

    const benefits = await B.getActiveBenefits();

    // שלב 1: בחירת הטבה לפי מיקום בתפריט
    if (p.choice === undefined) {
      return send(res, buildMenu(benefits));
    }

    const idx = parseInt(p.choice, 10) - 1;
    const chosen = benefits[idx];
    if (!chosen) {
      return send(res, buildMenu(benefits));
    }

    // שלב 2: כבר בחר בעבר?
    const already = await B.familyCount(chosen.id, phone);
    if (already > 0) {
      return handleExisting(res, chosen, phone, p);
    }

    // שלב 3: בדיקת צבירה
    const check = await B.canTake(chosen, phone);
    if (!check.ok && check.reason === 'has_other_benefit') {
      return send(res, respond(play(file(REC.alreadyChose)), hangup()));
    }

    // שלב 4: בחירת כמות
    if (p.qty === undefined) {
      return send(res, read({
        message: [
          file(REC.howMany),
          number(chosen.per_family),
          file(REC.units),
        ],
        varName: 'qty',
      }));
    }

    const qty = parseInt(p.qty, 10);

    // שלב 5: בדיקת כמות מול מגבלת משפחה
    if (isNaN(qty) || qty < 1 || qty > chosen.per_family) {
      return send(res, respond(play(file(REC.overQuota)), hangup()));
    }

    // שלב 6: בדיקת מלאי
    if (chosen.total_stock > 0) {
      const taken = await B.totalTaken(chosen.id);
      if (taken + qty > chosen.total_stock) {
        return send(res, respond(play(file(REC.noStock)), hangup()));
      }
    }

    // שלב 7: הקלטת ת"ז (חובה)
    if (p.recPath === undefined) {
      const recFileName = `${phone}_${Date.now()}`;
      return send(res, read({
        message: [file(REC.recordID)],
        varName: 'recPath',
        type: `record,${REC_DIR}/${recFileName},no,yes,yes`,
      }));
    }

    // שלב 8: ביצוע עם שמירת נתיב ההקלטה
    const recordingPath = p.recPath || null;
    if (chosen.type === 'coupon') {
      return assignCoupons(res, chosen, phone, qty, recordingPath);
    } else {
      for (let i = 0; i < qty; i++) {
        await B.addSelection(chosen.id, phone, recordingPath);
      }
      return send(res, respond(
        play(file(REC.approved), number(qty), file(REC.unitsThanks)),
        hangup()
      ));
    }

  } catch (err) {
    console.error('IVR error:', err);
    return send(res, respond(play(tts('אירעה שגיאה נסו שוב מאוחר יותר')), hangup()));
  }
});

// תפריט בחירת הטבה
function buildMenu(benefits) {
  const items = [];
  benefits.forEach((b, i) => {
    items.push(file(REC.choosePrefix));
    items.push(file(benefitRec(b)));
    items.push(file(REC.pressPrefix));
    items.push(digits(i + 1));
  });
  return read({ message: items, varName: 'choice' });
}

// כבר בחר — טיפול
async function handleExisting(res, benefit, phone, p) {
  if (benefit.type === 'coupon') {
    if (p.couponAction === undefined) {
      return send(res, read({
        message: [file(REC.alreadyThisOne), file(REC.couponMenu)],
        varName: 'couponAction',
      }));
    }
    if (p.couponAction === '1') {
      // שמיעת קופונים
      const codes = await C.getCustomerCoupons(benefit.id, phone);
      const items = [];
      for (const code of codes) {
        items.push(file(REC.yourCouponIs));
        items.push(digits(code));
      }
      return send(res, respond(play(...items), hangup()));
    }
    if (p.couponAction === '2') {
      // מחיקה — מאפס ובוחר מחדש
      await C.releaseCoupons(benefit.id, phone);
      await B.removeAllSelections(benefit.id, phone);
      return send(res, respond(play(file(REC.cancelled)), hangup()));
    }
    // 3 = חזרה
    return send(res, buildMenu(await B.getActiveBenefits()));
  }

  // הרשמה רגילה: 1=שנה(מאפס), 2=חזרה
  if (p.changeAction === undefined) {
    return send(res, read({
      message: [file(REC.alreadyChose), file(REC.changeMenu)],
      varName: 'changeAction',
    }));
  }
  if (p.changeAction === '1') {
    // מאפס ובוחר מחדש
    await B.removeAllSelections(benefit.id, phone);
    return send(res, respond(play(file(REC.cancelled)), hangup()));
  }
  return send(res, buildMenu(await B.getActiveBenefits()));
}

// הקצאת קופונים בכמות
async function assignCoupons(res, benefit, phone, qty, recordingPath = null) {
  const codes = [];
  for (let i = 0; i < qty; i++) {
    await B.addSelection(benefit.id, phone, recordingPath);
    const code = await C.assignCoupon(benefit.id, phone);
    if (code === null) {
      // אזל המלאי באמצע — מבטל הכל
      await C.releaseCoupons(benefit.id, phone);
      await B.removeAllSelections(benefit.id, phone);
      return send(res, respond(play(file(REC.outOfStock)), hangup()));
    }
    codes.push(code);
  }
  // משמיע: "שמור את מספר הקופון" + כל הקודים
  const items = [file(REC.saveCouponNote)];
  for (const code of codes) {
    items.push(file(REC.yourCouponIs));
    items.push(digits(code));
  }
  return send(res, respond(play(...items), hangup()));
}

function send(res, body) {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(body);
}

export default router;
