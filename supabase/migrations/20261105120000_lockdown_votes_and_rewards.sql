-- Security lockdown: stop forged votes and rewards (approved by Captain, 2026-11-05).
--
-- Before this migration, anyone holding the public (anon) key could:
--   * insert votes without paying (species_votes)
--   * update any wallet row, including fyre_keys and vote_tickets (wallets)
--   * create a wallet row with any starting reward balances (wallets)
--   * insert task completions with any fyre_keys_awarded value (task_completions)
--   * call increment_fyre_keys / increment_vote_tickets / increment_referral_count /
--     increment_total_shares / update_dna_balance for any wallet and any amount
--
-- After it, reads (stats, leaderboards) and wallet sign-up keep working.
-- Voting, rewards, referrals, tasks and client-side DNA balance sync are paused
-- until a server-side function verifies wallet signatures and Base transactions.
--
-- Trigger functions (increment_species_votes, award_task_fyre_keys, ...) are not
-- touched: Postgres does not check EXECUTE privileges when a trigger fires, and
-- they run as their owner (postgres), which bypasses RLS.

begin;

-- 1. Reward and balance functions: no public execution.
revoke execute on function public.increment_fyre_keys(text, integer) from public, anon, authenticated;
revoke execute on function public.increment_vote_tickets(text, integer) from public, anon, authenticated;
revoke execute on function public.increment_referral_count(text, integer) from public, anon, authenticated;
revoke execute on function public.increment_total_shares(text, integer) from public, anon, authenticated;
revoke execute on function public.update_dna_balance(text, numeric) from public, anon, authenticated;

-- 2. Wallets: no public updates; new wallets must start with zero rewards.
drop policy if exists "Anyone can update wallets" on public.wallets;
drop policy if exists "System can update wallets via triggers" on public.wallets;
drop policy if exists "Users can insert their own wallet" on public.wallets;
create policy "Wallet sign-up with zero balances" on public.wallets
  for insert
  with check (
    coalesce(fyre_keys, 0) = 0
    and coalesce(vote_tickets, 0) = 0
    and coalesce(referral_count, 0) = 0
    and coalesce(total_votes, 0) = 0
    and coalesce(total_shares, 0) = 0
    and coalesce(total_dna_balance, 0) = 0
  );

-- 3. Votes and task completions: no direct inserts from the browser.
drop policy if exists "Allow all vote inserts" on public.species_votes;
drop policy if exists "Users can insert votes with wallet verification" on public.species_votes;
drop policy if exists "Anyone can insert votes" on public.species_votes;
drop policy if exists "Anyone can insert task completions" on public.task_completions;

commit;

-- Rollback (restores the previous, insecure behaviour; only with Captain's approval):
-- begin;
-- grant execute on function public.increment_fyre_keys(text, integer) to anon, authenticated;
-- grant execute on function public.increment_vote_tickets(text, integer) to anon, authenticated;
-- grant execute on function public.increment_referral_count(text, integer) to anon, authenticated;
-- grant execute on function public.increment_total_shares(text, integer) to anon, authenticated;
-- grant execute on function public.update_dna_balance(text, numeric) to anon, authenticated;
-- drop policy if exists "Wallet sign-up with zero balances" on public.wallets;
-- create policy "Users can insert their own wallet" on public.wallets for insert with check (true);
-- create policy "Anyone can update wallets" on public.wallets for update using (true);
-- create policy "Allow all vote inserts" on public.species_votes for insert with check (true);
-- create policy "Anyone can insert task completions" on public.task_completions for insert with check (true);
-- commit;
