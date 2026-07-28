import { query } from '../db/index.js';

/** האם המספר מורשה — מחזיר את ה-phone הראשי (לבדיקת הזמנות) */
export async function isAuthorized(phone) {
  const { rows } = await query(
    `select phone from contacts 
      where phone = $1 or phone2 = $1 or phone3 = $1
      limit 1`,
    [phone]
  );
  if (!rows.length) return null;
  return rows[0].phone; // מחזיר את ה-phone הראשי
}

/** רשימת ההטבות הפעילות, לפי סדר התפריט */
export async function getActiveBenefits() {
  const { rows } = await query(
    `select id, name, recording, type, total_stock, per_family, stackable, group_id
       from benefits
      where active = true
      order by sort_order, id`
  );
  return rows;
}

/** הטבה בודדת לפי מזהה */
export async function getBenefit(benefitId) {
  const { rows } = await query(
    `select id, name, recording, type, total_stock, per_family, stackable, group_id
       from benefits where id = $1`,
    [benefitId]
  );
  return rows[0] || null;
}

/** כמה פעמים הלקוח כבר בחר את ההטבה הזו */
export async function familyCount(benefitId, phone) {
  const { rows } = await query(
    `select count(*)::int as n
       from selections
      where benefit_id = $1 and phone = $2`,
    [benefitId, phone]
  );
  return rows[0].n;
}

/** כמה יחידות כבר נבחרו בסך הכל (לבדיקת מלאי כללי) */
export async function totalTaken(benefitId) {
  const { rows } = await query(
    `select count(*)::int as n
       from selections
      where benefit_id = $1`,
    [benefitId]
  );
  return rows[0].n;
}

/** כל הבחירות הפעילות של הלקוח (לבדיקת "כבר בחר הטבה") */
export async function customerSelections(phone) {
  const { rows } = await query(
    `select s.benefit_id, s.benefit_id as id, b.name, b.recording, b.type, b.stackable, b.group_id
       from selections s
       join benefits b on b.id = s.benefit_id
      where s.phone = $1`,
    [phone]
  );
  return rows;
}

/** רישום בחירה חדשה (עם נתיב הקלטה אופציונלי) */
export async function addSelection(benefitId, phone, recordingPath = null) {
  await query(
    `insert into selections (benefit_id, phone, recording_path) values ($1, $2, $3)`,
    [benefitId, phone, recordingPath]
  );
}

/** מחיקת כל הבחירות של לקוח בהטבה (לאיפוס לפני בחירה מחדש) */
export async function removeAllSelections(benefitId, phone) {
  await query(
    `delete from selections where benefit_id = $1 and phone = $2`,
    [benefitId, phone]
  );
}

/** מחיקת בחירה */
export async function removeSelection(benefitId, phone) {
  await query(
    `delete from selections where benefit_id = $1 and phone = $2`,
    [benefitId, phone]
  );
}

/**
 * בדיקה מלאה: האם הלקוח יכול לקחת את ההטבה הזו כעת.
 * מחזיר { ok: true } או { ok: false, reason: '...' }
 *
 * לוגיקת קבוצות:
 * - אם ל-benefit יש group_id — הטבות באותה קבוצה ניתנות לצבירה
 * - הטבות מקבוצות שונות — לא ניתן לצבור
 * - הטבות בלי group_id (null) — עומדות לבד, לא ניתן לצבור עם אף אחת
 */
export async function canTake(benefit, phone) {
  // 1. מלאי כללי (0 = ללא הגבלה)
  if (benefit.total_stock > 0) {
    const taken = await totalTaken(benefit.id);
    if (taken >= benefit.total_stock) {
      return { ok: false, reason: 'out_of_stock' };
    }
  }

  // 2. מגבלה למשפחה
  const mine = await familyCount(benefit.id, phone);
  if (mine >= benefit.per_family) {
    return { ok: false, reason: 'already_taken' };
  }

  // 3. בדיקת קבוצות
  const existing = await customerSelections(phone);
  const otherSelections = existing.filter(s => s.benefit_id !== benefit.id);

  if (otherSelections.length > 0) {
    if (benefit.group_id === null || benefit.group_id === undefined) {
      // הטבה בלי קבוצה — לא ניתן לצבור עם שום דבר
      return { ok: false, reason: 'has_other_benefit', other: otherSelections[0] };
    }
    // הטבה עם קבוצה — בודק אם יש הטבה מקבוצה אחרת
    const otherGroup = otherSelections.find(
      s => String(s.group_id) !== String(benefit.group_id)
    );
    if (otherGroup) {
      return { ok: false, reason: 'has_other_benefit', other: otherGroup };
    }
  }

  return { ok: true };
}
