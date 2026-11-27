-- Villar: "Live → Photo" — cache index, cost log, daily quotas, generation locks and the admin job queue
-- (api/photo.js, api/plate.js, api/photo-hook.js). Apply once in the Villar Supabase project (same project as
-- db/leads.sql). Only the service role (SUPABASE_KEY, the sb_secret_… key in the Vercel env) can touch any of it:
-- RLS on, no policies, grants revoked from anon/authenticated. The images are public-read Storage objects.
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------------------------------- storage
-- Public-read bucket. No storage.objects policies are added: anon/authenticated can neither list nor write;
-- public objects are readable by URL (/storage/v1/object/public/photos/…); the service role writes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- prefixes: v1/ preset/ frames/ plates/ art/ (photo-1); twins/ models/ (digital twins, photo-2: GLB up to 50 MB)
values ('photos', 'photos', true, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'application/json', 'model/gltf-binary'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------------------------------- index + cost log
create table if not exists public.photo_renders (
  key            text primary key check (key ~ '^[a-z0-9:._-]{8,120}$'),
  path           text check (path is null or char_length(path) between 5 and 200),   -- null while pending / failed
  kind           text not null default 'photo' check (kind in ('photo', 'plate', 'plate-video', 'plate-mask', 'edition')),
  source         text not null default 'user' check (source in ('user', 'preset', 'plate')),
  status         text not null default 'ok' check (status in ('ok', 'rejected', 'pending', 'failed')),
  model          text not null check (char_length(model) <= 80),
  provider       text check (provider is null or provider in ('higgsfield', 'gateway')),
  request_id     text check (request_id is null or char_length(request_id) <= 80),   -- provider job id (async)
  prompt_version text not null check (char_length(prompt_version) <= 16),
  style          text check (style is null or char_length(style) <= 40),
  time_of_day    text check (time_of_day is null or char_length(time_of_day) <= 16),
  size           text check (size is null or char_length(size) <= 8),
  aspect         text check (aspect is null or char_length(aspect) <= 8),
  width          integer, height integer, bytes integer,
  ms             integer,                                  -- model call duration
  cost_usd       numeric(8, 4),                            -- list price of this generation
  refs           integer,                                  -- reference photos sent with it
  rejects        integer not null default 0,               -- client structural-check failures
  last_score     numeric(6, 4),
  session        text check (session is null or char_length(session) <= 40),
  ip_hash        text check (ip_hash is null or char_length(ip_hash) <= 40),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.photo_renders is 'Villar Live → Photo: one row per cached photo / window plate (latest generation per key). Written by api/photo.js and api/plate.js with the service role.';
create index if not exists photo_renders_created_idx on public.photo_renders (created_at desc);
create index if not exists photo_renders_cost_idx on public.photo_renders (kind, created_at desc) include (cost_usd);
create index if not exists photo_renders_request_idx on public.photo_renders (request_id) where request_id is not null;
alter table public.photo_renders enable row level security;   -- no policies: anon/authenticated get nothing
revoke all on public.photo_renders from anon, authenticated;

-- daily counters: 'global', 'ip:<salted hash>', 's:<session id>' — only generations count (cache hits are free)
create table if not exists public.photo_quota (
  day     date not null,
  subject text not null check (char_length(subject) <= 60),
  n       integer not null default 0,
  primary key (day, subject)
);
alter table public.photo_quota enable row level security;
revoke all on public.photo_quota from anon, authenticated;

-- generation locks (window plates: concurrent first requests must not generate twice)
create table if not exists public.photo_locks (
  key        text primary key check (char_length(key) <= 120),
  owner      text not null check (char_length(owner) <= 40),
  expires_at timestamptz not null
);
alter table public.photo_locks enable row level security;
revoke all on public.photo_locks from anon, authenticated;

-- admin job queue (docs/ART.md): rows are inserted by the coordinator (Supabase connector = the authorization);
-- `POST|GET /api/photo?run=1` claims the oldest runnable job and runs one step of it. Plates, masks, art editions
-- and hero/preset photos are generated ONLY from here.
create table if not exists public.photo_jobs (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('plate', 'plate-edit', 'mask', 'edition', 'hero', 'preset', 'loop')),
  params       jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object' and octet_length(params::text) <= 16384),
  status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  result       jsonb,
  cost         numeric(8, 4),
  error        text check (error is null or char_length(error) <= 2000),
  attempts     integer not null default 0,
  locked_until timestamptz,                               -- lease: a running job is re-claimable after this
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
comment on table public.photo_jobs is 'Villar Live → Photo admin queue: insert rows to generate plates / masks / art editions / hero and preset photos.';
create index if not exists photo_jobs_runnable_idx on public.photo_jobs (status, created_at) where status in ('queued', 'running');
alter table public.photo_jobs enable row level security;
revoke all on public.photo_jobs from anon, authenticated;

-- live config (photo-1b): the coordinator switches visitor generation on/off and fixes overrides from here.
-- Rows: visitors → true|false (absent = false) · pilots → ["<session id>", …] · caps → {"perIp":12,"global":60} ·
-- ab → "higgsfield:seedream_5_5:0.2" · cost → {"<model id>":{"2K":0.06}} · models → {"nano_banana_2_1":{"path":"…"}}.
-- The functions read it with a 30 s cache; a read error means visitors off.
create table if not exists public.photo_config (
  name       text primary key check (name ~ '^[a-z_]{2,40}$'),
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
comment on table public.photo_config is 'Villar Live → Photo live switches: visitors, pilots, caps, ab, cost, models. Service role only.';
alter table public.photo_config enable row level security;   -- no policies: anon/authenticated get nothing
revoke all on public.photo_config from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------- RPCs (service role only)
-- Claim the oldest runnable job (queued, or running with an expired lease = a provider job to check again).
create or replace function public.photo_claim_job(p_lease_seconds integer default 70)
returns setof public.photo_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.photo_jobs;
begin
  select * into j from public.photo_jobs
   where status = 'queued' or (status = 'running' and (locked_until is null or locked_until < now()))
   order by created_at
   limit 1
   for update skip locked;
  if not found then return; end if;
  update public.photo_jobs
     set status = 'running', started_at = coalesce(started_at, now()), attempts = attempts + 1,
         locked_until = now() + make_interval(secs => least(greatest(p_lease_seconds, 10), 300))
   where id = j.id
  returning * into j;
  return next j;
end;
$$;

-- Take one unit from every subject if all are under their caps (all or nothing). Returns true when taken.
create or replace function public.photo_take_quota(p_subjects text[], p_caps integer[])
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := (now() at time zone 'utc')::date;
  i integer;
  cur integer;
begin
  if p_subjects is null or array_length(p_subjects, 1) is null or array_length(p_subjects, 1) <> array_length(p_caps, 1) then
    raise exception 'bad_args' using errcode = 'P0001';
  end if;
  insert into public.photo_quota (day, subject, n)
    select d, s, 0 from unnest(p_subjects) s
  on conflict do nothing;
  perform 1 from public.photo_quota where day = d and subject = any (p_subjects) order by subject for update;
  for i in 1 .. array_length(p_subjects, 1) loop
    select n into cur from public.photo_quota where day = d and subject = p_subjects[i];
    if cur >= p_caps[i] then return false; end if;
  end loop;
  update public.photo_quota set n = n + 1 where day = d and subject = any (p_subjects);
  delete from public.photo_quota where day < d - 7;          -- keep a week of history
  return true;
end;
$$;

-- Give the unit back when the generation failed (billing off, model error): failures never burn the quota.
create or replace function public.photo_refund_quota(p_subjects text[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.photo_quota set n = greatest(0, n - 1)
   where day = (now() at time zone 'utc')::date and subject = any (p_subjects);
$$;

-- A client's structural check rejected this photo: count it; user photos stop being served (presets only count).
create or replace function public.photo_reject(p_key text, p_score numeric)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.photo_renders
     set rejects = rejects + 1, last_score = p_score, updated_at = now(),
         status = case when source = 'user' then 'rejected' else status end
   where key = p_key
  returning rejects;
$$;

-- Lock `p_key` for `p_ttl_seconds` unless someone else holds a live lock. Returns true if the caller holds it.
create or replace function public.photo_lock(p_key text, p_owner text, p_ttl_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.photo_locks (key, owner, expires_at)
  values (p_key, p_owner, now() + make_interval(secs => least(greatest(p_ttl_seconds, 5), 900)))
  on conflict (key) do update
    set owner = excluded.owner, expires_at = excluded.expires_at
    where public.photo_locks.expires_at < now();
  return exists (select 1 from public.photo_locks where key = p_key and owner = p_owner and expires_at > now());
end;
$$;

create or replace function public.photo_unlock(p_key text, p_owner text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.photo_locks where key = p_key and owner = p_owner;
$$;

revoke all on function public.photo_claim_job(integer) from public, anon, authenticated;
grant execute on function public.photo_claim_job(integer) to service_role;
revoke all on function public.photo_take_quota(text[], integer[]) from public, anon, authenticated;
revoke all on function public.photo_refund_quota(text[]) from public, anon, authenticated;
revoke all on function public.photo_reject(text, numeric) from public, anon, authenticated;
revoke all on function public.photo_lock(text, text, integer) from public, anon, authenticated;
revoke all on function public.photo_unlock(text, text) from public, anon, authenticated;
grant execute on function public.photo_take_quota(text[], integer[]) to service_role;
grant execute on function public.photo_refund_quota(text[]) to service_role;
grant execute on function public.photo_reject(text, numeric) to service_role;
grant execute on function public.photo_lock(text, text, integer) to service_role;
grant execute on function public.photo_unlock(text, text) to service_role;

-- ---------------------------------------------------------------------------------------------------- reporting
-- Config (examples):
--   insert into public.photo_config (name, value) values ('pilots', '["<session from villarUI.photo.session>"]')
--     on conflict (name) do update set value = excluded.value, updated_at = now();
--   insert into public.photo_config (name, value) values ('visitors', 'true')
--     on conflict (name) do update set value = excluded.value, updated_at = now();
-- Queue a job (examples; the coordinator inserts these):
--   insert into public.photo_jobs (kind, params) values ('plate', '{"time":"day"}');
--   insert into public.photo_jobs (kind, params) values ('plate-edit', '{"time":"sunset"}'), ('plate-edit', '{"time":"evening"}');
--   insert into public.photo_jobs (kind, params) values ('mask', '{}');
--   insert into public.photo_jobs (kind, params) values ('edition', '{"id":"dw-ink-umber-1","style":"dark-walnut",
--     "prompt":"large tonal abstract, layered ink washes in umber and soft black, one quiet rust field lower left",
--     "palette":["#3B2A20","#E9E1D6","#A4532E"],"aspect":"3:2","resolution":"2K","candidates":2}');
--   insert into public.photo_jobs (kind, params) values ('hero', '{"from":"<64-hex photo key of a stored frame>"}');
--   then call GET https://<site>/api/photo?run=1 once per step (each call runs at most one step of one job).
-- Spend per day and model (list prices):
--   select date_trunc('day', created_at) d, model, kind, count(*) n, sum(cost_usd) usd
--     from public.photo_renders group by 1, 2, 3 order by 1 desc;
-- Note: photo_renders keeps the latest generation per key; the full per-generation log is the
-- `{"ev":"photo.gen", …}` line in the Vercel function logs.
