alter table public.casino_rounds
  drop constraint if exists casino_rounds_bet_check;

alter table public.casino_rounds
  add constraint casino_rounds_bet_check
  check (bet > 0 and bet <= 7500);
