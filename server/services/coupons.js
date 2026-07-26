import { withTransaction } from '../db/index.js';

/**
 * הקצאת קופון פנוי ללקוח.
 * משתמש ב-FOR UPDATE SKIP LOCKED כדי שמתקשרים במקביל
 * לא יקבלו את אותו קופון ולא ייתקעו זה על זה.
 *
 * @returns {Promise<string|null>}  קוד הקופון שהוקצה, או null אם אזל המלאי
 */
export async function assignCoupon(benefitId, phone) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `select id, code
         from coupons
        where benefit_id = $1
          and phone is null
        order by id
        limit 1
        for update skip locked`,
      [benefitId]
    );

    if (rows.length === 0) return null; // אזל המלאי

    const coupon = rows[0];
    await client.query(
      `update coupons
          set phone = $1, assigned_at = now()
        where id = $2`,
      [phone, coupon.id]
    );

    return coupon.code;
  });
}

/**
 * שחרור כל הקופונים של לקוח בהטבה מסוימת — חוזרים למלאי.
 */
export async function releaseCoupons(benefitId, phone) {
  return withTransaction(async (client) => {
    await client.query(
      `update coupons
          set phone = null, assigned_at = null
        where benefit_id = $1
          and phone = $2`,
      [benefitId, phone]
    );
  });
}

/**
 * שליפת כל הקופונים של לקוח בהטבה — להקראה ברצף בטלפון.
 */
export async function getCustomerCoupons(benefitId, phone) {
  const { rows } = await (await import('../db/index.js')).query(
    `select code
       from coupons
      where benefit_id = $1
        and phone = $2
      order by assigned_at`,
    [benefitId, phone]
  );
  return rows.map((r) => r.code);
}
