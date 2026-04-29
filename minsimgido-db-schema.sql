-- 민심지도 MVP DB schema draft
-- Assumption: PostgreSQL

create type region_level as enum ('nation', 'province', 'city');
create type choice_type as enum ('blue', 'red', 'undecided');
create type period_type as enum ('1d', '7d', '30d', '1y');
create type leading_type as enum ('blue', 'red', 'tie', 'undecided');

create table regions (
  id bigserial primary key,
  code varchar(32) not null unique,
  parent_id bigint references regions(id) on delete restrict,
  level region_level not null,
  name varchar(64) not null,
  name_full varchar(128) not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_regions_parent_id on regions(parent_id);
create index idx_regions_level on regions(level);

create table participants (
  id bigserial primary key,
  fingerprint_key varchar(128) not null unique,
  last_ip_hash varchar(128),
  user_agent text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_participants_last_seen_at on participants(last_seen_at desc);

create table participant_choices (
  id bigserial primary key,
  participant_id bigint not null references participants(id) on delete cascade,
  region_id bigint not null references regions(id) on delete cascade,
  choice choice_type not null,
  selected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (participant_id, region_id)
);

create index idx_participant_choices_region_id on participant_choices(region_id);
create index idx_participant_choices_choice on participant_choices(choice);
create index idx_participant_choices_updated_at on participant_choices(updated_at desc);

create table choice_events (
  id bigserial primary key,
  participant_id bigint not null references participants(id) on delete cascade,
  region_id bigint not null references regions(id) on delete cascade,
  previous_choice choice_type,
  new_choice choice_type not null,
  source varchar(32) not null default 'web',
  created_at timestamptz not null default now()
);

create index idx_choice_events_region_id_created_at on choice_events(region_id, created_at desc);
create index idx_choice_events_participant_id_created_at on choice_events(participant_id, created_at desc);

create table region_snapshots (
  id bigserial primary key,
  region_id bigint not null references regions(id) on delete cascade,
  period period_type not null,
  blue_count integer not null default 0,
  red_count integer not null default 0,
  undecided_count integer not null default 0,
  total_count integer not null default 0,
  blue_ratio numeric(5,2) not null default 0,
  red_ratio numeric(5,2) not null default 0,
  undecided_ratio numeric(5,2) not null default 0,
  leading_choice leading_type not null,
  gap_percent numeric(5,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (region_id, period)
);

create index idx_region_snapshots_period on region_snapshots(period);
create index idx_region_snapshots_leading_choice on region_snapshots(leading_choice);

create table summary_metrics (
  id bigserial primary key,
  scope_region_id bigint not null references regions(id) on delete cascade,
  period period_type not null,
  total_participants integer not null default 0,
  local_participants integer not null default 0,
  close_regions_count integer not null default 0,
  low_volume_regions_count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (scope_region_id, period)
);

create index idx_summary_metrics_period on summary_metrics(period);

-- Optional helper function trigger for updated_at columns can be added later.

-- ------------------------------------------------------------
-- Sample reference data
-- ------------------------------------------------------------

insert into regions (id, code, parent_id, level, name, name_full, sort_order)
values
  (1, 'KR', null, 'nation', '전국', '전국', 1),
  (10, 'KR-11', 1, 'province', '서울', '서울특별시', 10),
  (11, 'KR-41', 1, 'province', '경기', '경기도', 11),
  (12, 'KR-26', 1, 'province', '부산', '부산광역시', 12),
  (1101, 'KR-41-1101', 11, 'city', '수원시', '경기도 수원시', 1101),
  (1102, 'KR-41-1102', 11, 'city', '성남시', '경기도 성남시', 1102),
  (1001, 'KR-11-1001', 10, 'city', '종로구', '서울특별시 종로구', 1001),
  (1002, 'KR-11-1002', 10, 'city', '마포구', '서울특별시 마포구', 1002);

-- ------------------------------------------------------------
-- Example write flow
-- ------------------------------------------------------------
-- 1) participant lookup/create by fingerprint_key
-- 2) participant_choices upsert
-- 3) choice_events insert
-- 4) region_snapshots refresh (sync or async)

-- Example upsert
-- insert into participant_choices (participant_id, region_id, choice)
-- values (1, 1101, 'blue')
-- on conflict (participant_id, region_id)
-- do update set
--   choice = excluded.choice,
--   updated_at = now();
