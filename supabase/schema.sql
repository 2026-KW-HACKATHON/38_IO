-- Supabase SQL Editor에 통째로 붙여넣고 Run (여러 번 실행해도 됨)
-- 선물 코드는 이 파일에 적지 않음. Supabase 화면의 gift_codes 표에 직접 추가

-- 1) 계정 표 (카카오 로그인하면 한 줄씩 생김)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text,
  avatar_url text,
  provider_id text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists avatar jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists roles jsonb not null default '[]'::jsonb;

-- 2) 활동 기록 표 (계정이 지워지면 함께 지워짐)
create table if not exists public.activity_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event text not null check (char_length(event) <= 40),
  meta jsonb not null default '{}'::jsonb check (pg_column_size(meta) < 2000),
  created_at timestamptz not null default now()
);
create index if not exists activity_logs_user_idx on public.activity_logs (user_id, created_at desc);
create index if not exists activity_logs_time_idx on public.activity_logs (created_at desc);

-- 3) 선물 코드 표 (일반 사용자는 볼 수 없음)
--    kind: resident(주민) / student(학생) / activity(지역 활동) / owner(점주) / tester(베타테스터)
create table if not exists public.gift_codes (
  code text primary key check (code = lower(code)),
  kind text not null,
  label text not null,
  dept text,
  spot text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.gift_codes add column if not exists spot text;
alter table public.gift_codes drop constraint if exists gift_codes_kind_check;
alter table public.gift_codes add constraint gift_codes_kind_check
  check (kind in ('resident', 'student', 'activity', 'owner', 'tester')) not valid;

-- 4) 관리자인지 확인
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- 5) 새 계정이 생기면 profiles에 추가
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

insert into public.profiles (id, nickname)
select id, coalesce(raw_user_meta_data->>'nickname', raw_user_meta_data->>'name', '카카오 사용자') from auth.users
on conflict (id) do nothing;

-- 6) 표 사용 권한과 접근 규칙: 본인 것만, 관리자는 전부. 본인은 닉네임 · 아바타만 고침
grant usage on schema public to anon, authenticated;
grant select on public.profiles to authenticated;
grant update (nickname, avatar) on public.profiles to authenticated;
grant select, insert on public.activity_logs to authenticated;

alter table public.profiles enable row level security;
alter table public.activity_logs enable row level security;
alter table public.gift_codes enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "logs_select" on public.activity_logs;
create policy "logs_select" on public.activity_logs for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "logs_insert" on public.activity_logs;
create policy "logs_insert" on public.activity_logs for insert
  with check (user_id = auth.uid());

-- 7) 관리자 전용: 계정별 요약, 계정 삭제 (자기 자신은 못 지움)
create or replace function public.admin_user_summary()
returns table (id uuid, nickname text, avatar_url text, provider_id text, is_admin boolean,
               created_at timestamptz, log_count bigint, last_active timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '관리자만 사용할 수 있습니다'; end if;
  return query
    select p.id, p.nickname, p.avatar_url, p.provider_id, p.is_admin, p.created_at,
           count(l.id), max(l.created_at)
    from public.profiles p
    left join public.activity_logs l on l.user_id = p.id
    group by p.id
    order by max(l.created_at) desc nulls last, p.created_at desc;
end $$;

create or replace function public.admin_delete_user(target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '관리자만 사용할 수 있습니다'; end if;
  if target = auth.uid() then raise exception '자기 자신은 삭제할 수 없습니다'; end if;
  delete from auth.users where id = target;
end $$;

-- 8) 선물 코드 쓰기: 신분은 하나(새 신분이 바꿈), 점주는 하나(지운 뒤 새 코드), 나머지는 쌓임
create or replace function public.redeem_gift_code(input text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.gift_codes; item jsonb; cur jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select * into g from public.gift_codes where code = lower(trim(input)) and active;
  if not found then raise exception '존재하지 않는 코드입니다'; end if;
  item := jsonb_build_object('code', g.code, 'kind', g.kind, 'label', g.label, 'dept', g.dept, 'spot', g.spot, 'at', now());
  select roles into cur from public.profiles where id = auth.uid();
  if exists (select 1 from jsonb_array_elements(cur) r where r->>'code' = g.code) then
    return item || '{"already": true}'::jsonb;
  end if;
  if g.kind = 'owner' and exists (select 1 from jsonb_array_elements(cur) r where r->>'kind' = 'owner') then
    raise exception '점주 권한은 하나만 등록할 수 있습니다. 현재 권한을 삭제한 뒤 다시 시도하십시오.';
  end if;
  if g.kind in ('resident', 'student') then
    select coalesce(jsonb_agg(r), '[]'::jsonb) into cur
      from jsonb_array_elements(cur) r where r->>'kind' not in ('resident', 'student');
  end if;
  update public.profiles set roles = cur || jsonb_build_array(item) where id = auth.uid();
  return item;
end $$;

-- 9) 소속 하나 지우기, 내 계정 지우기
create or replace function public.remove_role(target text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set roles = (select coalesce(jsonb_agg(r), '[]'::jsonb) from jsonb_array_elements(roles) r where r->>'code' <> target)
   where id = auth.uid();
end $$;

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  delete from auth.users where id = auth.uid();
end $$;

-- 10) 함수 실행 권한: 로그인한 사람만
revoke all on function public.admin_user_summary() from public, anon;
revoke all on function public.admin_delete_user(uuid) from public, anon;
revoke all on function public.redeem_gift_code(text) from public, anon;
revoke all on function public.remove_role(text) from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.admin_user_summary() to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;
grant execute on function public.redeem_gift_code(text) to authenticated;
grant execute on function public.remove_role(text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- 11) 영수증 인증 기록: 사진은 남기지 않고 읽어 낸 값만
--     결제 시각이 적힌 영수증은 결제 후 15분 안에만, 시각이 없으면 30일 안에만 받음 (js/receipt.js의 MINS · DAYS와 같게). 베타테스터는 기한 없음
--     지도에 없는 가게도 받음: spot(지도 가게)은 비고 shop(영수증에 적힌 이름)만 남음
--     같은 영수증(가게 · 결제 분 · 승인번호나 금액이 겹침)을 여러 사람이 올리면 한 무리로 묶음: 처음 올린 사람이 대표, 나머지는 동행
--     본인, 그 가게 점주, 관리자만 볼 수 있음
create table if not exists public.receipts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  spot text check (char_length(spot) between 1 and 40),
  shop text check (char_length(shop) <= 40),
  paid_at timestamptz not null,
  timed boolean not null default true,
  approval text check (char_length(approval) <= 20),
  amount integer check (amount between 0 and 100000000),
  biz text check (char_length(biz) <= 12),
  party_id bigint,
  created_at timestamptz not null default now()
);
alter table public.receipts drop column if exists fp;
alter table public.receipts alter column spot drop not null;
alter table public.receipts add column if not exists shop text check (char_length(shop) <= 40);
alter table public.receipts add column if not exists timed boolean not null default true;
alter table public.receipts add column if not exists party_id bigint;
update public.receipts set party_id = id where party_id is null;
create index if not exists receipts_user_idx on public.receipts (user_id, created_at desc);
create index if not exists receipts_spot_idx on public.receipts (spot, paid_at desc);
create index if not exists receipts_party_idx on public.receipts (party_id);
grant select on public.receipts to authenticated;
alter table public.receipts enable row level security;

drop policy if exists "receipts_select" on public.receipts;
create policy "receipts_select" on public.receipts for select
  using (user_id = auth.uid() or public.is_admin() or exists (
    select 1 from public.profiles p, jsonb_array_elements(p.roles) r
    where p.id = auth.uid() and r->>'kind' = 'owner' and coalesce(r->>'spot', r->>'code') = receipts.spot));

drop function if exists public.submit_receipt(text, timestamptz, text, integer, text);
drop function if exists public.submit_receipt(text, timestamptz, boolean, text, integer, text);
create or replace function public.submit_receipt(shop_id text, shop_name text, paid timestamptz, has_time boolean,
                                                 approval_no text, total integer, biz_no text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare same public.receipts; got public.receipts; n integer; free boolean;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if paid is null then raise exception '결제 시각이 필요합니다'; end if;
  shop_id := nullif(shop_id, ''); shop_name := left(nullif(trim(shop_name), ''), 40); biz_no := nullif(biz_no, ''); approval_no := nullif(approval_no, '');
  if shop_id is null and shop_name is null and biz_no is null then raise exception '가게 이름이 필요합니다'; end if;
  if paid > now() + interval '10 minutes' then raise exception '앞으로의 날짜라 받을 수 없습니다'; end if;
  -- 베타테스터는 기한을 보지 않음
  select exists (select 1 from public.profiles p, jsonb_array_elements(p.roles) r
                 where p.id = auth.uid() and r->>'kind' = 'tester') into free;
  if not free and has_time and paid < now() - interval '15 minutes' then raise exception '결제한 지 15분이 지난 영수증입니다'; end if;
  if not free and not has_time and paid < now() - interval '30 days' then raise exception '결제한 지 30일이 지난 영수증입니다'; end if;
  -- 같은 영수증 찾기: 가게(지도 가게, 아니면 사업자번호나 이름)와 결제 분이 같고, 승인번호나 금액이 겹치면 같은 것
  -- 다시 찍어서 승인번호나 금액 하나를 못 읽었어도 남은 값이 겹치면 같은 것으로 봄
  select * into same from public.receipts r
   where date_trunc('minute', r.paid_at) = date_trunc('minute', paid)
     and (r.spot = shop_id or (shop_id is null and r.spot is null and (r.biz = biz_no or r.shop = shop_name)))
     and (r.approval = approval_no or r.amount = total
          or (r.approval is null and r.amount is null) or (approval_no is null and total is null))
   order by r.id limit 1;
  if found and exists (select 1 from public.receipts r where r.party_id = same.party_id and r.user_id = auth.uid()) then
    raise exception '이미 인증한 영수증입니다';
  end if;
  insert into public.receipts (user_id, spot, shop, paid_at, timed, approval, amount, biz, party_id)
  values (auth.uid(), shop_id, shop_name, paid, coalesce(has_time, false), approval_no, total, biz_no, same.party_id)
  returning * into got;
  if got.party_id is null then
    update public.receipts set party_id = id where id = got.id returning * into got;
  end if;
  select count(*) into n from public.receipts where party_id = got.party_id;
  return to_jsonb(got) || jsonb_build_object('lead', got.party_id = got.id, 'party', n);
end $$;

-- 내 인증 기록: 최근 20개, 대표인지 · 같은 영수증으로 인증한 사람 수
drop function if exists public.my_receipts();
create or replace function public.my_receipts()
returns table (id bigint, spot text, shop text, paid_at timestamptz, timed boolean, amount integer, lead boolean, party integer, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.spot, r.shop, r.paid_at, r.timed, r.amount, r.party_id = r.id,
         (select count(*)::integer from public.receipts o where o.party_id = r.party_id), r.created_at
  from public.receipts r
  where r.user_id = auth.uid()
  order by r.created_at desc
  limit 20
$$;

revoke all on function public.submit_receipt(text, text, timestamptz, boolean, text, integer, text) from public, anon;
revoke all on function public.my_receipts() from public, anon;
grant execute on function public.submit_receipt(text, text, timestamptz, boolean, text, integer, text) to authenticated;
grant execute on function public.my_receipts() to authenticated;
