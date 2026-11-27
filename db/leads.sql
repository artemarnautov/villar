-- Villar: customer leads from "Order the set" (api/lead.js).
-- Apply once in the Villar Supabase project (SQL editor or migration). The publishable/anon key can only call
-- submit_lead(); it cannot read, update or delete leads. Read them in the Supabase dashboard (Table editor → leads).
create extension if not exists pgcrypto;

create table if not exists public.leads (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null check (char_length(name) between 2 and 80),
  phone       text not null check (phone ~ '^\+?[0-9]{7,15}$'),
  email       text check (email is null or (char_length(email) <= 120 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$')),
  comment     text check (comment is null or char_length(comment) <= 600),
  contact     text not null default 'whatsapp' check (contact in ('phone', 'whatsapp', 'email')),
  lang        text not null default 'ru' check (lang in ('ru', 'en', 'ar')),
  style       text not null check (char_length(style) between 1 and 40),
  total_aed   integer not null check (total_aed between 1 and 10000000),
  items       jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 80),
  status      text not null default 'new' check (status in ('new', 'contacted', 'quoted', 'won', 'lost', 'spam')),
  note        text
);
comment on table public.leads is 'Villar: "Order the set" requests. Written only via submit_lead(); prices re-computed server-side.';
create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_phone_idx on public.leads (phone, created_at desc);

alter table public.leads enable row level security;   -- no policies: anon/authenticated get nothing
revoke all on public.leads from anon, authenticated;

create or replace function public.submit_lead(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  v_phone text := p->>'phone';
begin
  -- Same phone at most 5 times a day (bots calling the RPC directly with the public key).
  if (select count(*) from public.leads where phone = v_phone and created_at > now() - interval '1 day') >= 5 then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;
  insert into public.leads (name, phone, email, comment, contact, lang, style, total_aed, items)
  values (
    p->>'name', v_phone, nullif(p->>'email', ''), nullif(p->>'comment', ''),
    coalesce(p->>'contact', 'whatsapp'), coalesce(p->>'lang', 'ru'), p->>'style',
    (p->>'total')::integer, coalesce(p->'items', '[]'::jsonb)
  )
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.submit_lead(jsonb) from public;
grant execute on function public.submit_lead(jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Migration 2 (applied 26.11): style display name + pg_net for Telegram notifications.
create extension if not exists pg_net with schema extensions;
alter table public.leads add column if not exists style_name text check (style_name is null or char_length(style_name) <= 60);

drop trigger if exists leads_notify_telegram on public.leads;
-- (trigger function body: see migration 3, which replaced it)

-- ---------------------------------------------------------------------------------------------------------
-- Migration 3 (applied 26.11, R3-01): the publishable key lives in a public repo, so submit_lead defends
-- itself (consistent items, totals that add up, global and per-phone caps) and Telegram notifications are
-- flood-limited. Secrets: Supabase Vault names telegram_bot_token, telegram_chat_id.
create or replace function public.submit_lead(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  v_phone text := p->>'phone';
  v_items jsonb := coalesce(p->'items', '[]'::jsonb);
  v_total integer := (p->>'total')::integer;
  v_sum bigint;
  v_bad integer;
begin
  if (select count(*) from public.leads where created_at > now() - interval '1 hour') >= 60 then
    raise exception 'busy' using errcode = 'P0001';
  end if;
  if (select count(*) from public.leads where phone = v_phone and created_at > now() - interval '1 day') >= 5 then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) not between 1 and 80 then
    raise exception 'bad_items' using errcode = 'P0001';
  end if;
  select count(*) into v_bad
    from jsonb_array_elements(v_items) i
   where jsonb_typeof(i) <> 'object'
      or char_length(coalesce(i->>'name', '')) not between 1 and 120
      or char_length(coalesce(i->>'id', '')) not between 1 and 80
      or (i->>'qty') !~ '^[0-9]{1,2}$' or (i->>'qty')::int not between 1 and 10
      or (i->>'price') !~ '^[0-9]{1,7}$' or (i->>'sum') !~ '^[0-9]{1,8}$'
      or (i->>'sum')::bigint <> (i->>'price')::bigint * (i->>'qty')::int;
  if v_bad > 0 then raise exception 'bad_items' using errcode = 'P0001'; end if;
  select sum((i->>'sum')::bigint) into v_sum from jsonb_array_elements(v_items) i;
  if v_total is null or v_sum <> v_total then raise exception 'bad_total' using errcode = 'P0001'; end if;

  insert into public.leads (name, phone, email, comment, contact, lang, style, style_name, total_aed, items)
  values (
    p->>'name', v_phone, nullif(p->>'email', ''), nullif(p->>'comment', ''),
    coalesce(p->>'contact', 'whatsapp'), coalesce(p->>'lang', 'ru'), p->>'style', left(nullif(p->>'styleName', ''), 60),
    v_total,
    (select jsonb_agg(jsonb_build_object('id', i->>'id', 'name', i->>'name', 'qty', (i->>'qty')::int,
                                         'price', (i->>'price')::int, 'sum', (i->>'sum')::int))
       from jsonb_array_elements(v_items) i)
  )
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.submit_lead(jsonb) from public;
grant execute on function public.submit_lead(jsonb) to anon, authenticated;

create or replace function public.notify_lead_telegram()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  tok text; chat text; txt text; lines text; recent integer;
  fmt constant text := 'FM999G999G999';
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'telegram_bot_token' limit 1;
  select decrypted_secret into chat from vault.decrypted_secrets where name = 'telegram_chat_id' limit 1;
  if tok is null or chat is null then return new; end if;
  select count(*) into recent from public.leads where created_at > now() - interval '1 hour';
  if recent > 21 then return new; end if;            -- flood: stay quiet, the table still has everything
  if recent = 21 then
    txt := 'Villar: больше 20 заявок за час — уведомления на час приостановлены. Проверьте таблицу leads (возможен спам).';
  else
    select string_agg('• ' || (i->>'name')
             || case when coalesce((i->>'qty')::int, 1) > 1 then ' × ' || (i->>'qty') else '' end
             || ' — ' || replace(to_char((i->>'sum')::int, fmt), ',', ' ') || ' AED', E'\n')
      into lines from jsonb_array_elements(new.items) i;
    txt := 'Новая заявка Villar · ' || left(new.id::text, 8) || E'\n'
        || new.name || ' · ' || new.phone || coalesce(' · ' || new.email, '') || E'\n'
        || 'Связаться: ' || case new.contact when 'phone' then 'звонок' when 'email' then 'e-mail' else 'WhatsApp' end
        || ' · язык: ' || upper(new.lang) || E'\n'
        || 'Стиль: ' || coalesce(new.style_name, new.style) || ' · итого ' || replace(to_char(new.total_aed, fmt), ',', ' ')
        || ' AED · ' || jsonb_array_length(new.items) || ' позиций'
        || coalesce(E'\nКомментарий: ' || new.comment, '')
        || E'\n\n' || coalesce(lines, '');
  end if;
  perform net.http_post(
    url := 'https://api.telegram.org/bot' || tok || '/sendMessage',
    body := jsonb_build_object('chat_id', chat, 'text', left(txt, 4000), 'disable_web_page_preview', true),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.notify_lead_telegram() from public, anon, authenticated;

create trigger leads_notify_telegram after insert on public.leads
  for each row execute function public.notify_lead_telegram();

-- ---------------------------------------------------------------------------------------------------------
-- Migration 4 (applied 27.11, R4-02 mitigation): the global hourly cap ('busy') let one script block every
-- real lead, so it is gone; submit_lead is otherwise as in migration 3 (per-phone cap, consistent items and
-- totals), and service_role may call it too. Planned: revoke EXECUTE from anon/authenticated once the API uses
-- a secret key (SUPABASE_KEY = sb_secret_… in Vercel env).

-- ---------------------------------------------------------------------------------------------------------
-- Migration 5 (applied 27.11, R4-02 fix): only the server submits leads. The API uses a secret key
-- (SUPABASE_KEY = sb_secret_… in Vercel env → service_role); the public key can no longer call submit_lead.
revoke execute on function public.submit_lead(jsonb) from anon, authenticated, public;
grant execute on function public.submit_lead(jsonb) to service_role;
