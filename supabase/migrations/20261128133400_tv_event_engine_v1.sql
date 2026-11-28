
create table public.tv_events (
 id bigint generated always as identity primary key,
 event_key text not null unique,
 kind text not null,
 source_type text not null,
 source_id text not null,
 occurred_at timestamptz not null,
 priority smallint not null default 10 check(priority between 0 and 100),
 payload jsonb not null default '{}'::jsonb,
 status text not null default 'pending' check(status in ('pending','processing','retry','done','dead')),
 attempts integer not null default 0 check(attempts>=0),
 available_at timestamptz not null default now(),
 lease_until timestamptz,
 lease_token uuid,
 last_error text,
 created_at timestamptz not null default now(),
 completed_at timestamptz
);
alter table public.tv_events enable row level security;
revoke all on public.tv_events from public,anon,authenticated;
grant select,insert,update on public.tv_events to service_role;
grant usage,select on sequence public.tv_events_id_seq to service_role;
create index tv_events_ready_idx on public.tv_events(priority desc,available_at,id) where status in ('pending','retry','processing');
create table public.tv_event_config (
 singleton boolean primary key default true check(singleton),
 collect_since timestamptz not null default now(),
 editorial_start time not null default '09:00',
 editorial_end time not null default '18:00',
 max_attempts integer not null default 5 check(max_attempts between 1 and 20),
 check(editorial_start<editorial_end)
);
alter table public.tv_event_config enable row level security;
revoke all on public.tv_event_config from public,anon,authenticated;
grant select,update on public.tv_event_config to service_role;
insert into public.tv_event_config(singleton,collect_since) values(true,now()-interval '48 hours');
create function public.tv_collect_events() returns integer language plpgsql security invoker set search_path='' as $$
declare n integer; cutoff timestamptz;
begin
 if not pg_try_advisory_xact_lock(748320261128::bigint) then return 0; end if;
 select collect_since into strict cutoff from public.tv_event_config where singleton;
 insert into public.tv_events(event_key,kind,source_type,source_id,occurred_at,priority,payload)
 select 'round:'||r.id,'round_completed','casino_rounds',r.id::text,r.finished_at,10,
 jsonb_build_object('game',r.game_slug,'visibility','internal','fact_type','completed_round')
 from public.casino_rounds r where r.status::text='finished' and r.finished_at>=cutoff and r.finished_at<=now()
 union all
 select 'zero:'||w.id,'balance_zero','wallet_transactions',w.id::text,w.created_at,20,
 jsonb_build_object('visibility','restricted','fact_type','balance_zero')
 from public.wallet_transactions w where w.created_at>=cutoff and w.created_at<=now() and w.balance_before>0 and w.balance_after=0 and w.type::text='bet'
 union all
 select 'advent:'||a.user_id||':'||a.day,'advent_opened','advent_2026_openings',a.user_id||':'||a.day,a.opened_at,40,
 jsonb_build_object('day',a.day,'visibility','internal','fact_type','advent_opened')
 from public.advent_2026_openings a where a.opened_at>=cutoff and a.opened_at<=now()
 union all
 select 'line:'||l.id,'line_settled','line_events',l.id::text,l.settled_at,40,
 jsonb_build_object('kind',l.kind,'visibility','internal','fact_type','line_settled')
 from public.line_events l where l.settled_at>=cutoff and l.settled_at<=now() and l.status='settled' and l.result is not null
 on conflict(event_key) do nothing;
 get diagnostics n=row_count; return n;
end $$;
create function public.tv_claim_events(p_limit integer default 10) returns setof public.tv_events language plpgsql security invoker set search_path='' as $$
declare cfg public.tv_event_config%rowtype; local_time time;
begin
 select * into strict cfg from public.tv_event_config where singleton;
 local_time=(now() at time zone 'Asia/Nicosia')::time;
 if local_time<cfg.editorial_start or local_time>=cfg.editorial_end then return; end if;
 update public.tv_events set status='dead',lease_until=null,lease_token=null,completed_at=now(),last_error='attempt limit reached' where status='processing' and lease_until<=now() and attempts>=cfg.max_attempts;
 return query with candidates as (
 select e.id from public.tv_events e where e.attempts<cfg.max_attempts and ((e.status in ('pending','retry') and e.available_at<=now()) or (e.status='processing' and e.lease_until<=now()))
 order by e.priority desc,e.available_at,e.id limit greatest(1,least(coalesce(p_limit,10),50)) for update skip locked
 ) update public.tv_events e set status='processing',attempts=e.attempts+1,lease_until=now()+interval '5 minutes',lease_token=gen_random_uuid()
 from candidates c where e.id=c.id returning e.*;
end $$;
create function public.tv_finish_event(p_id bigint,p_token uuid,p_success boolean,p_error text default null) returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer; max_n integer;
begin
 select max_attempts into strict max_n from public.tv_event_config where singleton;
 update public.tv_events set status=case when p_success then 'done' when attempts>=max_n then 'dead' else 'retry' end,
 completed_at=case when p_success or attempts>=max_n then now() else null end,
 available_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7))::integer)),
 lease_until=null,lease_token=null,last_error=case when p_success then null else left(coalesce(p_error,'worker error'),500) end
 where id=p_id and status='processing' and lease_token=p_token and lease_until>now();
 get diagnostics n=row_count;return n=1;
end $$;
revoke all on function public.tv_collect_events(),public.tv_claim_events(integer),public.tv_finish_event(bigint,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.tv_collect_events(),public.tv_claim_events(integer),public.tv_finish_event(bigint,uuid,boolean,text) to service_role;
select cron.schedule('luzbet-tv-event-collector','* * * * *','select public.tv_collect_events();');
