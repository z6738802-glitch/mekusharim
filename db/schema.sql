-- ============================================
-- מקושרים — בין הזמנים
-- סכמת בסיס נתונים
-- ============================================

create schema if not exists mekusharim;

-- ── לקוחות מורשים ──────────────────────────
create table mekusharim.contacts (
  id          bigserial primary key,
  phone       text not null unique,
  name        text,
  synagogue   text,                    -- בית כנסת (אופציונלי, לסינון)
  created_at  timestamptz not null default now()
);

create index idx_contacts_phone on mekusharim.contacts(phone);

-- ── הטבות ──────────────────────────────────
create table mekusharim.benefits (
  id            bigserial primary key,
  name          text not null,           -- שם ההטבה
  recording     text,                    -- נתיב הקלטת שם ההטבה בימות
  type          text not null            -- 'registration' | 'coupon'
                check (type in ('registration', 'coupon')),
  total_stock   integer not null default 0,   -- מלאי כללי (0 = ללא הגבלה)
  per_family    integer not null default 1,   -- מגבלה למשפחה
  stackable     boolean not null default false, -- ניתן לצבור עם הטבה אחרת
  active        boolean not null default true,  -- פעיל / כבוי
  sort_order    integer not null default 0,     -- סדר בתפריט
  created_at    timestamptz not null default now()
);

-- ── בחירות (הרשמות) ────────────────────────
create table mekusharim.selections (
  id          bigserial primary key,
  phone       text not null,
  benefit_id  bigint not null references mekusharim.benefits(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index idx_selections_phone on mekusharim.selections(phone);
create index idx_selections_benefit on mekusharim.selections(benefit_id);

-- ── קופונים ────────────────────────────────
create table mekusharim.coupons (
  id          bigserial primary key,
  code        text not null,             -- מזהה הקופון (הקוד עצמו)
  benefit_id  bigint not null references mekusharim.benefits(id) on delete cascade,
  phone       text,                      -- null = פנוי
  assigned_at timestamptz,               -- תאריך הקצאה
  created_at  timestamptz not null default now()
);

create index idx_coupons_benefit on mekusharim.coupons(benefit_id);
create index idx_coupons_phone on mekusharim.coupons(phone);
-- קופון פנוי = phone is null. שאילתת הקצאה משתמשת ב-FOR UPDATE SKIP LOCKED
create index idx_coupons_available on mekusharim.coupons(benefit_id) where phone is null;

-- migration: הוספת עמודת נתיב הקלטה לטבלת selections
alter table mekusharim.selections add column if not exists recording_path text;
