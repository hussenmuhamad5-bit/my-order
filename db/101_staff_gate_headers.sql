-- ============================================================
--  ١٠١ — چاککردنی وەڵامی قوفڵی پێش‌داواکاری (`staff_gate`)
-- ------------------------------------------------------------
--  تەنها بۆ داتابەیسێک کە `100_staff_auth.sql`ـی پێشووی تێدا
--  جێبەجێ کراوە (ئێستا `db/100` خۆی چاککراوە).
--
--  کێشەکە: PostgREST هەردوو `status` و `headers` لە DETAIL داوا
--  دەکات. بێ `headers`، کەسێکی چووەژوورەوە کە کارمەندی چالاک نییە
--  (ڕاگیراو) بەجیاتی 403ـی `not_staff`، هەڵەی 500 (PGRST121)
--  وەردەگرێت — هەر ڕێگری لێدەکرێت، بەڵام ئەپەکە پەیامی «ڕاگیراوە»
--  پیشان نادات.
--
--  تەنها فەنکشنەکە دەگۆڕێت: هیچ داتایەک، هیچ قوفڵێکی خشتە.
-- ============================================================

begin;

create or replace function public.staff_gate()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_role text;
begin
    v_role := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
    if v_role <> 'authenticated' then
        return;
    end if;
    if not public.is_employee() then
        raise sqlstate 'PGRST' using
            message = json_build_object(
                'code', 'not_staff',
                'message', 'Not an active employee')::text,
            detail = json_build_object('status', 403, 'headers', json_build_object())::text;
    end if;
end;
$$;

revoke execute on function public.staff_gate() from public;
grant  execute on function public.staff_gate() to anon, authenticated, service_role;

commit;

-- پشکنین: دەبێت `true` بێت
--  select pg_get_functiondef('public.staff_gate()'::regprocedure) like '%''headers''%' as fixed;
