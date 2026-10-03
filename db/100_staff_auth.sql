-- ============================================================
--  ١٠٠ — داخستنی داتابەیس بۆ کەسانی دەرەوە (چوونەژوورەوەی ڕاستەقینە)
-- ------------------------------------------------------------
--  کێشەکە:
--    `config.js` کلیلی `service_role`ـی تێدا بوو، و ئەو فایلە لە
--    GitHub و سەر سایتەکە گشتییە. ئەو کلیلە هەموو RLS تێدەپەڕێنێت،
--    واتا هەر کەسێک لە ئینتەرنێت دەیتوانی هەموو داتاکە بخوێنێتەوە،
--    بگۆڕێت یان بسڕێتەوە — پاسوۆردەکان و باڵانسی جزدانیش.
--
--  چارەسەر (قۆناغی ١):
--    • ئەپەکە تەنها کلیلی گشتی (`sb_publishable_…`) بەکاردەهێنێت
--    • هەر کارمەندێک بە Edge Functionـی `staff-login` دەچێتە ژوورەوە
--      و sessionـێکی Supabase Auth وەردەگرێت
--    • ئەم فایلە: تەنها کارمەندی چووەژوورەوە (و ڕانەگیراو) دەسەڵاتی
--      هەیە. `anon` (کەسی دەرەوە) هیچ.
--
--  ⚠️ ئەمە ئەپەکە بۆ کارمەندان ناگۆڕێت: هەر کارمەندێک هەمان
--     دەسەڵاتی پێشووی هەیە لەسەر ئاستی داتابەیس. پشکنینی وردی
--     دەسەڵات (`can(...)`) هێشتا تەنها لە براوزەردایە — قۆناغی ٢.
--
--  چۆن جێبەجێی بکەیت:
--    ئەمە **یەکەم** هەنگاوە — پێش Edge Function و پێش سایتی نوێ.
--    ئەپە کۆنەکە، ئەپی Dart و بۆتەکە هێشتا کلیلی service_role
--    بەکاردەهێنن، و ئەو کلیلە RLS تێدەپەڕێنێت، بۆیە هیچیان
--    هەست بەم گۆڕانکارییە ناکەن تا کلیلە کۆنەکان نەکوژێنرێنەوە.
--    Supabase → SQL Editor → هەموو فایلەکە پێکەوە Run بکە
--    (یەک transactionـە — یان هەمووی دەبێت یان هیچ).
--    ڕێنمایی تەواو: `SECURITY-ROLLOUT.md`
--
--  گەڕانەوە: `db/100_staff_auth_rollback.sql`
-- ============================================================

begin;

-- ------------------------------------------------------------
-- ١) بەستنەوەی کارمەند بە بەکارهێنەری Supabase Auth
-- ------------------------------------------------------------
--  `staff-login` ئەم خانەیە پڕ دەکاتەوە لە یەکەم چوونەژوورەوەدا.
--  کلیلی سەرەکی `code`ـە (نەک `id`)، بۆیە ئەم پەیوەندییە جیایە.
alter table public.employees
    add column if not exists auth_user_id uuid unique
        references auth.users (id) on delete set null;

-- ------------------------------------------------------------
-- ٢) «ئایا ئەم داواکارییە لە کارمەندێکی چالاکەوەیە؟»
-- ------------------------------------------------------------
--  ⚠️ بە `auth.uid()` + `employees.auth_user_id`، **نەک** بە خانەیەکی
--     JWT. خانەی JWT تا بەسەرچوونی تۆکنەکە (١ کاتژمێر) دەمێنێتەوە؛
--     ئەمە لە هەمان ساتدا دەزانێت کە کەسێک ڕاگیراوە یان سڕاوەتەوە.
--  ⚠️ SECURITY DEFINER — ئەگەرنا لەناو policyی `employees`ـدا
--     خۆی بانگ دەکاتەوە (RLS لەسەر RLS).
create or replace function public.is_employee()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
          from public.employees e
         where e.auth_user_id = auth.uid()
           and not coalesce(e.suspended, false)
    );
$$;

-- کۆدی کارمەندی ئێستا — بۆ قۆناغی ٢ (پشکنینی دەسەڵات لە سێرڤەر)
create or replace function public.current_emp_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select e.code
      from public.employees e
     where e.auth_user_id = auth.uid()
       and not coalesce(e.suspended, false)
     limit 1;
$$;

-- ------------------------------------------------------------
-- ٣) لابردنی ئەو policyیانەی دەرگایان بۆ هەمووان کردبووەوە
-- ------------------------------------------------------------
--  ئەمانە `anon`ـیان تێدا بوو بە `using (true)` — واتا تەنانەت بە
--  کلیلی گشتیش هەر کەسێک دەیتوانی دیسپاچ و نرخی گەیاندن بگۆڕێت.
drop policy if exists dispatch_batches_all     on public.dispatch_batches;
drop policy if exists dispatch_items_all       on public.dispatch_items;
drop policy if exists delivery_fees_all        on public.delivery_fees;
drop policy if exists dispatch_city_prices_all on public.dispatch_city_prices;
drop policy if exists cities_select_all        on public.cities;

-- ------------------------------------------------------------
-- ٤) یەک policy بۆ هەموو خشتەکان: کارمەندی چالاک = هەموو شتێک
-- ------------------------------------------------------------
--  `(select …)` واتا جارێک بۆ هەر داواکارییەک حیساب دەکرێت، نەک
--  بۆ هەر ڕیزێک (initPlan) — بۆیە لەسەر ١٢٠ هەزار ئۆردەر خاو نابێت.
do $$
declare
    t record;
begin
    for t in
        select c.relname
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind in ('r', 'p')
    loop
        execute format('alter table public.%I enable row level security', t.relname);
        execute format('drop policy if exists staff_all on public.%I', t.relname);
        execute format(
            'create policy staff_all on public.%I for all to authenticated '
            'using ((select public.is_employee())) '
            'with check ((select public.is_employee()))',
            t.relname);
    end loop;
end $$;

-- ------------------------------------------------------------
-- ٥) `anon` (کەسی چوونەژوورەوەنەکردوو) هیچ دەسەڵاتێکی نامێنێت
-- ------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;

--  فەنکشنەکان: ٣٨ فەنکشنی SECURITY DEFINER بۆ anon کراوە بوون —
--  ئەوانە RLS تێدەپەڕێنن، بۆیە policy بەتەنها بەس نییە.
--  ⚠️ تەنها فەنکشنە خۆماڵییەکان (خاوەن postgres، نەک بەشی
--     extension وەک pg_trgm) — ئەوانی تر هی ئێمە نین.
do $$
declare
    f record;
begin
    for f in
        select p.oid::regprocedure as sig
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.prokind = 'f'
           and pg_get_userbyid(p.proowner) = current_user
           and not exists (
               select 1 from pg_depend d
                where d.classid = 'pg_proc'::regclass
                  and d.objid = p.oid
                  and d.deptype = 'e')
    loop
        execute format('revoke execute on function %s from public, anon', f.sig);
        execute format('grant execute on function %s to authenticated, service_role', f.sig);
    end loop;
end $$;

--  تاکە دەرگای پێش چوونەژوورەوە: پەڕەی چوونەژوورەوە ناو و وێنەی
--  خاوەنی کۆدەکە پیشان دەدات. پاسوۆرد ناگەڕێنێتەوە.
grant execute on function public.login_code_status(text) to anon;

--  فەنکشن و خشتەی نوێ لە داهاتوودا خۆکارانە بۆ anon ناکرێنەوە
--  ⚠️ `public` (هەمووان) بە شێوەی **گشتی** EXECUTE وەردەگرێت، نەک
--     لەسەر ئاستی schema — شێوەی `in schema public` ناتوانێت لای
--     ببات، بۆیە دوو دێڕی جیاوازن.
alter default privileges in schema public revoke all     on tables    from anon;
alter default privileges in schema public revoke all     on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges                  revoke execute on functions from public;

-- ------------------------------------------------------------
-- ٦) وێنەکان (Supabase Storage)
-- ------------------------------------------------------------
--  خوێندنەوە گشتی دەمێنێتەوە (لینکی وێنەکان لە ئۆردەرەکاندا گشتین).
--  ئەپلۆد تەنها بۆ کارمەند — پێشتر هەر کەسێک دەیتوانی فایل دابنێت.
drop policy if exists order_images_insert on storage.objects;
drop policy if exists order_images_insert_staff on storage.objects;
drop policy if exists order_images_update_staff on storage.objects;

create policy order_images_insert_staff on storage.objects
    for insert to authenticated
    with check (bucket_id = 'order-images' and (select public.is_employee()));

--  `x-upsert: true` نوێکردنەوەشی پێویستە
create policy order_images_update_staff on storage.objects
    for update to authenticated
    using (bucket_id = 'order-images' and (select public.is_employee()));

-- ------------------------------------------------------------
-- ٧) ڕاگرتن / گۆڕینی پاسوۆرد → session لە سێرڤەریش دەکوژرێت
-- ------------------------------------------------------------
--  `employees_session_guard` (db/049) لەم دوو حاڵەتەدا
--  `session_epoch` بەرز دەکاتەوە، و ئەپەکە ئامێرەکە دەردەکات.
--  بەڵام ئەوە تەنها لە براوزەردایە — کەسێک کە ڕاستەوخۆ API
--  بەکاردەهێنێت تۆکنەکەی هێشتا کاردەکات. ئێستا refresh tokenـەکانی
--  ئەو کەسە دەسڕدرێنەوە، و `is_employee()` ڕاگیراو یەکسەر ڕەت دەکاتەوە.
create or replace function public.employees_revoke_auth_sessions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.auth_user_id is not null
       and new.session_epoch is distinct from old.session_epoch then
        delete from auth.sessions where user_id = new.auth_user_id;
    end if;
    return null;
end;
$$;

revoke execute on function public.employees_revoke_auth_sessions() from public, anon, authenticated;

--  ⚠️ `after update of session_epoch` **نا**: ئەو شێوەیە تەنها کاتێک
--     کاردەکات کە خانەکە لە `SET`ـی داواکارییەکەدا بێت، بەڵام
--     `session_epoch` لەلایەن تریگەری `employees_session_guard`ـەوە
--     دەگۆڕێت — بۆیە هەرگیز نەدەتەقییەوە. `when` بەهای کۆتایی دەبینێت.
drop trigger if exists trg_employees_revoke_sessions on public.employees;
create trigger trg_employees_revoke_sessions
    after update on public.employees
    for each row
    when (new.session_epoch is distinct from old.session_epoch)
    execute function public.employees_revoke_auth_sessions();

-- ------------------------------------------------------------
-- ٨) یارمەتی بۆ `staff-login` (تەنها service_role)
-- ------------------------------------------------------------
--  تۆکنی بۆتی تلیگرام لە Vault — بۆ پشکنینی واژووی `initData`.
--  هەمان تۆکنە کە `notif_emit` بەکاریدەهێنێت، بۆیە کاتێک تۆکنەکە
--  دەگۆڕیت تەنها یەک شوێن نوێ دەکەیتەوە.
create or replace function public.staff_bot_token()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select decrypted_secret
      from vault.decrypted_secrets
     where name = 'telegram_bot_token'
     limit 1;
$$;

revoke execute on function public.staff_bot_token() from public, anon, authenticated;
grant  execute on function public.staff_bot_token() to service_role;

--  کلیلی تایبەتی service accountـی گووگڵ بۆ `gdrive-test`. پێشتر لە
--  ناو کۆدی فەنکشنەکەدا بوو؛ ئێستا لە Vault (شفرەکراو). ناوی نهێنییەکە:
--  `google_sa_private_key`. ئەگەر دانەنرابێت، null دەگەڕێنێتەوە.
create or replace function public.staff_google_sa_key()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select decrypted_secret
      from vault.decrypted_secrets
     where name = 'google_sa_private_key'
     limit 1;
$$;

revoke execute on function public.staff_google_sa_key() from public, anon, authenticated;
grant  execute on function public.staff_google_sa_key() to service_role;

--  هەوڵە شکستخواردووەکانی پاسوۆرد — بۆ ڕێگری لە تاقیکردنەوەی
--  هەزاران پاسوۆرد. هیچ policyیەکی نییە، واتا تەنها service_role.
create table if not exists public.staff_login_failures (
    id   bigserial primary key,
    code text        not null,
    at   timestamptz not null default now()
);
create index if not exists staff_login_failures_code_at_idx
    on public.staff_login_failures (code, at desc);
alter table public.staff_login_failures enable row level security;
drop policy if exists staff_all on public.staff_login_failures;
revoke all on public.staff_login_failures from anon, authenticated;

-- ------------------------------------------------------------
-- ٩) قوفڵی دووەم: پێش هەر داواکارییەکی API
-- ------------------------------------------------------------
--  policyـەکان خشتەکان دەپارێزن، بەڵام فەنکشنی SECURITY DEFINER
--  (٣٨ دانە، وەک `wallet_apply`) RLS تێدەپەڕێنن. `authenticated`
--  دەتوانێت بانگیان بکات — ئەوە بۆ کارمەند دروستە، بەڵام ئەگەر
--  کەسێک بە هەر ڕێگایەک بەکارهێنەرێکی Auth دروست بکات (بۆ نموونە
--  ئەگەر «Allow new users to sign up» بەهەڵە کرابێتەوە)، نابێت
--  بگاتە هیچ شتێک. ئەم فەنکشنە پێش هەموو داواکارییەکی PostgREST
--  جێبەجێ دەبێت و ئەوانە بە 403 ڕەت دەکاتەوە.
--  ⚠️ تەنها `authenticated`: `anon` پێشتر هیچی نییە (بێجگە لە
--     `login_code_status`)، و `service_role` (ئەپی Dart، بۆت) ئازادە.
create or replace function public.staff_gate()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'authenticated'
       and not public.is_employee() then
        raise sqlstate 'PGRST' using
            message = json_build_object(
                'code', 'not_staff',
                'message', 'Not an active employee')::text,
            detail = json_build_object('status', 403)::text;
    end if;
end;
$$;

revoke execute on function public.staff_gate() from public;
grant  execute on function public.staff_gate() to anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request = 'public.staff_gate';
notify pgrst, 'reload config';

commit;

-- ------------------------------------------------------------
-- پشکنین دوای جێبەجێکردن (دەبێت هەموویان ڕاست بن):
-- ------------------------------------------------------------
--  select count(*) = 0 as anon_no_tables
--    from information_schema.role_table_grants
--   where grantee = 'anon' and table_schema = 'public';
--
--  select count(*) as tables_without_staff_policy
--    from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relkind = 'r'
--     and c.relname <> 'staff_login_failures'
--     and not exists (select 1 from pg_policies p
--                      where p.schemaname = 'public'
--                        and p.tablename = c.relname
--                        and p.policyname = 'staff_all');   -- دەبێت ٠ بێت
