-- Ensure incidents are visible to authenticated users (helpers/admin) and
-- helpers can create incidents for active rideouts.
-- Run once in Supabase SQL Editor.

alter table public.incidents enable row level security;

drop policy if exists "incidents_select_authenticated" on public.incidents;
create policy "incidents_select_authenticated"
on public.incidents
for select
to authenticated
using (true);

drop policy if exists "incidents_insert_self_or_admin" on public.incidents;
create policy "incidents_insert_self_or_admin"
on public.incidents
for insert
to authenticated
with check (
  created_by = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "incidents_update_admin" on public.incidents;
create policy "incidents_update_admin"
on public.incidents
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

