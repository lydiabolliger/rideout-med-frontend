-- Link incidents to rideouts and allow admin cleanup.
-- Run once in Supabase SQL Editor.

alter table public.incidents
  add column if not exists rideout_id uuid references public.rideouts(id) on delete set null;

create index if not exists incidents_rideout_id_idx
  on public.incidents (rideout_id);

create table if not exists public.rideout_helpers (
  rideout_id uuid not null references public.rideouts(id) on delete cascade,
  helper_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (rideout_id, helper_id)
);

create index if not exists rideout_helpers_rideout_idx
  on public.rideout_helpers (rideout_id);

alter table public.rideout_helpers enable row level security;

drop policy if exists "rideout_helpers_select_authenticated" on public.rideout_helpers;
create policy "rideout_helpers_select_authenticated"
on public.rideout_helpers
for select
to authenticated
using (true);

drop policy if exists "rideout_helpers_insert_self_or_admin" on public.rideout_helpers;
create policy "rideout_helpers_insert_self_or_admin"
on public.rideout_helpers
for insert
to authenticated
with check (
  helper_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "rideout_helpers_update_self_or_admin" on public.rideout_helpers;
create policy "rideout_helpers_update_self_or_admin"
on public.rideout_helpers
for update
to authenticated
using (
  helper_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  )
)
with check (
  helper_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "rideout_helpers_delete_admin" on public.rideout_helpers;
create policy "rideout_helpers_delete_admin"
on public.rideout_helpers
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  )
);

-- Optional: if your project uses strict RLS, these policies allow admin cleanup.
drop policy if exists "incidents_delete_admin" on public.incidents;
create policy "incidents_delete_admin"
on public.incidents
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "incident_assignments_delete_admin" on public.incident_assignments;
create policy "incident_assignments_delete_admin"
on public.incident_assignments
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "helper_locations_delete_self_or_admin" on public.helper_locations;
create policy "helper_locations_delete_self_or_admin"
on public.helper_locations
for delete
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "helper_locations_select_authenticated" on public.helper_locations;
create policy "helper_locations_select_authenticated"
on public.helper_locations
for select
to authenticated
using (true);

drop policy if exists "helper_locations_insert_self_or_admin" on public.helper_locations;
create policy "helper_locations_insert_self_or_admin"
on public.helper_locations
for insert
to authenticated
with check (
  user_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "helper_locations_update_self_or_admin" on public.helper_locations;
create policy "helper_locations_update_self_or_admin"
on public.helper_locations
for update
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  )
)
with check (
  user_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  )
);
