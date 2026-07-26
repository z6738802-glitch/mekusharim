import express from 'express';
import * as B from '../services/benefits.js';
import * as C from '../services/coupons.js';
import { play, read, file, tts, digits, goToFolder, hangup, respond } from '../services/yemot-response.js';

const router = express.Router();

// ── מיפוי הקלטות קבועות ──
// נתיבים מלאים דורשים slash מוביל (f-/...). RECDIR הוא נתיב השלוחה הראשית.
// ניתן להגדיר דרך משתנה סביבה; ברירת מחדל = שורש.
const DIR = process.env.YEMOT_MAIN_DIR || ''; // למשל "/11" — ריק = שורש

const REC = {
  notAuthorized:   `${DIR}/000`, // מספרך אינו מורשה
  choosePrefix:    `${DIR}/001`, // "לבחירת"
  pressPrefix:     `${DIR}/002`, // "הקישו"
  alreadyChose:    `${DIR}/003`, // כבר בחרת את ההטבה
  alreadyThisOne:  `${DIR}/004`, // כבר בחרת הטבה זו
  changeMenu:      `${DIR}/005`, // לשינוי 1, לביטול 2
  couponMenu:      `${DIR}/006`, // לשמיעת קופון 1, למחיקה 2, לחזרה 3
  registered:      `${DIR}/007`, // בחירתך נרשמה תודה
  cancelled:       `${DIR}/008`, // בחירתך בוטלה
  outOfStock:      `${DIR}/009`, // המלאי אזל
  saveCouponNote:  `${DIR}/010`, // שים לב שמור את מספר הקופון
  yourCouponIs:    `${DIR}/011`, // הקופון שלך הוא
};

// נתיב שם ההטבה בתיקיית Benefits
const benefitRec = (benefit) => benefit.recording || `${DIR}/Benefits/${benefit.id}`;

/**
 * שלוחת ה-API הראשית. ימות פונה לכאן בכל שלב.
 * ה-state נשמר בפרמטרים שימות מחזירה (Select*, ok וכו').
 */
router.all('/ivr', async (req, res) => {
  const p = { ...req.query, ...req.body };
  const phone = p.ApiPhone;

  try {
    // ── שלב 0: בדיקת הרשאה (רץ פעם אחת, בכניסה) ──
    if (!(await B.isAuthorized(phone))) {
      return send(res, respond(play(file(REC.notAuthorized)), hangup()));
    }

    const benefits = await B.getActiveBenefits();

    // ── שלב 1: בחירת הטבה ──
    // אם עדיין לא בחר — משמיע תפריט וקולט למשתנה choice.
    if (p.choice === undefined) {
      return send(res, buildMenu(benefits));
    }

    const chosen = benefits.find((b) => String(b.id) === String(p.choice));
    if (!chosen) {
      // בחירה לא חוקית — חוזר לתפריט
      return send(res, buildMenu(benefits));
    }

    // ── שלב 2: בדיקה אם כבר בחר את ההטבה הזו ──
    const already = await B.familyCount(chosen.id, phone);

    if (already > 0) {
      return handleExisting(res, chosen, phone, p);
    }

    // ── שלב 3: בדיקת זכאות (מלאי, מגבלה, צבירה) ──
    const check = await B.canTake(chosen, phone);
    if (!check.ok) {
      return handleBlocked(res, check, chosen, phone);
    }

    // ── שלב 4: ביצוע לפי סוג ──
    if (chosen.type === 'coupon') {
      return assignAndConfirm(res, chosen, phone);
    } else {
      await B.addSelection(chosen.id, phone);
      return send(res, respond(play(file(REC.registered)), hangup()));
    }
  } catch (err) {
    console.error('IVR error:', err);
    return send(res, respond(play(tts('אירעה שגיאה, נסו שוב מאוחר יותר')), hangup()));
  }
});

// ── בניית תפריט הבחירה ──
// "לבחירת [שם הטבה] הקישו [מספר]" לכל הטבה, וקליטה למשתנה choice.
function buildMenu(benefits) {
  const items = [];
  for (const b of benefits) {
    items.push(file(REC.choosePrefix));  // "לבחירת"
    items.push(file(benefitRec(b)));      // שם ההטבה (הקלטה)
    items.push(file(REC.pressPrefix));    // "הקישו"
    items.push(digits(b.id));             // מספר ההטבה
  }
  return read({ message: items, varName: 'choice' });
}

// ── טיפול במצב "כבר בחר" ──
async function handleExisting(res, benefit, phone, p) {
  if (benefit.type === 'coupon') {
    // תפריט קופון: 1=שמע, 2=מחק, 3=חזרה
    if (p.couponAction === undefined) {
      return send(res, read({
        message: [file(REC.alreadyThisOne), file(REC.couponMenu)],
        varName: 'couponAction',
      }));
    }
    if (p.couponAction === '1') {
      const codes = await C.getCustomerCoupons(benefit.id, phone);
      const items = [];
      for (const code of codes) {
        items.push(file(REC.yourCouponIs));
        items.push(digits(code));
      }
      return send(res, respond(play(...items), hangup()));
    }
    if (p.couponAction === '2') {
      await C.releaseCoupons(benefit.id, phone);
      await B.removeSelection(benefit.id, phone);
      return send(res, respond(play(file(REC.cancelled)), hangup()));
    }
    // 3 או אחר — חזרה לתפריט הראשי
    return send(res, buildMenu(await B.getActiveBenefits()));
  }

  // הרשמה רגילה: 1=שנה(מחק), 2=חזרה
  if (p.changeAction === undefined) {
    return send(res, read({
      message: [file(REC.alreadyChose), file(REC.changeMenu)],
      varName: 'changeAction',
    }));
  }
  if (p.changeAction === '1') {
    await B.removeSelection(benefit.id, phone);
    return send(res, respond(play(file(REC.cancelled)), hangup()));
  }
  return send(res, buildMenu(await B.getActiveBenefits()));
}

// ── טיפול בחסימה (מלאי/מגבלה/צבירה) ──
function handleBlocked(res, check, benefit, phone) {
  if (check.reason === 'out_of_stock') {
    return send(res, respond(play(file(REC.outOfStock)), hangup()));
  }
  if (check.reason === 'already_taken') {
    return send(res, respond(play(file(REC.alreadyThisOne)), hangup()));
  }
  if (check.reason === 'has_other_benefit') {
    // כבר יש לו הטבה אחרת שאינה ניתנת לצבירה
    return send(res, respond(play(file(REC.alreadyChose)), hangup()));
  }
  return send(res, hangup());
}

// ── הקצאת קופון ואישור ──
async function assignAndConfirm(res, benefit, phone) {
  await B.addSelection(benefit.id, phone);
  const code = await C.assignCoupon(benefit.id, phone);

  if (code === null) {
    // אזל המלאי בין הבדיקה להקצאה — מבטל את הרישום
    await B.removeSelection(benefit.id, phone);
    return send(res, respond(play(file(REC.outOfStock)), hangup()));
  }

  return send(res, respond(
    play(file(REC.saveCouponNote), file(REC.yourCouponIs), digits(code)),
    hangup()
  ));
}

// ── שליחת תשובה לימות כטקסט ──
function send(res, body) {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(body);
}

export default router;
