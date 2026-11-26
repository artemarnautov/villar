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
