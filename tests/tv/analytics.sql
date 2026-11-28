-- Read-only production verification. Must run as project owner/service role.
with s as (select public.tv_stats_snapshot_v2() d), modern as (
 select count(*) rounds,sum(bet_total) wagered,sum(payout) paid from public.casino_rounds where status='finished' and finished_at is not null
), ledger as (
 select r.id,r.bet_total,r.payout,-sum(t.amount) filter(where t.type='bet') w,
 coalesce(sum(t.amount) filter(where t.type='payout'),0) p
 from public.casino_rounds r left join public.wallet_transactions t on t.round_id=r.id
 where r.status='finished' group by r.id
)
select
 (select count(*) from ledger where bet_total is distinct from w or payout is distinct from p)=0 ledger_reconciled,
 (d->'all_time'->>'rounds')::bigint=(public.tv_stats_snapshot()->'periods'->'all'->>'rounds')::bigint v1_rounds_preserved,
 (select sum((h->>'rounds')::bigint) from jsonb_array_elements(d->'hourly') h)=(d->'today'->>'rounds')::bigint hourly_reconciled,
 (select sum((g->>'rounds')::bigint) from jsonb_array_elements(d->'games'->'all_time') g)=(d->'all_time'->>'rounds')::bigint games_reconciled,
 jsonb_array_length(d->'daily')=14 and jsonb_array_length(d->'hourly')=24 buckets_complete,
 d->'participants'='null'::jsonb and d->'personal_data'='false'::jsonb public_anonymous,
 not has_function_privilege('anon','public.tv_stats_participants_v2(uuid)','EXECUTE') participants_not_public,
 public.tv_stats_participants_v2('00000000-0000-0000-0000-000000000000') is null unauthorized_denied,
 (d->'today'->>'house_net')::numeric=-(d->'today'->>'player_net')::numeric balanced_net,
 extract(epoch from ('2026-03-30 00:00'::timestamp at time zone 'Asia/Nicosia')-('2026-03-29 00:00'::timestamp at time zone 'Asia/Nicosia'))=23*3600 dst_spring,
 extract(epoch from ('2026-10-26 00:00'::timestamp at time zone 'Asia/Nicosia')-('2026-10-25 00:00'::timestamp at time zone 'Asia/Nicosia'))=25*3600 dst_autumn,
 date_trunc('week','2026-11-29 23:59'::timestamp)='2026-11-23'::timestamp monday_week,
 date_trunc('month','2026-12-01 00:00'::timestamp)='2026-12-01'::timestamp month_boundary
from s;
