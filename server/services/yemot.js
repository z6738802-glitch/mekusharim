import 'dotenv/config';

const YEMOT_API = 'https://www.call2all.co.il/ym/api';
const TOKEN = process.env.YEMOT_TOKEN;          // API KEY מחומת האש
const BENEFITS_PATH = process.env.YEMOT_BENEFITS_PATH; // למשל ivr2:5/Benefits

/**
 * העלאת קובץ הקלטה לתיקיית Benefits בימות.
 * הקובץ מומר אוטומטית לפורמט WAV המתאים לטלפוניה (convertAudio=1).
 *
 * @param {Buffer} fileBuffer  תוכן הקובץ
 * @param {string} fileName    שם הקובץ ביעד — ספרות בלבד + סיומת .wav (למשל "001.wav")
 * @returns {Promise<object>}  תשובת השרת (path, size, duration)
 */
export async function uploadRecording(fileBuffer, fileName) {
  const targetPath = `${BENEFITS_PATH}/${fileName}`;

  const form = new FormData();
  form.append('token', TOKEN);
  form.append('path', targetPath);
  form.append('convertAudio', '1');
  form.append('upload', new Blob([fileBuffer]), fileName);

  const res = await fetch(`${YEMOT_API}/UploadFile`, {
    method: 'POST',
    body: form,
  });

  const data = await res.json();

  if (data.responseStatus === 'ERROR' || data.success === false) {
    throw new Error(`Yemot upload failed: ${data.message} (code ${data.messageCode})`);
  }

  return data;
}

/**
 * מחיקת קובץ הקלטה מימות.
 */
export async function deleteRecording(fileName) {
  const target = `${BENEFITS_PATH}/${fileName}`;
  const url = `${YEMOT_API}/FileAction?token=${encodeURIComponent(TOKEN)}&action=delete&what=${encodeURIComponent(target)}`;
  const res = await fetch(url);
  return res.json();
}
