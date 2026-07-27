/**
 * בוני תשובות לשלוחת API של ימות (type=api).
 * מבוסס על התיעוד הרשמי של ימות המשיח.
 */

function esc(text) {
  return String(text).replace(/[=.,&]/g, ' ');
}

export const file = (path) => `f-${path}`;
export const tts = (text) => `t-${esc(text)}`;
export const digits = (val) => `d-${val}`;
export const number = (val) => `n-${val}`;

export function play(...items) {
  return `id_list_message=${items.join('.')}`;
}

/**
 * read=הודעה=var,,,,type,reread,,,,,,,,confirm
 * confirm=no → לא מבקש אישור (ברירת מחדל)
 * confirm=yes → מבקש אישור (למחיקות)
 */
export function read({ message, varName, type = 'Digits', reread = true, confirm = false, extra = '' }) {
  const msg = message.join('.');
  if (type === 'Digits' || type === 'Number') {
    const yesNo = reread ? 'yes' : 'no';
    const confirmVal = confirm ? 'yes' : 'no';
    return `read=${msg}=${varName},,,,1,NO,yes,yes,,,,Ok,,,${confirmVal},`;
  }
  // record
  return `read=${msg}=${varName},,${type}${extra ? ','+extra : ''}`;
}

export const goToFolder = (target) => `go_to_folder=${target}`;
export const hangup = () => `go_to_folder=hangup`;

export function respond(...lines) {
  return lines.filter(Boolean).join('&');
}
