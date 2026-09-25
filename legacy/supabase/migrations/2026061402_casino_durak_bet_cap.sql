alter table public.casino_durak_games
  drop constraint if exists casino_durak_games_bet_check;

alter table public.casino_durak_games
  add constraint casino_durak_games_bet_check
  check (bet > 0 and bet <= 3000);
