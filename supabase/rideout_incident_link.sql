-- Link incidents to rideouts and allow admin cleanup.
-- Run once in Supabase SQL Editor.

alter table public.incidents
  add column if not exists rideout_id uuid references public.rideouts(id) on delete set null;

create index if not exists incidents_rideout_id_idx
  on public.incidents (rideout_id);

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
