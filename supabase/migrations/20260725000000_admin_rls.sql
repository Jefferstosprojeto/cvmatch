-- Admins can act on any row across user-owned tables. The existing RLS
-- policies only allow auth.uid() = owner, so the Admin Panel's cross-user
-- actions (search reset, CV limits, plan changes, block/unblock) were
-- silently affecting 0 rows for anyone other than the admin themselves.
--
-- A policy on user_profiles can't query user_profiles directly (infinite
-- recursion), so the admin check is wrapped in a SECURITY DEFINER function,
-- which runs as the function owner and bypasses RLS internally.
create or replace function public.is_admin()
returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce((select is_admin from user_profiles where id = auth.uid()), false);
$$;

drop policy if exists "admins manage all profiles" on user_profiles;
create policy "admins manage all profiles" on user_profiles
  for all using (public.is_admin());

drop policy if exists "admins manage all history" on search_history;
create policy "admins manage all history" on search_history
  for all using (public.is_admin());

drop policy if exists "admins manage all cvs" on cvs;
create policy "admins manage all cvs" on cvs
  for all using (public.is_admin());
