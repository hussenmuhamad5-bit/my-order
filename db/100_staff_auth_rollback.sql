-- ============================================================
--  ١٠٠ — گەڕانەوە (rollback) بۆ دۆخی پێش `100_staff_auth.sql`
-- ------------------------------------------------------------
--  تەنها ئەگەر شتێک تێکچوو و پێویستە خێرا بگەڕێیتەوە.
--  ⚠️ ئەمە دەرگاکە بۆ هەمووان دەکاتەوە وەک پێشتر — واتا کلیلی
--     ئاشکراکراو دووبارە هەموو دەسەڵاتێکی دەبێت (ئەگەر هێشتا
--     نەکوژێنرابێتەوە). تەنها وەک هەنگاوی کاتی بەکاری بهێنە.
--
--  `employees.auth_user_id` و `is_employee()` دەمێننەوە — هیچ
--  زیانێکیان نییە، و چوونەژوورەوەی دووبارە پێیان خێراترە.
-- ============================================================

begin;

-- ١) policyی کارمەند لە هەموو خشتەکان لادەبرێت
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
        execute format('drop policy if exists staff_all on public.%I', t.relname);
    end loop;
end $$;

-- ٢) policy کۆنەکان — هەمان پێناسەی پێشوو
create policy dispatch_batches_all on public.dispatch_batches
    for all to anon, authenticated using (true) with check (true);
create policy dispatch_items_all on public.dispatch_items
    for all to anon, authenticated using (true) with check (true);
create policy delivery_fees_all on public.delivery_fees
    for all to anon, authenticated using (true) with check (true);
create policy dispatch_city_prices_all on public.dispatch_city_prices
    for all to public using (true) with check (true);
create policy cities_select_all on public.cities
    for select to anon, authenticated, service_role using (true);

-- ٣) دەسەڵاتەکانی anon دەگەڕێنەوە
grant all on all tables    in schema public to anon;
grant all on all sequences in schema public to anon;

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
        execute format('grant execute on function %s to public, anon', f.sig);
    end loop;
end $$;

alter default privileges in schema public grant all     on tables    to anon;
alter default privileges in schema public grant all     on sequences to anon;
alter default privileges in schema public grant execute on functions to anon;
alter default privileges                  grant execute on functions to public;

-- ٤) وێنەکان — policyی ئەپلۆدی کۆن
drop policy if exists order_images_insert_staff on storage.objects;
drop policy if exists order_images_update_staff on storage.objects;
drop policy if exists order_images_insert on storage.objects;
create policy order_images_insert on storage.objects
    for insert to public
    with check (bucket_id = 'order-images');

-- ٥) قوفڵی پێش‌داواکاری
alter role authenticator reset pgrst.db_pre_request;
notify pgrst, 'reload config';
drop function if exists public.staff_gate();

-- ٦) تریگەر و یارمەتییەکانی staff-login
drop trigger  if exists trg_employees_revoke_sessions on public.employees;
drop function if exists public.employees_revoke_auth_sessions();
drop function if exists public.staff_bot_token();
drop function if exists public.staff_google_sa_key();
drop table    if exists public.staff_login_failures;

commit;
