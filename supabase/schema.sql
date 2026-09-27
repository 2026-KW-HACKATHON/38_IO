-- Supabase 화면의 SQL Editor에 통째로 붙여넣고 Run 하면 됩니다.

-- 1) 계정 정보 표 (카카오 로그인하면 자동으로 한 줄씩 생김)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text,
  avatar_url text,
  provider_id text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2) 활동 기록 표 (계정이 지워지면 기록도 같이 지워짐)
create table if not exists public.activity_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event text not null check (char_length(event) <= 40),
  meta jsonb not null default '{}'::jsonb check (pg_column_size(meta) < 2000),
  created_at timestamptz not null default now()
);
create index if not exists activity_logs_user_idx on public.activity_logs (user_id, created_at desc);
create index if not exists activity_logs_time_idx on public.activity_logs (created_at desc);

-- 3) 관리자인지 확인하는 함수
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- 4) 새 계정이 만들어지면 profiles에 자동으로 추가
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nickname, avatar_url, provider_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nickname', new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'preferred_username', '카카오 사용자'),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'),
    coalesce(new.raw_user_meta_data->>'provider_id', new.raw_user_meta_data->>'sub')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 이미 만들어진 계정이 있으면 채워 넣기
insert into public.profiles (id, nickname)
select id, coalesce(raw_user_meta_data->>'nickname', raw_user_meta_data->>'name', '카카오 사용자') from auth.users
on conflict (id) do nothing;

-- 4-1) 로그인한 사람에게 표 사용 권한 주기 (Supabase의 "Automatically expose new tables"를 꺼도 동작하게 직접 지정)
grant usage on schema public to anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert on public.activity_logs to authenticated;

-- 5) 접근 규칙: 본인 것만 보고, 관리자는 전부 봄
alter table public.profiles enable row level security;
alter table public.activity_logs enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select
  using (id = auth.uid() or public.is_admin());

drop policy if exists "logs_select" on public.activity_logs;
create policy "logs_select" on public.activity_logs for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "logs_insert" on public.activity_logs;
create policy "logs_insert" on public.activity_logs for insert
  with check (user_id = auth.uid());

-- 6) 관리자 전용: 계정별 요약 보기
create or replace function public.admin_user_summary()
returns table (id uuid, nickname text, avatar_url text, provider_id text, is_admin boolean,
               created_at timestamptz, log_count bigint, last_active timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '관리자만 사용할 수 있어요'; end if;
  return query
    select p.id, p.nickname, p.avatar_url, p.provider_id, p.is_admin, p.created_at,
           count(l.id), max(l.created_at)
    from public.profiles p
    left join public.activity_logs l on l.user_id = p.id
    group by p.id
    order by max(l.created_at) desc nulls last, p.created_at desc;
end $$;

-- 7) 관리자 전용: 계정 삭제 (기록도 함께 삭제, 자기 자신은 못 지움)
create or replace function public.admin_delete_user(target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '관리자만 사용할 수 있어요'; end if;
  if target = auth.uid() then raise exception '자기 자신은 삭제할 수 없어요'; end if;
  delete from auth.users where id = target;
end $$;

revoke all on function public.admin_user_summary() from public, anon;
revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_user_summary() to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;
