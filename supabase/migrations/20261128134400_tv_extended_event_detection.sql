
create table public.tv_rank_snapshot (
 user_id uuid primary key references public.profiles(id),
 balance_rank integer not null, profit_rank integer not null, observed_at timestamptz not null default now()
);
create table public.tv_achievement_marks (
 user_id uuid not null references public.profiles(id), achievement text not null,
 achieved_at timestamptz not null, primary key(user_id,achievement)
);
alter table public.tv_rank_snapshot enable row level security;
alter table public.tv_achievement_marks enable row level security;
revoke all on public.tv_rank_snapshot,public.tv_achievement_marks from public,anon,authenticated;
grant select,insert,update,delete on public.tv_rank_snapshot to service_role;
grant select,insert on public.tv_achievement_marks to service_role;
create function public.tv_collect_extended() returns jsonb language plpgsql security invoker set search_path='' as $$
declare cutoff timestamptz; n_streak int; n_legacy int; n_marks int; n_rank int; observed timestamptz:=clock_timestamp();
begin
 if not pg_try_advisory_xact_lock(748320261131::bigint) then return jsonb_build_object('busy',true); end if;
 select collect_since into strict cutoff from public.tv_event_config where singleton;
 with outcomes as (
 select r.id,r.user_id,r.game_slug,r.finished_at,sign(r.payout::numeric-r.bet_total::numeric) outcome,
 row_number() over(partition by r.user_id order by r.finished_at,r.id) pos
 from public.casino_rounds r where r.status='finished' and r.finished_at is not null and r.finished_at<=now()
 ), runs as (
 select *,pos-row_number() over(partition by user_id,outcome order by pos) grp from outcomes
 ), streaks as (
 select *,row_number() over(partition by user_id,outcome,grp order by pos) len from runs
 )
 insert into public.tv_events(event_key,kind,source_type,source_id,occurred_at,priority,payload)
 select 'streak:'||id,'unusual_streak','casino_rounds',id::text,finished_at,35,
 jsonb_build_object('visibility','restricted','direction',case when outcome>0 then 'win' else 'loss' end,'length',len,'scope','modern_all_games')
 from streaks where outcome<>0 and len in (5,10,15,20) and finished_at>=cutoff
 on conflict(event_key) do nothing;
 get diagnostics n_streak=row_count;
 insert into public.tv_events(event_key,kind,source_type,source_id,occurred_at,priority,payload)
 select 'legacy_achievement:'||a.id,'achievement','legacy_achievement',a.id::text,a.unlocked_at,40,
 jsonb_build_object('visibility','restricted','achievement',a.achievement,'user_id',p.id,'origin','legacy')
 from legacy_20260925.achievements a
 join legacy_20260925.participants lp on lower(trim(lp.code))=lower(trim(a.code))
 join public.profiles p on p.legacy_participant_id=lp.id
 where a.unlocked_at between cutoff and now()
 on conflict(event_key) do nothing;
 get diagnostics n_legacy=row_count;
 with rounds as (
 select user_id,finished_at,id,row_number() over(partition by user_id order by finished_at,id) n
 from public.casino_rounds where status='finished' and finished_at is not null and finished_at<=now()
 ), marks as (
 insert into public.tv_achievement_marks(user_id,achievement,achieved_at)
 select user_id,'tv_rounds_'||n,finished_at from rounds where n in (1,10,50,100,250,500,1000)
 on conflict do nothing returning *
 )
 insert into public.tv_events(event_key,kind,source_type,source_id,occurred_at,priority,payload)
 select 'tv_achievement:'||user_id||':'||achievement,'tv_milestone','tv_achievement_marks',user_id||':'||achievement,achieved_at,25,
 jsonb_build_object('visibility','restricted','achievement',achievement,'user_id',user_id,'origin','tv_only')
 from marks where achieved_at>=cutoff on conflict(event_key) do nothing;
 get diagnostics n_marks=row_count;
 with rs as (
 select user_id,sum(bet_total)::numeric wagered,sum(payout::numeric-bet_total::numeric) net from public.casino_rounds where status='finished' group by user_id
 ), ranked as (
 select p.id user_id,row_number() over(order by w.balance desc,coalesce(rs.wagered,0) desc,p.created_at,p.id)::int balance_rank,
 row_number() over(order by coalesce(rs.net,0) desc,coalesce(rs.wagered,0) desc,p.created_at,p.id)::int profit_rank
 from public.profiles p join public.wallets w on w.user_id=p.id left join rs on rs.user_id=p.id where p.status='active'
 ), changed as (
 insert into public.tv_events(event_key,kind,source_type,source_id,occurred_at,priority,payload)
 select 'rank:'||r.user_id||':'||extract(epoch from observed)::text,'rank_changed','tv_rank_snapshot',r.user_id::text,observed,
 case when (r.balance_rank=1 and old.balance_rank<>1) or (r.profit_rank=1 and old.profit_rank<>1) then 55 else 20 end,
 jsonb_build_object('visibility','restricted','user_id',r.user_id,'old_balance_rank',old.balance_rank,'balance_rank',r.balance_rank,'old_profit_rank',old.profit_rank,'profit_rank',r.profit_rank,'scope','modern_all_time')
 from ranked r join public.tv_rank_snapshot old using(user_id)
 where (r.balance_rank<>old.balance_rank or r.profit_rank<>old.profit_rank)
 on conflict do nothing returning id
 ), saved as (
 insert into public.tv_rank_snapshot(user_id,balance_rank,profit_rank,observed_at)
 select user_id,balance_rank,profit_rank,observed from ranked on conflict(user_id) do update set balance_rank=excluded.balance_rank,profit_rank=excluded.profit_rank,observed_at=excluded.observed_at returning user_id
 )
 select count(*) into n_rank from changed;
 return jsonb_build_object('streaks',n_streak,'legacy_achievements',n_legacy,'tv_milestones',n_marks,'rank_changes',n_rank);
end $$;
revoke all on function public.tv_collect_extended() from public,anon,authenticated;
grant execute on function public.tv_collect_extended() to service_role;
select cron.schedule('luzbet-tv-extended-collector','*/5 * * * *','select public.tv_collect_extended();');
