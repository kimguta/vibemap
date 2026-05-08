-- picked / 핃 MVP Supabase schema
-- Run this in Supabase SQL Editor before adding Render environment variables.

do $$
begin
  create type picked_region_level as enum ('nation', 'province', 'city');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type picked_choice_id as enum ('blue', 'red', 'undecided');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type picked_period as enum ('1d', '7d', '30d', '1y');
exception
  when duplicate_object then null;
end $$;

create table if not exists questions (
  id text primary key,
  title text not null,
  category text not null default 'general',
  status text not null default 'draft',
  choices jsonb not null,
  tie_label text not null default '팽팽함',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists regions (
  id text primary key,
  name text not null,
  level picked_region_level not null,
  parent_id text references regions(id) on delete restrict,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_regions_parent_id on regions(parent_id);
create index if not exists idx_regions_level on regions(level);

create table if not exists participants (
  id text primary key,
  user_agent text,
  ip_hash text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists visitor_sessions (
  participant_id text primary key,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  today_key text not null
);

create index if not exists idx_visitor_sessions_last_seen on visitor_sessions(last_seen_at desc);
create index if not exists idx_visitor_sessions_today_key on visitor_sessions(today_key);

create table if not exists participant_choices (
  id uuid primary key default gen_random_uuid(),
  question_id text not null references questions(id) on delete cascade,
  participant_id text not null references participants(id) on delete cascade,
  region_id text not null references regions(id) on delete cascade,
  period picked_period not null default '7d',
  choice_id picked_choice_id not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_id, participant_id, region_id, period)
);

create index if not exists idx_participant_choices_question_region on participant_choices(question_id, region_id);
create index if not exists idx_participant_choices_updated_at on participant_choices(updated_at desc);

create table if not exists choice_events (
  id uuid primary key default gen_random_uuid(),
  question_id text not null references questions(id) on delete cascade,
  participant_id text not null references participants(id) on delete cascade,
  region_id text not null references regions(id) on delete cascade,
  period picked_period not null default '7d',
  previous_choice_id picked_choice_id,
  choice_id picked_choice_id not null,
  source text not null default 'web',
  created_at timestamptz not null default now()
);

create index if not exists idx_choice_events_question_region_time on choice_events(question_id, region_id, created_at desc);

create table if not exists reactions (
  id uuid primary key default gen_random_uuid(),
  question_id text not null references questions(id) on delete cascade,
  participant_id text,
  region_name text not null,
  choice_label text not null,
  text text not null check (char_length(text) between 1 and 36),
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_reactions_visible_time on reactions(is_hidden, created_at desc);

create table if not exists snapshot_seeds (
  id uuid primary key default gen_random_uuid(),
  question_id text not null references questions(id) on delete cascade,
  region_id text not null references regions(id) on delete cascade,
  period picked_period not null default '7d',
  blue_count integer not null default 0,
  red_count integer not null default 0,
  undecided_count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (question_id, region_id, period)
);

create or replace view region_results as
select
  seed.question_id,
  seed.region_id,
  seed.period,
  seed.blue_count + count(choice.id) filter (where choice.choice_id = 'blue'::picked_choice_id)::integer as blue_count,
  seed.red_count + count(choice.id) filter (where choice.choice_id = 'red'::picked_choice_id)::integer as red_count,
  seed.undecided_count + count(choice.id) filter (where choice.choice_id = 'undecided'::picked_choice_id)::integer as undecided_count
from snapshot_seeds seed
left join participant_choices choice
  on choice.question_id = seed.question_id
  and choice.region_id = seed.region_id
  and choice.period = seed.period
group by seed.question_id, seed.region_id, seed.period, seed.blue_count, seed.red_count, seed.undecided_count;

insert into questions (id, title, category, status, choices, tie_label)
values (
  'lunch-jjajang-jjamppong',
  '오늘 점심은 짜장 vs 짬뽕?',
  'food',
  'active',
  '[{"id":"blue","label":"짜장면","resultLabel":"짜장면 강세"},{"id":"red","label":"짬뽕","resultLabel":"짬뽕 강세"},{"id":"gray","label":"아직 못 정함","resultLabel":"선택 적음"}]'::jsonb,
  '팽팽함'
)
on conflict (id) do update set
  title = excluded.title,
  choices = excluded.choices,
  status = excluded.status,
  updated_at = now();

insert into regions (id, name, level, parent_id, sort_order)
values
  ('national', '전국', 'nation', null, 0),
  ('seoul', '서울', 'province', 'national', 10),
  ('busan', '부산', 'province', 'national', 20),
  ('daegu', '대구', 'province', 'national', 30),
  ('incheon', '인천', 'province', 'national', 40),
  ('gwangju', '광주', 'province', 'national', 50),
  ('daejeon', '대전', 'province', 'national', 60),
  ('ulsan', '울산', 'province', 'national', 70),
  ('sejong', '세종', 'province', 'national', 80),
  ('gyeonggi', '경기', 'province', 'national', 90),
  ('gangwon', '강원', 'province', 'national', 100),
  ('chungbuk', '충북', 'province', 'national', 110),
  ('chungnam', '충남', 'province', 'national', 120),
  ('jeonbuk', '전북', 'province', 'national', 130),
  ('jeonnam', '전남', 'province', 'national', 140),
  ('gyeongbuk', '경북', 'province', 'national', 150),
  ('gyeongnam', '경남', 'province', 'national', 160),
  ('jeju', '제주', 'province', 'national', 170),
  ('suwon', '수원시', 'city', 'gyeonggi', 901)
on conflict (id) do update set
  name = excluded.name,
  level = excluded.level,
  parent_id = excluded.parent_id,
  sort_order = excluded.sort_order,
  updated_at = now();
