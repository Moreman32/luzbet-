-- Keep legacy mechanics separate from the modern rules catalog.
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
select e.created_at,'legacy:'||coalesce(nullif(e.game,''),'unknown'),
 coalesce(p.id::text,'legacy:'||lower(trim(e.code))),null::numeric,null::numeric,'legacy'
from legacy_ranked e
left join legacy_20260925.participants lp on lower(trim(lp.code))=lower(trim(e.code))
left join public.profiles p on p.legacy_participant_id=lp.id
where e.rn=1 and e.meta->>'status'='finished' and e.created_at < '2026-09-25T00:00:00Z'::timestamptz;
