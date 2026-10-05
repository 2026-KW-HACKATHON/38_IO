-- Supabase SQL Editor에 통째로 붙여넣고 Run

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

-- ───────── 나의 계정 (아래만 따로 붙여넣고 Run 해도 됨) ─────────

-- 8) 아바타(물고기 모습)와 소속(신분 · 활동) 칸
alter table public.profiles add column if not exists avatar jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists roles jsonb not null default '[]'::jsonb;

-- 본인은 닉네임과 아바타만 고칠 수 있음 (소속은 선물 코드로만 바뀜)
grant update (nickname, avatar) on public.profiles to authenticated;
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- 9) 선물 코드 표 (일반 사용자는 볼 수 없음, 아래 함수로만 씀)
--    kind: resident(주민) / student(학생) / activity(지역 활동)
create table if not exists public.gift_codes (
  code text primary key check (code = lower(code)),
  kind text not null check (kind in ('resident', 'student', 'activity')),
  label text not null,
  dept text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.gift_codes enable row level security;

-- 선물 코드는 이 파일에 적지 않음 (공개 저장소). Supabase 화면의 gift_codes 표에 직접 추가

-- 10) 선물 코드 쓰기: 맞는 코드면 소속에 추가 (신분은 하나만, 새 신분이 예전 신분을 바꿈)
create or replace function public.redeem_gift_code(input text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.gift_codes; item jsonb; cur jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  select * into g from public.gift_codes where code = lower(trim(input)) and active;
  if not found then raise exception '없는 코드예요'; end if;
  item := jsonb_build_object('code', g.code, 'kind', g.kind, 'label', g.label, 'dept', g.dept, 'at', now());
  select roles into cur from public.profiles where id = auth.uid();
  if exists (select 1 from jsonb_array_elements(cur) r where r->>'code' = g.code) then
    return item || '{"already": true}'::jsonb;
  end if;
  if g.kind in ('resident', 'student') then
    select coalesce(jsonb_agg(r), '[]'::jsonb) into cur
      from jsonb_array_elements(cur) r where r->>'kind' not in ('resident', 'student');
  end if;
  update public.profiles set roles = cur || jsonb_build_array(item) where id = auth.uid();
  return item;
end $$;

-- 11) 소속 하나 지우기
create or replace function public.remove_role(target text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set roles = (select coalesce(jsonb_agg(r), '[]'::jsonb) from jsonb_array_elements(roles) r where r->>'code' <> target)
   where id = auth.uid();
end $$;

-- 12) 내 계정 지우기 (기록도 함께 지워짐)
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.redeem_gift_code(text) from public, anon;
revoke all on function public.remove_role(text) from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.redeem_gift_code(text) to authenticated;
grant execute on function public.remove_role(text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- ───────── 권한 (아래만 따로 붙여넣고 Run 해도 됨, 8~12번을 먼저 실행해야 함) ─────────

-- 13) 점주 권한: 선물 코드 종류에 owner(점주) 추가, 어느 가게인지(spot) 적는 칸
alter table public.gift_codes add column if not exists spot text;
alter table public.gift_codes drop constraint if exists gift_codes_kind_check;
alter table public.gift_codes add constraint gift_codes_kind_check
  check (kind in ('resident', 'student', 'activity', 'owner'));

-- 점주 코드도 gift_codes 표에 직접 추가 (kind: owner, spot: 가게)

-- 선물 코드 쓰기 (다시 만듦): 점주 권한은 하나만, 바꾸려면 지금 것을 지운 뒤 새 코드
create or replace function public.redeem_gift_code(input text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.gift_codes; item jsonb; cur jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  select * into g from public.gift_codes where code = lower(trim(input)) and active;
  if not found then raise exception '없는 코드예요'; end if;
  item := jsonb_build_object('code', g.code, 'kind', g.kind, 'label', g.label, 'dept', g.dept, 'spot', g.spot, 'at', now());
  select roles into cur from public.profiles where id = auth.uid();
  if exists (select 1 from jsonb_array_elements(cur) r where r->>'code' = g.code) then
    return item || '{"already": true}'::jsonb;
  end if;
  if g.kind = 'owner' and exists (select 1 from jsonb_array_elements(cur) r where r->>'kind' = 'owner') then
    raise exception '점주 권한은 하나만 등록할 수 있어요. 지금 권한을 삭제한 뒤 다시 넣어 주세요.';
  end if;
  if g.kind in ('resident', 'student') then
    select coalesce(jsonb_agg(r), '[]'::jsonb) into cur
      from jsonb_array_elements(cur) r where r->>'kind' not in ('resident', 'student');
  end if;
  update public.profiles set roles = cur || jsonb_build_array(item) where id = auth.uid();
  return item;
end $$;
revoke all on function public.redeem_gift_code(text) from public, anon;
grant execute on function public.redeem_gift_code(text) to authenticated;

-- ───────── 베타테스터 권한 (아래만 따로 붙여넣고 Run 해도 됨, 13번을 먼저 실행해야 함) ─────────

-- 14) 선물 코드 종류에 tester(베타테스터) 추가. 다른 권한 · 신분과 함께 가질 수 있음
alter table public.gift_codes drop constraint if exists gift_codes_kind_check;
alter table public.gift_codes add constraint gift_codes_kind_check
  check (kind in ('resident', 'student', 'activity', 'owner', 'tester'));

-- 베타테스터 코드도 gift_codes 표에 직접 추가 (kind: tester)
