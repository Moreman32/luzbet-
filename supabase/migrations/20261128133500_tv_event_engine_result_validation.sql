
create or replace function public.tv_collect_events() returns integer language plpgsql security invoker set search_path='' as $$
declare n integer; extra integer; cutoff timestamptz;
begin
 if not pg_try_advisory_xact_lock(748320261128::bigint) then return 0; end if;
 select collect_since into strict cutoff from public.tv_event_config where singleton;
 insert into public.tv_events(event_key,kind,source_type,source_id,occurred_at,priority,payload)
 select 'round:'||r.id,'round_completed','casino_rounds',r.id::text,r.finished_at,10,jsonb_build_object('game',r.game_slug,'visibility','internal','fact_type','completed_round')
 from public.casino_rounds r where r.status::text='finished' and r.finished_at between cutoff and now()
 union all
 select 'zero:'||w.id,'balance_zero','wallet_transactions',w.id::text,w.created_at,20,jsonb_build_object('visibility','restricted','fact_type','balance_zero')
 from public.wallet_transactions w join public.casino_rounds r on r.id=w.round_id and r.status::text='finished' and r.payout=0
 where w.created_at between cutoff and now() and w.balance_before>0 and w.balance_after=0 and w.type::text='bet'
 union all
 select 'advent:'||a.user_id||':'||a.day,'advent_opened','advent_2026_openings',a.user_id||':'||a.day,a.opened_at,40,jsonb_build_object('day',a.day,'visibility','internal','fact_type','advent_opened')
 from public.advent_2026_openings a where a.opened_at between cutoff and now()
 union all
 select 'line:'||l.id,'line_settled','line_events',l.id::text,l.settled_at,40,jsonb_build_object('kind',l.kind,'visibility','internal','fact_type','line_settled')
 from public.line_events l where l.settled_at between cutoff and now() and l.status='settled' and l.result is not null
 on conflict(event_key) do nothing;
 get diagnostics n=row_count;
 insert into public.tv_events(event_key,kind,source_type,source_id,occurred_at,priority,payload)
 select 'large:'||r.id,'large_result','casino_rounds',r.id::text,r.finished_at,50,
 jsonb_build_object('game',r.game_slug,'visibility','restricted','fact_type','large_virtual_result')
 from public.casino_rounds r where r.status::text='finished' and r.finished_at between cutoff and now() and r.bet_total>0 and r.payout::numeric-r.bet_total::numeric>=1000 and r.payout::numeric>=5*r.bet_total::numeric
 on conflict(event_key) do nothing;
 get diagnostics extra=row_count;
 return n+extra;
end $$;
update public.tv_events e set status='dead',completed_at=now(),last_error='Initial detection did not confirm a completed zero-payout round'
where e.kind='balance_zero' and e.status='pending' and not exists(select 1 from public.wallet_transactions w join public.casino_rounds r on r.id=w.round_id and r.status::text='finished' and r.payout=0 where w.id::text=e.source_id);
