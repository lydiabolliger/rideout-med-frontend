-- Ensure helper_locations always has valid user IDs.
-- Run once in Supabase SQL Editor.

-- Cleanup legacy rows without user reference.
delete from public.helper_locations
where user_id is null;

-- Enforce non-null user_id for future writes.
alter table public.helper_locations
  alter column user_id set not null;

