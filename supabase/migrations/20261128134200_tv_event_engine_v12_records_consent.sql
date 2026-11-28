
create table public.tv_office_viewers(user_id uuid primary key references public.profiles(id), enabled boolean not null default true);
alter table public.tv_office_viewers enable row level security;
revoke all on public.tv_office_viewers from public,anon,authenticated;
grant select,insert,update,delete on public.tv_office_viewers to service_role;
insert into public.tv_office_viewers(user_id) select id from public.profiles where status::text='active' and role::text in ('admin','owner','staff');
create table public.tv_participant_consent(user_id uuid primary key references public.profiles(id), enabled boolean not null default true, updated_at timestamptz not null default now());
alter table public.tv_participant_consent enable row level security;
revoke all on public.tv_participant_consent from public,anon,authenticated;
grant select,insert,update on public.tv_participant_consent to service_role;
insert into public.tv_participant_consent(user_id) select id from public.profiles where status::text='active';
create function public.tv_collect_records() returns integer language plpgsql security invoker set search_path='' as $$
declare n integer; cutoff timestamptz;
begin
 if not pg_try_advisory_xact_lock(748320261130::bigint) then return 0; end if;
 select collect_since into strict cutoff from public.tv_event_config where singleton;
 insert into public.tv_events(event_key,kind,source_type,source_id,occurred_at,priority,payload)
 select 'record:'||r.id,'personal_record','casino_rounds',r.id::text,r.finished_at,60,jsonb_build_object('game',r.game_slug,'visibility','restricted','fact_type','personal_record')
 from public.casino_rounds r where r.status::text='finished' and r.finished_at between cutoff and now() and r.payout>r.bet_total
 and exists(select 1 from public.casino_rounds x where x.user_id=r.user_id and x.game_slug=r.game_slug and x.status::text='finished' and (x.finished_at,x.id)<(r.finished_at,r.id))
 and not exists(select 1 from public.casino_rounds x where x.user_id=r.user_id and x.game_slug=r.game_slug and x.status::text='finished' and (x.finished_at,x.id)<(r.finished_at,r.id) and x.payout::numeric-x.bet_total::numeric>=r.payout::numeric-r.bet_total::numeric)
 on conflict(event_key) do nothing;
 get diagnostics n=row_count;return n;
end $$;
revoke all on function public.tv_collect_records() from public,anon,authenticated;
grant execute on function public.tv_collect_records() to service_role;
select cron.schedule('luzbet-tv-record-collector','*/5 * * * *','select public.tv_collect_records();');
