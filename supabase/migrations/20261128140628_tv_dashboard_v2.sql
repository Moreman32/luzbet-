-- Read-only analytics. Never modifies rounds, wallets, ledger or game rules.
create or replace view private.tv_analytics_rounds as
with legacy_ranked as (
 select e.*, row_number() over(partition by
 case when nullif(trim(e.round_id),'') is not null and nullif(trim(e.code),'') is not null
 then lower(trim(e.code))||'|'||trim(e.round_id) else 'row:'||e.id::text end
 order by (e.meta->>'status'='finished') desc,e.id desc) rn
 from legacy_20260925.casino_events e
 where e.event_type='round' and e.game is distinct from 'system'
 and coalesce(e.meta->>'source','') not in ('balance_reconciliation','balance_reconciliation_redistributed','profit_shift_to_crash')
)
select r.finished_at ts,r.game_slug game,r.user_id::text player,r.bet_total::numeric wagered,r.payout::numeric paid,'modern'::text source
from public.casino_rounds r where r.status='finished' and r.finished_at is not null and r.finished_at<=now()
union all
select e.created_at,coalesce(nullif(e.game,''),'unknown'),
 coalesce(p.id::text,'legacy:'||lower(trim(e.code))),null::numeric,null::numeric,'legacy'
from legacy_ranked e
left join legacy_20260925.participants lp on lower(trim(lp.code))=lower(trim(e.code))
left join public.profiles p on p.legacy_participant_id=lp.id
where e.rn=1 and e.meta->>'status'='finished' and e.created_at < '2026-09-25T00:00:00Z'::timestamptz;
revoke all on private.tv_analytics_rounds from public,anon,authenticated;

create or replace function private.tv_metrics(n bigint,players bigint,w numeric,p numeric,legacy bigint)
returns jsonb language sql immutable set search_path='' as $$
select jsonb_build_object('rounds',n,'active_players',players,
 'wagered',case when legacy=0 then coalesce(w,0) end,'paid',case when legacy=0 then coalesce(p,0) end,
 'player_net',case when legacy=0 then coalesce(p,0)-coalesce(w,0) end,
 'house_net',case when legacy=0 then coalesce(w,0)-coalesce(p,0) end,
 'financial_complete',legacy=0,'legacy_rounds',legacy);
$$;
revoke all on function private.tv_metrics(bigint,bigint,numeric,numeric,bigint) from public,anon,authenticated;

create or replace function public.tv_stats_snapshot_v2() returns jsonb
language sql stable security definer set search_path='' as $$
with anchor as (select now() t,now() at time zone 'Asia/Nicosia' local_now),
bounds as (
 select 'today' name,date_trunc('day',local_now) at time zone 'Asia/Nicosia' lo,t hi from anchor
 union all select 'last_24h',t-interval '24 hours',t from anchor
 union all select 'week',date_trunc('week',local_now) at time zone 'Asia/Nicosia',t from anchor
 union all select 'month',date_trunc('month',local_now) at time zone 'Asia/Nicosia',t from anchor
 union all select 'all_time','-infinity'::timestamptz,t from anchor
), r as materialized (select * from private.tv_analytics_rounds),
periods as (select b.name,private.tv_metrics(count(r.ts),count(distinct r.player),sum(r.wagered),sum(r.paid),count(*) filter(where r.source='legacy')) stats
 from bounds b left join r on r.ts>=b.lo and r.ts<=b.hi group by b.name),
g as (select b.name,r.game,private.tv_metrics(count(*),count(distinct player),sum(wagered),sum(paid),count(*) filter(where source='legacy')) stats
 from bounds b join r on r.ts>=b.lo and r.ts<=b.hi group by b.name,r.game),
games as (select name,jsonb_agg(jsonb_build_object('game',game)||stats order by (stats->>'rounds')::bigint desc,game) items from g group by name),
h as (select extract(hour from ts at time zone 'Asia/Nicosia')::int hkey,count(*) rounds,sum(wagered) wagered,sum(paid) paid
 from r,anchor where ts>=date_trunc('day',local_now) at time zone 'Asia/Nicosia' group by 1),
d as (select (ts at time zone 'Asia/Nicosia')::date as dkey,count(*) rounds,sum(wagered) wagered,sum(paid) paid
 from r,anchor where ts>=((local_now::date-13)::timestamp at time zone 'Asia/Nicosia') group by 1)
select jsonb_build_object('version',2,'data_version','tv-analytics-2.0','generated_at',now(),'timezone','Asia/Nicosia','personal_data',false,
 'today',(select stats from periods where name='today'),'last_24h',(select stats from periods where name='last_24h'),
 'week',(select stats from periods where name='week'),'month',(select stats from periods where name='month'),'all_time',(select stats from periods where name='all_time'),
 'hourly',(select jsonb_agg(jsonb_build_object('hour',x,'rounds',coalesce(h.rounds,0),'wagered',coalesce(h.wagered,0),'paid',coalesce(h.paid,0),'player_net',coalesce(h.paid,0)-coalesce(h.wagered,0)) order by x) from generate_series(0,23) x left join h on h.hkey=x),
 'daily',(select jsonb_agg(jsonb_build_object('day',v.dkey,'rounds',coalesce(d.rounds,0),'wagered',coalesce(d.wagered,0),'paid',coalesce(d.paid,0),'player_net',coalesce(d.paid,0)-coalesce(d.wagered,0)) order by v.dkey) from (select local_now::date-x as dkey from anchor,generate_series(0,13) x) v left join d on d.dkey=v.dkey),
 'games',(select jsonb_object_agg(b.name,coalesce(games.items,'[]'::jsonb)) from bounds b left join games on games.name=b.name),
 'participants',null,
 'editorial_events',(select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'count',n,'latest_at',latest)),'[]'::jsonb) from
 (select kind,count(*) n,max(occurred_at) latest from public.tv_events,anchor
 where occurred_at>=date_trunc('day',local_now) at time zone 'Asia/Nicosia' and occurred_at<=t
 and kind in ('round_completed','activity_digest') and status<>'dead' group by kind) e),
 'limitations',jsonb_build_array('Исторические суммы до 25.09.2026 не подтверждены: показаны только раунды и активность.','Периоды рассчитаны по времени завершения раунда.'));
$$;
revoke all on function public.tv_stats_snapshot_v2() from public,anon,authenticated;
grant execute on function public.tv_stats_snapshot_v2() to service_role;

create or replace function public.tv_stats_participants_v2(p_viewer uuid) returns jsonb
language sql stable security definer set search_path='' as $$
with allowed as (select 1 from public.tv_office_viewers v join public.profiles p on p.id=v.user_id where v.user_id=p_viewer and v.enabled and p.status='active'),
bounds as (select 'today' name,date_trunc('day',now() at time zone 'Asia/Nicosia') at time zone 'Asia/Nicosia' lo
 union all select 'last_24h',now()-interval '24 hours'),
s as (select b.name,p.id,p.display_name,p.avatar,count(*) rounds,sum(r.bet_total) wagered,sum(r.payout) paid
 from bounds b join public.casino_rounds r on r.finished_at>=b.lo and r.finished_at<=now() and r.status='finished'
 join public.profiles p on p.id=r.user_id and p.status='active'
 join public.tv_participant_consent c on c.user_id=p.id and c.enabled
 where exists(select 1 from allowed) group by b.name,p.id,p.display_name,p.avatar),
a as (select name,jsonb_agg(jsonb_build_object('name',display_name,'avatar',avatar,'rounds',rounds,'wagered',wagered,'paid',paid,'player_net',paid-wagered,'house_net',wagered-paid) order by rounds desc,display_name,id) items from s group by name)
select case when exists(select 1 from allowed) then (select jsonb_object_agg(b.name,coalesce(a.items,'[]'::jsonb)) from bounds b left join a on a.name=b.name) else null end;
$$;
revoke all on function public.tv_stats_participants_v2(uuid) from public,anon,authenticated;
grant execute on function public.tv_stats_participants_v2(uuid) to service_role;
