/**
 * בוני תשובות לשלוחת API של ימות (type=api).
 *
 * ימות מצפה לתשובה כטקסט (text/plain) המורכב משורות פקודה.
 * הפורמט המרכזי:
 *
 *   id_list_message=<פריטים>   — השמעת קבצים/טקסט/מספרים
 *   read=<הודעה>=<משתנה>,...    — השמעת הודעה + קליטת הקשה מהמשתמש
 *   go_to_folder=<יעד>          — מעבר לשלוחה או ניתוק
 *
 * prefixים של פריטי השמעה (בתוך id_list_message / read message):
 *   f-<path>   קובץ אודיו   (למשל f-5/000)
 *   t-<text>   טקסט ל-TTS
 *   d-<digits> הקראת ספרה-ספרה  (מושלם לקוד קופון)
 *   n-<number> הקראת מספר רגיל
 *   m-<amount> הקראת סכום כסף
 *
 * הערה: התיעוד הרשמי של הפורמט הזה מפוזר בפורום. אם משהו לא מתנהג
 * כצפוי בבדיקה מול מערכת אמיתית — כאן המקום היחיד לתקן.
 */

/** בורח מפסיקים/סימנים שמפרשים כמפריד בפורמט של ימות */
function esc(text) {
  return String(text).replace(/[=,&]/g, ' ');
}

/** פריט השמעה של קובץ */
export const file = (path) => `f-${path}`;
/** פריט השמעה של טקסט (TTS) */
export const tts = (text) => `t-${esc(text)}`;
/** הקראת ספרות אחת-אחת (קוד קופון) */
export const digits = (val) => `d-${val}`;

/**
 * השמעת רשימת פריטים ברצף (בלי לקלוט קלט), ואז המשך הזרימה.
 * @param {string[]} items  פריטים (השתמש ב-file()/tts()/digits())
 */
export function play(...items) {
  return `id_list_message=${items.join('.')}`;
}

/**
 * השמעה + קליטת הקשה מהמשתמש למשתנה.
 * @param {object} opts
 * @param {string[]} opts.message   פריטי ההשמעה (file/tts)
 * @param {string}   opts.varName   שם המשתנה שיחזור בקריאה הבאה
 * @param {number}   opts.min       מספר ספרות מינימלי (ברירת מחדל 1)
 * @param {number}   opts.max       מספר ספרות מקסימלי (ברירת מחדל 1)
 * @param {boolean}  opts.reread    האם לחזור על ההשמעה אם אין קלט (ברירת מחדל true)
 */
export function read({ message, varName, min = 1, max = 1, reread = true }) {
  const msg = message.join('.');
  // read=<message>=<var>,<default>,<min>,<max>,<confirmType>,<attempts>,<delay>,<allowEmpty>,...
  // אנו משאירים את רוב השדות ריקים כדי לקבל התנהגות ברירת מחדל של ימות.
  const yesNo = reread ? 'Yes' : 'No';
  return `read=${msg}=${varName},,${min},${max},${yesNo},,,No`;
}

/** מעבר לשלוחה אחרת */
export const goToFolder = (target) => `go_to_folder=${target}`;

/** ניתוק השיחה */
export const hangup = () => `go_to_folder=hangup`;

/**
 * חיבור מספר שורות פקודה לתשובה אחת שנשלחת לימות.
 * ימות מבצעת אותן לפי הסדר.
 */
export function respond(...lines) {
  return lines.filter(Boolean).join('&');
}
