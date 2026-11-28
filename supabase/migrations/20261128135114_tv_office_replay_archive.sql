create or replace function public.tv_office_replays(p_viewer uuid) returns jsonb language sql stable security invoker set search_path='' as $$
with permitted as (select 1 from public.tv_office_viewers v join public.profiles p on p.id=v.user_id where v.user_id=p_viewer and v.enabled and p.status='active'),
rounds as (select distinct on (r.game_slug) r.id,r.game_slug,r.finished_at,r.state,p.display_name,p.avatar from public.casino_rounds r join public.profiles p on p.id=r.user_id join public.tv_participant_consent c on c.user_id=p.id and c.enabled where r.status='finished' and p.status='active' order by r.game_slug,r.finished_at desc,r.id desc),
items as (select finished_at,jsonb_build_object('id',id,'game',game_slug,'finished_at',finished_at,'participant',jsonb_build_object('name',display_name,'avatar',avatar),'result',case game_slug
when 'roulette' then jsonb_build_object('number',state->'number','color',state->'color')
when 'dice' then jsonb_build_object('roll',state->'roll')
when 'blackjack' then jsonb_build_object('dealerTotal',state->'dealerTotal')
when 'mines' then jsonb_build_object('revealed_count',case when jsonb_typeof(state->'revealed')='array' then jsonb_array_length(state->'revealed') end)
when 'plinko' then jsonb_build_object('bucket',state->'bucket')
when 'horse' then jsonb_build_object('winner',state->'winner')
when 'higher_lower' then jsonb_build_object('steps',case when jsonb_typeof(state->'history')='array' then jsonb_array_length(state->'history') end)
when 'businka_slots' then jsonb_build_object('spins',case when jsonb_typeof(state->'spins')='array' then jsonb_array_length(state->'spins') end)
when 'crash' then jsonb_build_object('crash',state->'crash')
else '{}'::jsonb end) item from rounds)
select case when exists(select 1 from permitted) then coalesce((select jsonb_agg(item order by finished_at desc) from items),'[]'::jsonb) else null end;
$$;
revoke all on function public.tv_office_replays(uuid) from public,anon,authenticated;
grant execute on function public.tv_office_replays(uuid) to service_role;