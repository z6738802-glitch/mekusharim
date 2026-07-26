import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

// חיבור למסד הנתונים (Supabase / Postgres)
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

// כל השאילתות עובדות על schema בשם mekusharim
pool.on('connect', (client) => {
  client.query('set search_path to mekusharim, public');
});

export async function query(text, params) {
  return pool.query(text, params);
}

// ריצה בתוך טרנזקציה — נחוץ להקצאת קופון עם FOR UPDATE
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('set search_path to mekusharim, public');
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
