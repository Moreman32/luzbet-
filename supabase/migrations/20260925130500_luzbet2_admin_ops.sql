-- =====================================================================
-- LuzBet 2.0 — staff operations that pair with Auth admin calls in the v2-admin Edge Function
-- =====================================================================

-- Validates the actor may manage the target (hierarchy) and records the intent in the audit log.
create or replace function public.rpc_admin_prepare_password_reset(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor public.profiles; target public.profiles;
begin
  actor := private.require_staff('admin');
  select * into target from public.profiles where id = p_user for update;
  if not found then return private.err('player_not_found'); end if;
  if target.id = actor.id then return private.err('use_profile_page'); end if;
  if target.role = 'owner' or (target.role = 'admin' and actor.role <> 'owner') then return private.err('forbidden'); end if;
  update public.profiles set must_change_password = true where id = p_user;
  insert into public.admin_audit_log(actor_id, action, entity, entity_id, reason)
  values (actor.id, 'password_reset', 'profile', p_user::text, 'temporary password issued');
  return jsonb_build_object('ok', true);
end $$;

-- Pre-check before creating an Auth user (so a taken username never leaves an orphan Auth account).
create or replace function public.rpc_admin_username_free(p_username text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff('admin');
  return jsonb_build_object('ok', true, 'free',
    not exists (select 1 from public.profiles where username = lower(btrim(p_username))::extensions.citext));
end $$;

revoke all on function public.rpc_admin_prepare_password_reset(uuid), public.rpc_admin_username_free(text) from public, anon, service_role;
grant execute on function public.rpc_admin_prepare_password_reset(uuid), public.rpc_admin_username_free(text) to authenticated;
notify pgrst, 'reload schema';
