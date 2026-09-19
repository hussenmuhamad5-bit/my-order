-- 090_storage_metrics.sql
-- فەنکشنی هێنانی ئامارەکانی داتابەیس و ستۆریج بۆ داشبۆردی پاشا

create or replace function public.get_system_storage_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_db_size bigint;
    v_storage_size bigint;
    v_storage_count bigint;
    v_total_orders bigint;
    v_r2_orders bigint;
    v_total_employees bigint;
    v_total_tx bigint;
    v_res jsonb;
begin
    -- پێوانەکردنی قەبارەی داتابەیسی PostgreSQL
    v_db_size := pg_database_size(current_database());

    -- پێوانەکردنی قەبارە و ژمارەی فایلەکانی ناو Supabase Storage
    select 
        count(*),
        coalesce(sum((metadata->>'size')::bigint), 0)
    into 
        v_storage_count,
        v_storage_size
    from storage.objects
    where bucket_id = 'order-images';

    -- ژمارەی ئۆردەرەکان و ژمارەی ئۆردەرە گوازراوەکان بۆ Cloudflare R2
    select 
        count(*),
        count(case when image_url like '%pub-5d1996bbd70b4d5e99499860829c4b46.r2.dev%' then 1 end)
    into 
        v_total_orders,
        v_r2_orders
    from public.orders;

    -- ژمارەی کارمەندان و مامەڵە داراییەکان
    select count(*) into v_total_employees from public.employees;
    select count(*) into v_total_tx from public.transactions;

    -- پێکهێنانی وەڵامی کۆتایی بە فۆرماتی JSON
    v_res := jsonb_build_object(
        'success', true,
        'db_size_bytes', v_db_size,
        'db_size_mb', round(v_db_size / (1024.0 * 1024.0), 1),
        'db_limit_mb', 500,
        'db_percent', round((v_db_size / (500.0 * 1024.0 * 1024.0)) * 100.0, 1),
        'storage_size_bytes', v_storage_size,
        'storage_size_mb', round(v_storage_size / (1024.0 * 1024.0), 1),
        'storage_count', v_storage_count,
        'storage_limit_mb', 1000,
        'storage_percent', round((v_storage_size / (1000.0 * 1024.0 * 1024.0)) * 100.0, 1),
        'r2_orders_count', v_r2_orders,
        'r2_limit_mb', 10240,
        'r2_domain', 'https://pub-5d1996bbd70b4d5e99499860829c4b46.r2.dev',
        'total_orders', v_total_orders,
        'total_employees', v_total_employees,
        'total_transactions', v_total_tx,
        'checked_at', now()
    );

    return v_res;
end;
$$;

grant execute on function public.get_system_storage_stats() to anon, authenticated, service_role;
