
create function public.tv_collect_editorial_events() returns integer language plpgsql security invoker set search_path='' as $$
declare n integer; cutoff timestamptz;
begin
 if not pg_try_advisory_xact_lock(748320261129::bigint) then return 0; end if;
 select collect_since into strict cutoff from public.tv_event_config where singleton;
 insert into public.tv_events(event_key,kind,source_type,source_id,occurred_at,priority,payload)
 select 'activity:'||b::text||':'||game_slug,'activity_digest','casino_rounds',b::text||':'||game_slug,b+interval '1 hour',30,
 jsonb_build_object('game',game_slug,'rounds',count(*),'visibility','aggregate','period_start',b)
 from (select date_trunc('hour',finished_at,'UTC') b,game_slug from public.casino_rounds where status::text='finished' and finished_at>=cutoff) s
 where b+interval '1 hour'<=now() group by b,game_slug having count(*)>=5
 on conflict(event_key) do nothing;
 get diagnostics n=row_count;return n;
end $$;
create function public.tv_round_replay(p_round uuid) returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object('version',1,'game',r.game_slug,'mode','recorded_result_reconstruction','visibility','restricted',
 'result',case r.game_slug
 when 'roulette' then jsonb_build_object('number',r.state->'number','color',r.state->'color')
 when 'dice' then jsonb_build_object('roll',r.state->'roll')
 when 'plinko' then jsonb_build_object('bucket',r.state->'bucket','path',r.state->'path')
 when 'mines' then jsonb_build_object('revealed',r.state->'revealed','hit',r.state->'hit','minePositions',r.state->'minePositions')
 when 'crash' then jsonb_build_object('crash',r.state->'crash')
 when 'horse' then jsonb_build_object('order',r.state->'order','winner',r.state->'winner')
 when 'blackjack' then jsonb_build_object('dealer',r.state->'dealer','dealerTotal',r.state->'dealerTotal')
 when 'higher_lower' then jsonb_build_object('history',r.state->'history')
 else '{}'::jsonb end,
 'actions',(select coalesce(jsonb_agg(jsonb_build_object('seq',a.seq,'action',a.action) order by a.seq),'[]'::jsonb) from public.casino_actions a where a.round_id=r.id))
from public.casino_rounds r where r.id=p_round and r.status::text='finished';
$$;
revoke all on function public.tv_collect_editorial_events(),public.tv_round_replay(uuid) from public,anon,authenticated;
grant execute on function public.tv_collect_editorial_events(),public.tv_round_replay(uuid) to service_role;
select cron.schedule('luzbet-tv-editorial-collector','*/5 * * * *','select public.tv_collect_editorial_events();');
