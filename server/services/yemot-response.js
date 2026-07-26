/**
 * בוני תשובות לשלוחת API של ימות (type=api).
 * מבוסס על התיעוד הרשמי של ימות המשיח.
 *
 * ── פורמט פריטי השמעה (id_list_message / חלק ראשון של read) ──
 * מופרדים ב-. (נקודה). כל פריט עם prefix:
 *   f-<path>   קובץ. שם בלבד = מתיקיית ברירת המחדל. נתיב מלא מתחיל ב-/
 *   d-<digits> ספרות (Digits) — קורא ספרה-ספרה
 *   n-<number> מספר (Number)
 *   t-<text>   טקסט (TTS עברית/אנגלית)
 *   s-<text>   מנוע דיבור על טקסט
 *
 * ── read ──
 *   read=<הודעה>=<שם_משתנה>,<ברירת_מחדל>,<min>,<max>,<סוג>,<reread>
 *   ההודעה והמשתנה מופרדים ב-= .
 *   סוג: Digits / Number / Voice / Tap
 *
 * ── id_list_message (השמעה בלבד, בלי קליטה) ──
 *   id_list_message=<פריטים>
 *
 * ── פעולות ──
 *   go_to_folder=<יעד>   מעבר לשלוחה. hangup = ניתוק
 */

function esc(text) {
  return String(text).replace(/[=.,&]/g, ' ');
}

// פריטי השמעה
export const file = (path) => `f-${path}`;
export const tts = (text) => `t-${esc(text)}`;
export const digits = (val) => `d-${val}`;
export const number = (val) => `n-${val}`;

/**
 * השמעת רשימת פריטים ברצף (בלי קליטת קלט).
 * מופרדים בנקודה.
 */
export function play(...items) {
  return `id_list_message=${items.join('.')}`;
}

/**
 * השמעה + קליטת הקשה.
 * read=<הודעה>=<var>,<default>,<min>,<max>,<type>,<reread>
 */
export function read({ message, varName, min = 1, max = 1, type = 'Digits', reread = true }) {
  const msg = message.join('.');
  const yesNo = reread ? 'yes' : 'no';
  return `read=${msg}=${varName},,${min},${max},${type},${yesNo}`;
}

/** מעבר לשלוחה אחרת */
export const goToFolder = (target) => `go_to_folder=${target}`;

/** ניתוק */
export const hangup = () => `go_to_folder=hangup`;

/**
 * חיבור שורות פקודה. המפריד הוא & .
 */
export function respond(...lines) {
  return lines.filter(Boolean).join('&');
}
