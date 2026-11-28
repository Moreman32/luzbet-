
create table public.tv_editorial_items (
 id bigint generated always as identity primary key,
 group_key text not null unique,
 event_ids bigint[] not null,
 priority integer not null,
 occurred_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','processing','done','dead')),
 created_at timestamptz not null default now()
);
alter table public.tv_editorial_items enable row level security;
revoke all on public.tv_editorial_items from public,anon,authenticated;
grant select,insert,update on public.tv_editorial_items to service_role;
grant usage,select on sequence public.tv_editorial_items_id_seq to service_role;
create function public.tv_build_editorial_queue() returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if not pg_try_advisory_xact_lock(748320261132::bigint) then return 0; end if;
 with candidates as (
 select e.*,case when e.source_type='casino_rounds' and e.kind in ('personal_record','large_result','unusual_streak','round_completed') then 'round:'||e.source_id
 when e.kind='balance_zero' and w.round_id is not null then 'round:'||w.round_id
 else 'event:'||e.id end as g
 from public.tv_events e left join public.wallet_transactions w on e.source_type='wallet_transactions' and w.id::text=e.source_id
 where e.status='pending' and e.occurred_at<=now()-interval '6 minutes'
 ), grouped as (
 select g,array_agg(id order by priority desc,id) ids,max(priority) pr,max(occurred_at) ts
 from candidates group by g
 having bool_or(kind in ('activity_digest','personal_record','large_result','unusual_streak','balance_zero','achievement','tv_milestone','advent_opened','line_settled') or (kind='rank_changed' and priority>=55))
 )
 insert into public.tv_editorial_items(group_key,event_ids,priority,occurred_at)
 select g,ids,pr,ts from grouped
 on conflict(group_key) do update set event_ids=(select array_agg(distinct x order by x) from unnest(public.tv_editorial_items.event_ids||excluded.event_ids) x),priority=greatest(public.tv_editorial_items.priority,excluded.priority)
 where public.tv_editorial_items.status='pending' and not excluded.event_ids <@ public.tv_editorial_items.event_ids;
 get diagnostics n=row_count; return n;
end $$;
create function public.tv_editorial_context(p_item bigint) returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object('version',1,'item_id',i.id,'group_key',i.group_key,'priority',i.priority,'occurred_at',i.occurred_at,
 'facts',coalesce((select jsonb_agg(jsonb_build_object('kind',e.kind,'occurred_at',e.occurred_at,'facts',e.payload-'user_id','game',r.game_slug,
 'participant',case when c.enabled and p.status='active' and e.kind not in ('balance_zero','unusual_streak') then jsonb_build_object('display_name',p.display_name,'avatar',p.avatar) else null end)
 order by e.priority desc,e.id)
 from public.tv_events e
 left join public.wallet_transactions w on e.source_type='wallet_transactions' and w.id::text=e.source_id
 left join public.casino_rounds r on (e.source_type='casino_rounds' and r.id::text=e.source_id) or r.id=w.round_id
 left join public.profiles p on p.id=r.user_id or (e.payload->>'user_id'=p.id::text)
 left join public.tv_participant_consent c on c.user_id=p.id
 where e.id=any(i.event_ids)), '[]'::jsonb),
 'visibility','office_only','editorial_rule','No wagering prompts, no personal humiliation, distinguish satire from facts')
from public.tv_editorial_items i where i.id=p_item;
$$;
create function public.tv_collector_health() returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object('generated_at',now(),
 'collectors',(select coalesce(jsonb_agg(jsonb_build_object('name',j.jobname,'schedule',j.schedule,'active',j.active,'last_start',d.start_time,'last_end',d.end_time,'last_status',d.status,'last_error',case when d.status='failed' then left(d.return_message,300) end) order by j.jobname),'[]'::jsonb)
 from cron.job j left join lateral(select x.start_time,x.end_time,x.status,x.return_message from cron.job_run_details x where x.jobid=j.jobid order by x.runid desc limit 1) d on true where j.jobname like 'luzbet-tv-%'),
 'raw_queue',(select coalesce(jsonb_object_agg(status,n),'{}'::jsonb) from (select status,count(*) n from public.tv_events group by status) q),
 'editorial_queue',(select coalesce(jsonb_object_agg(status,n),'{}'::jsonb) from (select status,count(*) n from public.tv_editorial_items group by status) q),
 'oldest_pending',(select min(occurred_at) from public.tv_editorial_items where status='pending'));
$$;
revoke all on function public.tv_build_editorial_queue(),public.tv_editorial_context(bigint),public.tv_collector_health() from public,anon,authenticated;
grant execute on function public.tv_build_editorial_queue(),public.tv_editorial_context(bigint) to service_role;
select cron.schedule('luzbet-tv-editorial-queue','*/5 * * * *','select public.tv_build_editorial_queue();');
