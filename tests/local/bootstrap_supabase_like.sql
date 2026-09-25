-- Minimal Supabase-like environment for local testing of LuzBet 2.0 migrations.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password 'authenticator';
grant anon, authenticated, service_role to authenticator;
alter role authenticator set pgrst.db_pre_request = 'public.guard_pvp_rest_requests';

create schema extensions;
create extension pgcrypto with schema extensions;
create extension citext with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  instance_id uuid, id uuid primary key default gen_random_uuid(), aud varchar, role varchar, email varchar unique,
  encrypted_password varchar, email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(), banned_until timestamptz,
  confirmation_token varchar, recovery_token varchar, email_change_token_new varchar, email_change varchar,
  is_sso_user boolean not null default false, is_anonymous boolean not null default false);
create table auth.identities (id uuid primary key default gen_random_uuid(), provider_id text not null, user_id uuid not null,
  identity_data jsonb not null, provider text not null, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz,
  email text);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create schema cron;
create table cron.job (jobid bigserial primary key, schedule text, command text, active boolean default true);
create function cron.unschedule(bigint) returns boolean language sql as $$ delete from cron.job where jobid = $1; select true $$;
insert into cron.job(schedule, command) values ('*/5 * * * *', 'select public.refresh_rating_snapshots();');

-- Supabase default privileges in public (the dangerous defaults the migration must neutralise)
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema private;
-- Pre-existing v2 scaffolding stub so the migration's drop/guard path is exercised
create type public.wallet_transaction_type as enum ('opening');
create table public.profiles (id uuid primary key);
create table public.wallet_transactions (id uuid primary key);
