alter table public.match_rewards
  drop constraint if exists match_rewards_result_type_check;

alter table public.match_rewards
  add constraint match_rewards_result_type_check
  check (result_type in ('exact', 'diff', 'outcome', 'miss'));
