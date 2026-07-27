import { query } from '../db/index.js';

/** האם המספר ברשימת הלקוחות המורשים */
export async function isAuthorized(phone) {
  const { rows } = await query(
    `select 1 from contacts where phone = $1 limit 1`,
    [phone]
  );
  return rows.length > 0;
}

/** רשימת ההטבות הפעילות, לפי סדר התפריט */
export async function getActiveBenefits() {
  const { rows } = await query(
    `select id, name, recording, type, total_stock, per_family, stackable
       from benefits
      where active = true
      order by sort_order, id`
  );
  return rows;
}

/** הטבה בודדת לפי מזהה */
export async function getBenefit(benefitId) {
  const { rows } = await query(
    `select id, name, recording, type, total_stock, per_family, stackable
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
    `select s.benefit_id, b.name, b.type, b.stackable
       from selections s
       join benefits b on b.id = s.benefit_id
      where s.phone = $1`,
    [phone]
  );
  return rows;
}

/** רישום בחירה חדשה */
export async function addSelection(benefitId, phone) {
  await query(
    `insert into selections (benefit_id, phone) values ($1, $2)`,
    [benefitId, phone]
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

  // 3. אם ההטבה אינה ניתנת לצבירה — בדוק שאין הטבה אחרת פעילה
  if (!benefit.stackable) {
    const existing = await customerSelections(phone);
    const otherNonStackable = existing.filter(
      (s) => s.benefit_id !== benefit.id && !s.stackable
    );
    if (otherNonStackable.length > 0) {
      return { ok: false, reason: 'has_other_benefit', other: otherNonStackable[0] };
    }
  }

  return { ok: true };
}
