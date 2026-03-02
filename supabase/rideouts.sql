-- Rideout access management
-- Run this once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.rideouts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  join_token text not null unique,
  started_at timestamptz not null default now(),
  closed_at timestamptz null,
  created_by uuid null references auth.users(id) on delete set null
);

alter table public.rideouts
  add column if not exists title text,
  add column if not exists join_token text,
  add column if not exists started_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists created_by uuid;

update public.rideouts
set
  title = coalesce(title, 'Rideout Legacy'),
  join_token = coalesce(join_token, replace(gen_random_uuid()::text, '-', '')),
  started_at = coalesce(started_at, now());

alter table public.rideouts
  alter column title set not null,
  alter column join_token set not null,
  alter column started_at set not null;

alter table public.rideouts
  alter column started_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'rideouts_created_by_fkey'
  ) then
    alter table public.rideouts
      add constraint rideouts_created_by_fkey
      foreign key (created_by) references auth.users(id) on delete set null;
  end if;
end $$;

create unique index if not exists rideouts_join_token_key
  on public.rideouts (join_token);

create unique index if not exists rideouts_only_one_active_idx
  on public.rideouts ((closed_at is null))
  where closed_at is null;

alter table public.rideouts enable row level security;

drop policy if exists "rideouts_select_authenticated" on public.rideouts;
create policy "rideouts_select_authenticated"
on public.rideouts
for select
to authenticated
using (true);

drop policy if exists "rideouts_insert_admin" on public.rideouts;
create policy "rideouts_insert_admin"
on public.rideouts
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "rideouts_update_admin" on public.rideouts;
create policy "rideouts_update_admin"
on public.rideouts
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "rideouts_delete_admin" on public.rideouts;
create policy "rideouts_delete_admin"
on public.rideouts
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  )
);
