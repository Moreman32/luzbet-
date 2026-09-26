-- =====================================================================
-- LuzBet 2.2 — «Линия»: real pari-mutuel (tote) betting on events.
--   * auto events: 12-hour periods (Europe/Nicosia 00:00–12:00, 12:00–24:00), settled from site-wide round
--     statistics. Only ~50/50 per-round questions are used, so extra volume cannot push the answer either way.
--     Betting closes when the measured period STARTS — nobody bets with knowledge of the result.
--   * manual events: created and settled by staff from the back office; every action is audited and public.
--   * tote: commission (default 5%) is taken only from LOSING stakes; a winner never gets back less than the stake.
--     No bets on the winner, only one side bet, too few samples or a tie → everything is refunded.
-- Money moves only through private.post_tx (types bet / payout / refund, round_id null, metadata.kind = 'line').
-- =====================================================================

create table if not exists public.line_events (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('auto', 'manual')),
  code         text,
  period_start timestamptz,
  period_end   timestamptz,
  title        text not null check (char_length(title) between 3 and 140),
  description  text check (description is null or char_length(description) <= 600),
  options      jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 8),
  closes_at    timestamptz not null,
  status       text not null default 'open' check (status in ('open', 'settled', 'void')),
  result       smallint,
  result_note  text,
  stats        jsonb,
  created_by   uuid references public.profiles(id) on delete restrict,
  settled_by   uuid references public.profiles(id) on delete restrict,
  created_at   timestamptz not null default now(),
  settled_at   timestamptz,
  constraint line_events_auto_unique unique (code, period_start),
  constraint line_events_auto_shape check (kind = 'manual' or (code is not null and period_start is not null and period_end > period_start))
);
create index if not exists line_events_status_idx on public.line_events(status, closes_at);

create table if not exists public.line_bets (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.line_events(id) on delete restrict,
  user_id         uuid not null references public.profiles(id) on delete restrict,
  option          smallint not null check (option between 0 and 7),
  amount          bigint not null check (amount > 0),
  status          text not null default 'open' check (status in ('open', 'won', 'lost', 'refunded')),
  payout          bigint not null default 0 check (payout >= 0),
  idempotency_key text not null,
  created_at      timestamptz not null default now(),
  settled_at      timestamptz,
  constraint line_bets_idem unique (user_id, idempotency_key)
);
create index if not exists line_bets_event_idx on public.line_bets(event_id);
create index if not exists line_bets_user_idx on public.line_bets(user_id, created_at desc);

alter table public.line_events enable row level security;
alter table public.line_bets enable row level security;
drop policy if exists line_events_read on public.line_events;
create policy line_events_read on public.line_events for select to authenticated using (true);
drop policy if exists line_bets_self on public.line_bets;
create policy line_bets_self on public.line_bets for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.line_events, public.line_bets from anon, authenticated;
grant select on public.line_events, public.line_bets to authenticated;

insert into public.system_settings(key, value) values
  ('line_commission', '0.05'), ('line_min_bet', '1'), ('line_max_bet', '5000'), ('line_max_per_event', '10000'),
  ('line_min_samples', '5')
on conflict (key) do nothing;

-- ---------- catalogue of automatic markets ----------------------------------------------------
create or replace function private.line_auto_catalog() returns jsonb language sql immutable set search_path = '' as $$
  select '[
    {"code":"roulette_color","title":"Цветовая революция на рулетке",
     "description":"Каких чисел за период выпадет больше у всех игроков вместе: красных или чёрных? Зеро не считается. Каждый спин — почти монетка, так что «накрутить» результат объёмом нельзя. Ничья — возврат.",
     "options":["Красных больше","Чёрных больше"]},
    {"code":"dice_half","title":"Комитет по случайным числам: верх или низ",
     "description":"Каких бросков Dice за период будет больше: от 50,00 и выше или ниже 50,00? Шанс и направление ставки игрока на число не влияют. Ничья — возврат.",
     "options":["Выше 50 чаще","Ниже 50 чаще"]},
    {"code":"crash_x2","title":"Биржа ЛК: переживёт ли курс ×2",
     "description":"Сколько раундов Crash за период улетит до ×2 и дальше, а сколько рухнет раньше? Точка краха не зависит от того, когда игрок нажал «Забрать». Ничья — возврат.",
     "options":["Чаще за ×2","Чаще раньше ×2"]},
    {"code":"plinko_side","title":"Кредитная воронка: куда катится шарик",
     "description":"Куда за период чаще упадёт шарик Plinko: в левую половину или в правую? Центральная лунка не считается. Ничья — возврат.",
     "options":["Левее центра","Правее центра"]},
    {"code":"hilo_first","title":"Карточный департамент: масть дня",
     "description":"Какой чаще будет ПЕРВАЯ карта в играх «Больше / Меньше» за период: красной (♥♦) или чёрной (♠♣)? Карту игрок не выбирает. Ничья — возврат.",
     "options":["Красная чаще","Чёрная чаще"]}
  ]'::jsonb
$$;

-- 12-hour periods in Europe/Nicosia
create or replace function private.line_period_start(p_ts timestamptz) returns timestamptz language sql stable set search_path = '' as $$
  select (date_trunc('day', p_ts at time zone 'Europe/Nicosia')
          + case when extract(hour from p_ts at time zone 'Europe/Nicosia') >= 12 then interval '12 hours' else interval '0' end)
         at time zone 'Europe/Nicosia'
$$;

-- counts for an automatic market over a window: returns {"a":n,"b":n}
create or replace function private.line_auto_counts(p_code text, p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  with r as (select game_slug, state from public.casino_rounds
              where status = 'finished' and created_at >= p_from and created_at < p_to)
  select case p_code
    when 'roulette_color' then (select jsonb_build_object(
        'a', count(*) filter (where (state ->> 'number')::int in (1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36)),
        'b', count(*) filter (where (state ->> 'number')::int between 1 and 36
                               and (state ->> 'number')::int not in (1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36)))
        from r where game_slug = 'roulette' and state ? 'number')
    when 'dice_half' then (select jsonb_build_object(
        'a', count(*) filter (where (state ->> 'roll')::int >= 5000), 'b', count(*) filter (where (state ->> 'roll')::int < 5000))
        from r where game_slug = 'dice' and state ? 'roll')
    when 'crash_x2' then (select jsonb_build_object(
        'a', count(*) filter (where (state ->> 'crash')::numeric >= 2), 'b', count(*) filter (where (state ->> 'crash')::numeric < 2))
        from r where game_slug = 'crash' and state ? 'crash')
    when 'plinko_side' then (select jsonb_build_object(
        'a', count(*) filter (where (state ->> 'bucket')::int < 6), 'b', count(*) filter (where (state ->> 'bucket')::int > 6))
        from r where game_slug = 'plinko' and state ? 'bucket')
    when 'hilo_first' then (select jsonb_build_object(
        'a', count(*) filter (where state -> 'history' -> 0 ->> 'suit' in ('H','D')),
        'b', count(*) filter (where state -> 'history' -> 0 ->> 'suit' in ('S','C')))
        from r where game_slug = 'higher_lower' and jsonb_array_length(coalesce(state -> 'history', '[]'::jsonb)) > 0)
  end
$$;

-- ---------- settlement (tote) ----------------------------------------------------------------
create or replace function private.line_settle(p_event uuid, p_result smallint, p_note text, p_stats jsonb, p_actor uuid)
returns public.line_events language plpgsql security definer set search_path = '' as $$
declare e public.line_events; b record; w bigint; l bigint; net bigint; comm numeric; sides int; pay bigint; void boolean;
begin
  select * into e from public.line_events where id = p_event for update;
  if not found or e.status <> 'open' then return e; end if;
  comm := (private.setting('line_commission', '0.05'::jsonb))::numeric;
  select count(distinct option) into sides from public.line_bets where event_id = e.id;
  select coalesce(sum(amount) filter (where option = p_result), 0), coalesce(sum(amount) filter (where option <> p_result), 0)
    into w, l from public.line_bets where event_id = e.id;
  void := p_result is null or sides < 2 or w = 0;
  if void then
    for b in select * from public.line_bets where event_id = e.id and status = 'open' order by user_id, id loop
      perform private.post_tx(b.user_id, b.amount, 'refund', 'line-refund:' || b.id, null,
                              jsonb_build_object('kind', 'line', 'event', e.id, 'bet', b.id));
      update public.line_bets set status = 'refunded', payout = b.amount, settled_at = now() where id = b.id;
    end loop;
    update public.line_events set status = 'void', result = p_result, stats = p_stats, settled_by = p_actor, settled_at = now(),
      result_note = coalesce(p_note, case when p_result is null then 'Событие отменено' when sides < 2 then 'Ставки только на один исход — возврат'
                                          else 'На победивший исход никто не ставил — возврат' end)
     where id = e.id returning * into e;
    return e;
  end if;
  net := l - floor(l * comm)::bigint;                       -- commission only from losing stakes
  for b in select * from public.line_bets where event_id = e.id and status = 'open' order by user_id, id loop
    if b.option = p_result then
      pay := b.amount + div(net * b.amount, w)::bigint;
      perform private.post_tx(b.user_id, pay, 'payout', 'line-pay:' || b.id, null,
                              jsonb_build_object('kind', 'line', 'event', e.id, 'bet', b.id));
      update public.line_bets set status = 'won', payout = pay, settled_at = now() where id = b.id;
    else
      update public.line_bets set status = 'lost', payout = 0, settled_at = now() where id = b.id;
    end if;
  end loop;
  update public.line_events set status = 'settled', result = p_result, result_note = p_note, stats = p_stats,
    settled_by = p_actor, settled_at = now() where id = e.id returning * into e;
  return e;
end $$;

-- Creates upcoming automatic events and settles finished ones. Idempotent; safe to call from anywhere.
create or replace function private.line_tick() returns void language plpgsql security definer set search_path = '' as $$
declare cur timestamptz; ps timestamptz; m jsonb; e public.line_events; c jsonb; a bigint; bb bigint; minn int; k int;
begin
  if not pg_try_advisory_xact_lock(hashtext('luzbet-line-tick')) then return; end if;
  cur := private.line_period_start(now());
  for k in 1..2 loop                                   -- the next two periods are open for betting
    ps := private.line_period_start(cur + make_interval(hours => 12 * k) + interval '1 minute');
    for m in select * from jsonb_array_elements(private.line_auto_catalog()) loop
      insert into public.line_events(kind, code, period_start, period_end, title, description, options, closes_at)
      values ('auto', m ->> 'code', ps, private.line_period_start(ps + interval '12 hours 1 minute'), m ->> 'title', m ->> 'description',
              m -> 'options', ps)
      on conflict (code, period_start) do nothing;
    end loop;
  end loop;
  minn := (private.setting('line_min_samples', '5'::jsonb))::int;
  for e in select * from public.line_events where kind = 'auto' and status = 'open' and period_end + interval '10 minutes' <= now()
           order by period_end limit 50 loop
    c := private.line_auto_counts(e.code, e.period_start, e.period_end);
    a := coalesce((c ->> 'a')::bigint, 0); bb := coalesce((c ->> 'b')::bigint, 0);
    if a + bb < minn then
      perform private.line_settle(e.id, null, format('Мало данных: %s раундов при минимуме %s — возврат', a + bb, minn), c, null);
    elsif a = bb then
      perform private.line_settle(e.id, null, format('Ничья %s : %s — возврат', a, bb), c, null);
    else
      perform private.line_settle(e.id, case when a > bb then 0 else 1 end::smallint, format('Итог %s : %s', a, bb), c, null);
    end if;
  end loop;
end $$;

-- ---------- player API ----------------------------------------------------------------------
create or replace function private.line_event_json(e public.line_events, p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with pools as (select option, sum(amount) amt, count(distinct user_id) people from public.line_bets where event_id = e.id group by option),
       tot as (select coalesce(sum(amt), 0) total from pools),
       mine as (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'option', option, 'amount', amount, 'status', status, 'payout', payout,
                                                             'createdAt', created_at) order by created_at), '[]'::jsonb) bets
                  from public.line_bets where event_id = e.id and user_id = p_user)
  select jsonb_build_object(
    'id', e.id, 'kind', e.kind, 'code', e.code, 'title', e.title, 'description', e.description,
    'periodStart', e.period_start, 'periodEnd', e.period_end, 'closesAt', e.closes_at,
    'open', e.status = 'open' and now() < e.closes_at, 'status', e.status, 'result', e.result, 'resultNote', e.result_note,
    'stats', e.stats, 'settledAt', e.settled_at,
    'createdBy', (select display_name from public.profiles where id = e.created_by),
    'settledBy', (select display_name from public.profiles where id = e.settled_by),
    'isCreator', e.created_by = p_user,
    'commission', (private.setting('line_commission', '0.05'::jsonb))::numeric,
    'total', (select total from tot),
    'options', (select jsonb_agg(jsonb_build_object('idx', o.i - 1, 'label', o.v #>> '{}',
                      'pool', coalesce(p.amt, 0), 'people', coalesce(p.people, 0)) order by o.i)
                  from jsonb_array_elements(e.options) with ordinality o(v, i) left join pools p on p.option = o.i - 1),
    'mine', (select bets from mine))
$$;

create or replace function public.rpc_line_list(p_scope text default 'open') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; rows jsonb;
begin
  me := private.caller();
  perform private.line_tick();
  if p_scope = 'open' then
    select coalesce(jsonb_agg(private.line_event_json(e, me.id) order by e.closes_at, e.kind, e.code), '[]'::jsonb) into rows
      from public.line_events e where e.status = 'open' and e.closes_at > now();
  elsif p_scope = 'live' then            -- betting closed, waiting for the result
    select coalesce(jsonb_agg(private.line_event_json(e, me.id) order by coalesce(e.period_end, e.closes_at)), '[]'::jsonb) into rows
      from public.line_events e where e.status = 'open' and e.closes_at <= now();
  elsif p_scope = 'settled' then
    select coalesce(jsonb_agg(x.j order by x.t desc), '[]'::jsonb) into rows from (
      select private.line_event_json(e, me.id) j, e.settled_at t from public.line_events e
       where e.status in ('settled', 'void') order by e.settled_at desc limit 30) x;
  elsif p_scope = 'mine' then
    select coalesce(jsonb_agg(x.j order by x.t desc), '[]'::jsonb) into rows from (
      select private.line_event_json(e, me.id) j, max(b.created_at) t from public.line_events e join public.line_bets b on b.event_id = e.id
       where b.user_id = me.id group by e.id order by max(b.created_at) desc limit 40) x;
  else
    return private.err('invalid_action');
  end if;
  return jsonb_build_object('ok', true, 'serverNow', now(), 'events', rows,
    'limits', jsonb_build_object('min', private.setting('line_min_bet', '1'::jsonb), 'max', private.setting('line_max_bet', '5000'::jsonb),
                                 'perEvent', private.setting('line_max_per_event', '10000'::jsonb)));
end $$;

create or replace function public.rpc_line_bet(p_event uuid, p_option int, p_amount bigint, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; e public.line_events; b public.line_bets; mn bigint; mx bigint; per bigint; already bigint; tx public.wallet_transactions;
begin
  me := private.caller();
  if not private.valid_key(p_idempotency_key) then return private.err('invalid_idempotency_key'); end if;
  select * into b from public.line_bets where user_id = me.id and idempotency_key = p_idempotency_key;
  if found then
    if b.event_id <> p_event or b.option <> p_option or b.amount <> p_amount then return private.err('idempotency_conflict'); end if;
    select * into e from public.line_events where id = b.event_id;
    return jsonb_build_object('ok', true, 'replayed', true, 'event', private.line_event_json(e, me.id),
                              'balance', (select balance from public.wallets where user_id = me.id));
  end if;
  select * into e from public.line_events where id = p_event for share;
  if not found then return private.err('event_not_found'); end if;
  if e.status <> 'open' or now() >= e.closes_at then return private.err('betting_closed'); end if;
  if p_option is null or p_option < 0 or p_option >= jsonb_array_length(e.options) then return private.err('invalid_bet'); end if;
  if e.created_by = me.id then return private.err('creator_cannot_bet'); end if;
  mn := (private.setting('line_min_bet', '1'::jsonb))::bigint; mx := (private.setting('line_max_bet', '5000'::jsonb))::bigint;
  per := (private.setting('line_max_per_event', '10000'::jsonb))::bigint;
  if p_amount is null or p_amount < mn or p_amount > mx then return private.err('bet_limits', jsonb_build_object('min', mn, 'max', mx)); end if;
  perform 1 from public.wallets where user_id = me.id for update;
  select coalesce(sum(amount), 0) into already from public.line_bets where event_id = e.id and user_id = me.id;
  if already + p_amount > per then return private.err('bet_limits', jsonb_build_object('perEvent', per, 'already', already)); end if;
  if (select balance from public.wallets where user_id = me.id) < p_amount then return private.err('insufficient_funds'); end if;
  insert into public.line_bets(event_id, user_id, option, amount, idempotency_key)
  values (e.id, me.id, p_option, p_amount, p_idempotency_key) returning * into b;
  tx := private.post_tx(me.id, -p_amount, 'bet', 'line-bet:' || b.id, null, jsonb_build_object('kind', 'line', 'event', e.id, 'bet', b.id));
  return jsonb_build_object('ok', true, 'replayed', false, 'event', private.line_event_json(e, me.id), 'balance', tx.balance_after);
end $$;

-- ---------- staff API (manual events) -------------------------------------------------------
create or replace function public.rpc_admin_line_create(p_title text, p_description text, p_options jsonb, p_closes_at timestamptz, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.profiles; e public.line_events; o jsonb;
begin
  actor := private.require_staff('admin');
  if p_reason is null or char_length(btrim(p_reason)) < 3 then return private.err('reason_required'); end if;
  if p_title is null or char_length(btrim(p_title)) not between 3 and 140 then return private.err('invalid_title'); end if;
  if p_description is not null and char_length(p_description) > 600 then return private.err('invalid_title'); end if;
  if jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) not between 2 and 8 then return private.err('invalid_options'); end if;
  for o in select * from jsonb_array_elements(p_options) loop
    if jsonb_typeof(o) <> 'string' or char_length(btrim(o #>> '{}')) not between 1 and 60 then return private.err('invalid_options'); end if;
  end loop;
  if p_closes_at is null or p_closes_at < now() + interval '5 minutes' or p_closes_at > now() + interval '60 days' then
    return private.err('invalid_close_time');
  end if;
  insert into public.line_events(kind, title, description, options, closes_at, created_by)
  values ('manual', btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
          (select jsonb_agg(to_jsonb(btrim(x #>> '{}'))) from jsonb_array_elements(p_options) x), p_closes_at, actor.id)
  returning * into e;
  insert into public.admin_audit_log(actor_id, action, entity, entity_id, after, reason)
  values (actor.id, 'line_create', 'line_event', e.id::text, to_jsonb(e), btrim(p_reason));
  return jsonb_build_object('ok', true, 'event', private.line_event_json(e, actor.id));
end $$;

create or replace function public.rpc_admin_line_settle(p_event uuid, p_result int, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor public.profiles; e public.line_events; before jsonb;
begin
  actor := private.require_staff('admin');
  if p_note is null or char_length(btrim(p_note)) < 3 then return private.err('reason_required'); end if;
  select * into e from public.line_events where id = p_event;
  if not found or e.kind <> 'manual' then return private.err('event_not_found'); end if;
  if e.status <> 'open' then return private.err('round_finished'); end if;
  if e.created_by <> actor.id and actor.role <> 'owner' then return private.err('forbidden'); end if;
  if p_result is not null and (p_result < 0 or p_result >= jsonb_array_length(e.options)) then return private.err('invalid_options'); end if;
  if p_result is not null and now() < e.closes_at then return private.err('betting_still_open'); end if;
  before := to_jsonb(e);
  e := private.line_settle(e.id, p_result::smallint, btrim(p_note), null, actor.id);
  insert into public.admin_audit_log(actor_id, action, entity, entity_id, before, after, reason)
  values (actor.id, case when p_result is null then 'line_void' else 'line_settle' end, 'line_event', e.id::text, before, to_jsonb(e), btrim(p_note));
  return jsonb_build_object('ok', true, 'event', private.line_event_json(e, actor.id));
end $$;

create or replace function public.rpc_admin_line_list() returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.profiles;
begin
  actor := private.require_staff('admin');
  return jsonb_build_object('ok', true, 'events', coalesce((select jsonb_agg(private.line_event_json(e, actor.id) order by e.created_at desc)
    from (select * from public.line_events where kind = 'manual' order by created_at desc limit 50) e), '[]'::jsonb));
end $$;

-- ---------- scheduler + grants ----------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where command ilike '%private.line_tick%') then
      perform cron.unschedule(jobid) from cron.job where command ilike '%private.line_tick%';
    end if;
    perform cron.schedule('luzbet-line-tick', '*/5 * * * *', 'select private.line_tick();');
  end if;
end $$;

revoke all on all functions in schema private from public, anon, authenticated, service_role;
revoke all on function public.rpc_line_list(text), public.rpc_line_bet(uuid, int, bigint, text),
  public.rpc_admin_line_create(text, text, jsonb, timestamptz, text), public.rpc_admin_line_settle(uuid, int, text), public.rpc_admin_line_list()
  from public, anon, service_role;
grant execute on function public.rpc_line_list(text), public.rpc_line_bet(uuid, int, bigint, text),
  public.rpc_admin_line_create(text, text, jsonb, timestamptz, text), public.rpc_admin_line_settle(uuid, int, text), public.rpc_admin_line_list()
  to authenticated;
select private.line_tick();
notify pgrst, 'reload schema';
