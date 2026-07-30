import { query } from '../db/index.js';

/**
 * מזהה את שם השלב לפי הפרמטרים שהגיעו.
 */
function detectStepName(p) {
  if (!p.choice || p.choice === 'None') return 'menu';
  if (p.deleteAction && p.deleteAction !== 'None') return 'delete_action';
  if (p.confirmDel && p.confirmDel !== 'None') return 'confirm_delete';
  if (p.couponAction && p.couponAction !== 'None') return 'coupon_action';
  if (p.switchAction && p.switchAction !== 'None') return 'switch_action';
  if (p.replayAction && p.replayAction !== 'None') return 'replay';
  if (p.recPath && p.recPath !== 'None') return 'record_done';
  if (p.qty && p.qty !== 'None') return 'quantity';
  if (p.couponWarned && p.couponWarned !== 'None') return 'coupon_warned';
  return 'benefit_selected';
}

/**
 * middleware שלוגר כל בקשת IVR ל-DB.
 * שומר לפני ואחרי — כולל את התשובה של השרת.
 */
export function ivrLogger(req, res, next) {
  const startTime = Date.now();
  const p = { ...req.query, ...req.body };
  const callId = p.ApiCallId || null;
  const phone = p.ApiPhone || null;

  // מזהה שלב
  const stepName = detectStepName(p);

  // עוטף res.send כדי לתפוס את התגובה
  const origSend = res.send.bind(res);
  let capturedBody = null;
  res.send = (body) => {
    capturedBody = body;
    return origSend(body);
  };

  res.on('finish', async () => {
    try {
      const duration = Date.now() - startTime;
      const responseBody = String(capturedBody || '');

      // סטטוס
      let status = 'ok';
      let errorMsg = null;
      if (responseBody.includes('אירעה שגיאה')) {
        status = 'error';
        errorMsg = 'שגיאה כללית';
      } else if (responseBody.includes('go_to_folder=hangup')) {
        status = 'hangup';
      } else if (responseBody.includes('go_to_folder=/')) {
        status = 'ok_returned';
      }

      // מחשב את מספר השלב לפי מספר הרשומות הקיימות ב-call_id
      let stepNum = 1;
      if (callId) {
        const { rows } = await query(
          `select coalesce(max(step),0) as m from ivr_logs where call_id=$1`,
          [callId]
        );
        stepNum = rows[0].m + 1;
      }

      await query(
        `insert into ivr_logs (call_id, phone, step, step_name, params, response, status, error_msg, duration_ms)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [callId, phone, stepNum, stepName, JSON.stringify(p), responseBody, status, errorMsg, duration]
      );
    } catch (err) {
      console.error('ivrLogger error:', err.message);
    }
  });

  next();
}
