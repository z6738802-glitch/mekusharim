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
  alreadyChose:   `${DIR}/003`, // "כבר בחרת את ההטבה" (+ שם הטבה דינמי)
  alreadyThisOne: `${DIR}/004`, // "כבר בחרת הטבה זו" (לקופון)
  changeMenu:     `${DIR}/005`, // "לשינוי הקש 1, לביטול הקש 2"
  couponMenu:     `${DIR}/006`, // "לשמיעת קופון 1, למחיקה 2, לחזרה 3"
  registered:     `${DIR}/007`, // "בחירתך נרשמה תודה"
  cancelled:      `${DIR}/008`, // "בחירתך בוטלה"
  outOfStock:     `${DIR}/009`, // "המלאי אזל"
  saveCouponNote: `${DIR}/010`, // "שים לב שמור את מספר הקופון"
  yourCouponIs:   `${DIR}/011`, // "הקופון שלך הוא"
  howMany:        `${DIR}/012`, // "הקישו את הכמות הרצויה, ניתן להזמין עד"
  units:          `${DIR}/013`, // "יחידות"
  overQuota:      `${DIR}/014`, // "עברת את מכסת המשפחה"
  noStock:        `${DIR}/015`, // "אין מספיק מלאי"
  approved:       `${DIR}/016`, // "אושרו"
  unitsThanks:    `${DIR}/017`, // "יחידות, תודה"
  recordID:       `${DIR}/018`, // "אנא הקלט את תעודות הזהות"
  couponWarning:  `${DIR}/019`, // "שים לב הטבה זו מסוג קופון, יש לשמור את הקוד"
  replayMenu:     `${DIR}/020`, // "לשמיעה חוזרת הקש 1, לסיום הקש 2"
  deleteMenu:     `${DIR}/021`, // "למחיקה הקש 1, לביטול הקש 2"
};

const REC_DIR = `${DIR}/recordings`;
const benefitRec = (b) => b.recording || `${DIR}/Benefits/${b.id}`;

router.all('/', async (req, res) => {
  const p = { ...req.query, ...req.body };
  const phone = p.ApiPhone;

  try {
    // שלב 0: הרשאה
    if (!(await B.isAuthorized(phone))) {
      return send(res, respond(play(file(REC.notAuthorized)), hangup()));
    }

    const benefits = await B.getActiveBenefits();

    // שלב 1: בחירת הטבה
    if (p.choice === undefined) {
      return send(res, buildMenu(benefits));
    }

    const idx = parseInt(p.choice, 10) - 1;
    const chosen = benefits[idx];
    if (!chosen) {
      return send(res, buildMenu(benefits));
    }

    // שלב 2: כבר בחר את אותה הטבה?
    const already = await B.familyCount(chosen.id, phone);
    if (already > 0) {
      return handleExisting(res, chosen, phone, p);
    }

    // שלב 3: כבר בחר הטבה אחרת (שאינה ניתנת לצבירה)?
    if (!chosen.stackable) {
      const existing = await B.customerSelections(phone);
      const otherActive = existing.filter(s => s.benefit_id !== chosen.id && !s.stackable);
      if (otherActive.length > 0) {
        const other = otherActive[0];
        // שמע: "כבר בחרת את ההטבה" + שם ההטבה האחרת + "לשינוי 1, לביטול 2"
        if (p.switchAction === undefined) {
          return send(res, read({
            message: [
              file(REC.alreadyChose),
              file(benefitRec(other)),
              file(REC.changeMenu),
            ],
            varName: 'switchAction',
          }));
        }
        if (p.switchAction === '1') {
          // מוחק את הישן וממשיך לבחירה החדשה
          await B.removeAllSelections(other.benefit_id, phone);
          await C.releaseCoupons(other.benefit_id, phone);
        } else {
          // ביטול — חוזר לתפריט
          return send(res, buildMenu(benefits));
        }
      }
    }

    // שלב 4: אזהרת קופון (לפני כמות)
    if (chosen.type === 'coupon' && p.couponWarned === undefined) {
      return send(res, read({
        message: [file(REC.couponWarning)],
        varName: 'couponWarned',
      }));
    }

    // שלב 5: בחירת כמות
    if (p.qty === undefined) {
      return send(res, read({
        message: [file(REC.howMany), number(chosen.per_family), file(REC.units)],
        varName: 'qty',
      }));
    }

    const qty = parseInt(p.qty, 10);
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
      return send(res, read({
        message: [file(REC.recordID)],
        varName: 'recPath',
        type: 'record',
        extra: `${REC_DIR},no,yes,yes`,
      }));
    }

    // שלב 8: ביצוע
    const recordingPath = p.recPath || null;
    if (chosen.type === 'coupon') {
      return assignCoupons(res, chosen, phone, qty, recordingPath, p);
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

// כבר בחר את אותה הטבה
async function handleExisting(res, benefit, phone, p) {
  if (benefit.type === 'coupon') {
    // קופון: שמע 003 + שם הטבה + 004 + תפריט קופון
    if (p.couponAction === undefined) {
      return send(res, read({
        message: [
          file(REC.alreadyChose),
          file(benefitRec(benefit)),
          file(REC.alreadyThisOne),
          file(REC.couponMenu),
        ],
        varName: 'couponAction',
        confirm: true,
      }));
    }
    if (p.couponAction === '1') {
      // שמיעת קופונים + תפריט חזרה
      const codes = await C.getCustomerCoupons(benefit.id, phone);
      if (p.replayAction === undefined) {
        const items = [file(REC.saveCouponNote)];
        for (const code of codes) {
          items.push(file(REC.yourCouponIs));
          items.push(digits(code));
        }
        items.push(file(REC.replayMenu));
        return send(res, read({ message: items, varName: 'replayAction' }));
      }
      if (p.replayAction === '1') {
        // שמיעה חוזרת — מאפס replayAction
        const items = [file(REC.saveCouponNote)];
        for (const code of codes) {
          items.push(file(REC.yourCouponIs));
          items.push(digits(code));
        }
        items.push(file(REC.replayMenu));
        return send(res, read({ message: items, varName: 'replayAction' }));
      }
      // 2 = סיום
      return send(res, hangup());
    }
    if (p.couponAction === '2') {
      // מחיקה
      await C.releaseCoupons(benefit.id, phone);
      await B.removeAllSelections(benefit.id, phone);
      return send(res, respond(play(file(REC.cancelled)), hangup()));
    }
    // 3 = חזרה לתפריט
    return send(res, buildMenu(await B.getActiveBenefits()));
  }

  // הרשמה: שמע 003 + שם הטבה + תפריט מחיקה (021)
  if (p.deleteAction === undefined) {
    return send(res, read({
      message: [file(REC.alreadyChose), file(benefitRec(benefit)), file(REC.deleteMenu)],
      varName: 'deleteAction',
      confirm: true,
    }));
  }
  if (p.deleteAction === '1') {
    await B.removeAllSelections(benefit.id, phone);
    return send(res, respond(play(file(REC.cancelled)), hangup()));
  }
  // 2 = חזרה
  return send(res, buildMenu(await B.getActiveBenefits()));
}

// הקצאת קופונים + השמעה חוזרת
async function assignCoupons(res, benefit, phone, qty, recordingPath, p) {
  const codes = [];
  for (let i = 0; i < qty; i++) {
    await B.addSelection(benefit.id, phone, recordingPath);
    const code = await C.assignCoupon(benefit.id, phone);
    if (code === null) {
      await C.releaseCoupons(benefit.id, phone);
      await B.removeAllSelections(benefit.id, phone);
      return send(res, respond(play(file(REC.outOfStock)), hangup()));
    }
    codes.push(code);
  }

  // השמעת הקודים + תפריט חזרה
  if (p.replayAction === undefined) {
    const items = [file(REC.saveCouponNote)];
    for (const code of codes) {
      items.push(file(REC.yourCouponIs));
      items.push(digits(code));
    }
    items.push(file(REC.replayMenu));
    return send(res, read({ message: items, varName: 'replayAction' }));
  }
  if (p.replayAction === '1') {
    const items = [file(REC.saveCouponNote)];
    for (const code of codes) {
      items.push(file(REC.yourCouponIs));
      items.push(digits(code));
    }
    items.push(file(REC.replayMenu));
    return send(res, read({ message: items, varName: 'replayAction' }));
  }
  return send(res, hangup());
}

function send(res, body) {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(body);
}

export default router;
