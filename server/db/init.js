import { pool } from './index.js';

// יצירת ה-schema והטבלאות בהפעלה, אם עדיין לא קיימים.
// idempotent — בטוח להריץ בכל עלייה של השרת.
const SCHEMA = `
create schema if not exists mekusharim;

create table if not exists mekusharim.contacts (
  id          bigserial primary key,
  phone       text not null unique,
  name        text,
  synagogue   text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_contacts_phone on mekusharim.contacts(phone);

create table if not exists mekusharim.benefits (
  id            bigserial primary key,
  name          text not null,
  recording     text,
  type          text not null check (type in ('registration', 'coupon')),
  total_stock   integer not null default 0,
  per_family    integer not null default 1,
  stackable     boolean not null default false,
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

create table if not exists mekusharim.selections (
  id             bigserial primary key,
  phone          text not null,
  benefit_id     bigint not null references mekusharim.benefits(id) on delete cascade,
  recording_path text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_selections_phone on mekusharim.selections(phone);
create index if not exists idx_selections_benefit on mekusharim.selections(benefit_id);

create table if not exists mekusharim.coupons (
  id          bigserial primary key,
  code        text not null,
  benefit_id  bigint not null references mekusharim.benefits(id) on delete cascade,
  phone       text,
  assigned_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_coupons_benefit on mekusharim.coupons(benefit_id);
create index if not exists idx_coupons_phone on mekusharim.coupons(phone);
create index if not exists idx_coupons_available on mekusharim.coupons(benefit_id) where phone is null;

-- migration: עמודות שנוספו לאחר יצירה ראשונית
alter table mekusharim.selections add column if not exists recording_path text;
alter table mekusharim.benefits add column if not exists group_id integer;
alter table mekusharim.contacts add column if not exists phone2 text;
alter table mekusharim.contacts add column if not exists phone3 text;

-- טבלת לוגים ל-IVR
create table if not exists mekusharim.ivr_logs (
  id           bigserial primary key,
  call_id      text,
  phone        text,
  step         integer,
  step_name    text,
  params       jsonb,
  response     text,
  status       text,
  error_msg    text,
  duration_ms  integer,
  created_at   timestamptz default now()
);
create index if not exists idx_ivr_logs_call on mekusharim.ivr_logs(call_id, step);
create index if not exists idx_ivr_logs_time on mekusharim.ivr_logs(created_at desc);
`;

export async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(SCHEMA);
    console.log('DB: schema mekusharim מוכן');
  } catch (err) {
    console.error('DB init error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}
