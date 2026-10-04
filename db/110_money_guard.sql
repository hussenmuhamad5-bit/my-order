-- ============================================================
--  ١١٠ — پاراستنی پارە لەسەر سێرڤەر (قۆناغی ٢، بەشی یەکەم)
-- ------------------------------------------------------------
--  کێشەکە: دوای db/100، هەر کارمەندێکی چووەژوورەوە (authenticated)
--  دەیتوانی ڕاستەوخۆ باڵانس/پاشەکەوت/خاڵ/ڕێژەی قازانجی هەر کەسێک
--  بگۆڕێت — چونکە:
--    • `wallet_apply` / `coins_add` هیچ پشکنینی دەسەڵاتیان نەبوو و
--      بۆ authenticated کراوە بوون.
--    • فەنکشنەکانی تر (coins_grant, cosmetic_buy, claim_reward,
--      backup_*) متمانەیان بە کۆدێک دەکرد کە براوزەر دەینارد
--      (`p_viewer`, `p_actor`) — نەک بە کێی ڕاستەقینەی چووەژوورەوە.
--    • باڵانس/پاشەکەوت/قازانج ڕاستەوخۆ لە براوزەرەوە دەنووسرانەوە
--      (update employees set balance=…).
--
--  چارەسەر: ناسنامەی ڕاستەقینە لە `current_emp_code()`ـەوە (db/100،
--  بەپێی auth.uid) وەردەگیرێت، نەک لە پارامەتەری براوزەر. هەموو
--  جووڵەی پارە بە ڕێگەی فەنکشنی SECURITY DEFINERـەوە دەڕوات کە
--  هەمان یاسای دەسەڵاتی براوزەر (مەودا/پلە/تیم) جێبەجێ دەکات. ستوونە
--  پارەییەکان لە نووسینی ڕاستەوخۆ دادەخرێن.
--
--  ⚠️ service_role (ئەپی Dart، بۆت، Edge Functions) وەک پێشوو ئازادە
--     — پشکنینەکان تێدەپەڕێنێت، چونکە باکئێندی متمانەپێکراوە.
--
--  ئەمە ناکاتە: دەسەڵاتی ئۆردەر، پاسوۆرد، ڕۆڵ — ئەوانە بەشەکانی
--  داهاتووی قۆناغی ٢ن.
-- ============================================================

begin;
set local lock_timeout = '3s';

-- ------------------------------------------------------------
-- ٠) هێلپەرە بنچینەییەکان: ناسنامە و ڕۆڵی ڕاستەقینە
-- ------------------------------------------------------------

-- داواکاری لە لایەن service_roleـەوە دێت؟ (باکئێندی متمانەپێکراو)
create or replace function public.p2_is_service()
returns boolean language sql stable security definer set search_path = public as $$
    select coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''
    ) = 'service_role';
$$;

-- ڕۆڵی نۆرمالایزکراو (ئەدمین → سەرپەرشت، وەک براوزەر)
create or replace function public.p2_role(p_code text)
returns text language sql stable security definer set search_path = public as $$
    select case when e.role = 'ئەدمین' then 'سەرپەرشت' else coalesce(e.role, '') end
      from public.employees e where e.code = p_code limit 1;
$$;

-- کورتکراوەی پلە بۆ سنووری پلە (tier). پاشا/نەزانراو → null (بێ سنوور)
create or replace function public.p2_tier_of(p_code text)
returns text language sql stable security definer set search_path = public as $$
    select case public.p2_role(p_code)
             when 'بەڕێوەبەر' then 'mgr'
             when 'سەرپەرشت'  then 'sup'
             when 'ڕاوێژکار'  then 'con'
             when 'ئەندام'    then 'mem'
             else null
           end;
$$;

-- ------------------------------------------------------------
-- ١) مەودا (scope) و سنووری پلە (tier) — هەمان `normalizePerms`
-- ------------------------------------------------------------
-- بنەڕەتی مەودا بۆ کلیلێک بەپێی ڕۆڵ (وەک `defaultPermsForRole`).
-- پاشا هەمیشە 'all'. بۆ کلیلە پارەییەکان (view_wallets, manage_wallets,
-- set_profit_rates) بنەڕەت بۆ هەموو پلەیەکی ناپاشا 'none'ـە.
create or replace function public.p2_default_scope(p_role text, p_key text)
returns text language sql immutable set search_path = public as $$
    select case
        when p_role = 'پاشا' then 'all'
        when p_key in ('view_orders', 'change_status', 'distribute')
             and p_role = 'بەڕێوەبەر' then 'team'
        when p_key in ('change_status', 'distribute')
             and p_role in ('سەرپەرشت', 'ڕاوێژکار') then 'team'
        else 'none'
    end;
$$;

-- مەودای کاریگەری کارمەندێک لەسەر کلیلێک: 'none' | 'team' | 'all'
create or replace function public.p2_scope(p_code text, p_key text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
    v_role  text := public.p2_role(p_code);
    v_perms jsonb;
    v_raw   jsonb;
    v_isnew boolean;
    v_val   text;
    v_mw    text;
    v_spr   text;
begin
    if v_role = 'پاشا' then return 'all'; end if;

    select case when jsonb_typeof(permissions) = 'object' then permissions else null end
      into v_raw from public.employees where code = p_code limit 1;

    v_isnew := v_raw is not null and (
        v_raw ? 'view_orders' or v_raw ? 'create_key'
        or v_raw ? 'distribute' or v_raw ? 'change_status');

    if not v_isnew then
        v_val := public.p2_default_scope(v_role, p_key);
        return case when v_val in ('team', 'all') then v_val else 'none' end;
    end if;

    -- فۆرماتی نوێ: ئەگەر کلیلەکە هەبوو، ئەو؛ ئەگەرنا بنەڕەتی پلە
    if p_key = 'view_wallets' and not (v_raw ? 'view_wallets') then
        v_mw  := v_raw ->> 'manage_wallets';
        v_spr := v_raw ->> 'set_profit_rates';
        v_val := case
                   when v_mw = 'all' or v_spr = 'all'   then 'all'
                   when v_mw = 'team' or v_spr = 'team' then 'team'
                   else 'none'
                 end;
    elsif v_raw ? p_key then
        v_val := v_raw ->> p_key;
    else
        v_val := public.p2_default_scope(v_role, p_key);
    end if;

    return case when v_val in ('team', 'all') then v_val else 'none' end;
end;
$$;

-- بەهای سنووری پلە بۆ کلیلێکی تایبەت (tv_mgr, wm_sup …):
-- 'off' | 'own' | 'all'. بنەڕەت (نەبوون/کۆن) = 'all'. false = 'off'.
create or replace function public.p2_tier_val(p_code text, p_tierkey text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
    v_role  text := public.p2_role(p_code);
    v_raw   jsonb;
    v_isnew boolean;
    v_val   text;
begin
    if v_role = 'پاشا' then return 'all'; end if;

    select case when jsonb_typeof(permissions) = 'object' then permissions else null end
      into v_raw from public.employees where code = p_code limit 1;

    v_isnew := v_raw is not null and (
        v_raw ? 'view_orders' or v_raw ? 'create_key'
        or v_raw ? 'distribute' or v_raw ? 'change_status');

    if not v_isnew or not (v_raw ? p_tierkey) then
        return 'all';                 -- بنەڕەتی هەموو کلیلەکانی پلە
    end if;

    v_val := v_raw ->> p_tierkey;      -- jsonb false → 'false' ، true → 'true'
    return case
             when v_val in ('off', 'own', 'all') then v_val
             when v_val = 'false' then 'off'
             else 'all'                -- 'true' یان هەر شتێکی تر
           end;
end;
$$;

-- ------------------------------------------------------------
-- ٢) تیم و لق (team / line) — هەمان `computeMyTeam`
-- ------------------------------------------------------------
-- باوانی هەر کارمەندێک: یەکەم لە [consultant, admin] کە لەژێر هەمان
-- بەڕێوەبەردا بێت؛ ئەگەرنا manager؛ ئەگەرنا creator. (باوان = خۆی → null)
create or replace view public.p2_parent as
with e as (
    select code,
           nullif(btrim(coalesce(manager, '')), '')    as mgr,
           nullif(btrim(coalesce(admin, '')), '')       as adm,
           nullif(btrim(coalesce(consultant, '')), '')  as con,
           nullif(btrim(coalesce(creator, '')), '')     as cre
      from public.employees
)
select e.code,
       nullif(
         case
           when e.con is not null and e.con <> e.code
                and (e.mgr is null or e.con = e.mgr
                     or (select m.mgr from e m where m.code = e.con) = e.mgr)
             then e.con
           when e.adm is not null and e.adm <> e.code
                and (e.mgr is null or e.adm = e.mgr
                     or (select m.mgr from e m where m.code = e.adm) = e.mgr)
             then e.adm
           else coalesce(e.mgr, e.cre)
         end, e.code) as parent
  from e;

-- ئایا p_target لە تیمی p_actorدایە؟ (ڕەگ + هەموو ژێرەکانی ڕەگ، خۆیشی)
create or replace function public.p2_in_team(p_actor text, p_target text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_root text := p_actor; v_depth int := 0; v_par text; v_prole text;
begin
    if p_actor is null or p_target is null then return false; end if;
    if lower(btrim(p_actor)) = lower(btrim(p_target)) then return true; end if;

    -- سەرکەوتن بۆ ڕەگ: تا باوان بوونی نەبێت، یان پاشا بێت، یان نەناسراو بێت
    loop
        v_depth := v_depth + 1; exit when v_depth > 100;
        select parent into v_par from public.p2_parent where code = v_root;
        exit when v_par is null;
        if public.p2_role(v_par) = 'پاشا' then exit; end if;
        if not exists (select 1 from public.employees where code = v_par) then exit; end if;
        v_root := v_par;
    end loop;

    return exists (
        with recursive sub as (
            select v_root as code
            union
            select p.code from public.p2_parent p join sub s on p.parent = s.code
        )
        select 1 from sub where lower(btrim(code)) = lower(btrim(p_target))
    );
end;
$$;

-- ئایا p_target لەسەر لقی ستوونی p_actorدایە؟ (باوانەکان + خۆی + ژێرەکان)
create or replace function public.p2_in_line(p_actor text, p_target text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
    if p_actor is null or p_target is null then return false; end if;
    if lower(btrim(p_actor)) = lower(btrim(p_target)) then return true; end if;

    return exists (
        with recursive
        anc as (
            select p_actor as code, 0 as d
            union all
            select p.parent, a.d + 1 from public.p2_parent p
              join anc a on p.code = a.code
             where p.parent is not null and a.d < 100
        ),
        des as (
            select p_actor as code
            union
            select p.code from public.p2_parent p join des dd on p.parent = dd.code
        )
        select 1 from (select code from anc union select code from des) x
         where lower(btrim(code)) = lower(btrim(p_target))
    );
end;
$$;

-- ------------------------------------------------------------
-- ٣) پشکنینی سنووری پلە و دەسەڵاتی جزدان/قازانج/ئۆردەر
-- ------------------------------------------------------------
-- ڕێگەم پێدراوە ئەم کردارە (پێشگر) لەسەر کەسێکی ئەم پلەیە بکەم؟
create or replace function public.p2_tier_ok(p_actor text, p_prefix text, p_target text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_t text := public.p2_tier_of(p_target); v_m text;
begin
    if v_t is null then return true; end if;        -- پاشا/نەزانراو: بێ سنوور
    v_m := public.p2_tier_val(p_actor, p_prefix || '_' || v_t);
    if v_m = 'off' then return false; end if;
    if v_m = 'all' then return true; end if;
    return public.p2_in_line(p_actor, p_target);    -- 'own'
end;
$$;

-- دەسەڵاتی بەڕێوەبردنی جزدانی ئەم کەسە (هەمان canManageWallet)
create or replace function public.p2_can_manage_wallet(p_actor text, p_target text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_sv text; v_sm text;
begin
    if public.p2_role(p_actor) = 'پاشا' then return true; end if;
    if p_target is null then return false; end if;

    -- بینین پێویستە (بەبێ بینین هیچ)
    v_sv := public.p2_scope(p_actor, 'view_wallets');
    if v_sv = 'none' then return false; end if;
    if not public.p2_tier_ok(p_actor, 'wv', p_target) then return false; end if;
    if v_sv <> 'all' and not public.p2_in_team(p_actor, p_target) then return false; end if;

    -- بەڕێوەبردن
    v_sm := public.p2_scope(p_actor, 'manage_wallets');
    if v_sm = 'none' then return false; end if;
    if not public.p2_tier_ok(p_actor, 'wm', p_target) then return false; end if;
    if v_sm = 'all' then return true; end if;
    return public.p2_in_team(p_actor, p_target);
end;
$$;

-- دەسەڵاتی دیاریکردنی ڕێژەی قازانجی ئەم کەسە (هەمان canManageUser set_profit_rates)
create or replace function public.p2_can_set_profit(p_actor text, p_target text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_s text;
begin
    if public.p2_role(p_actor) = 'پاشا' then return true; end if;
    if p_target is null then return false; end if;
    v_s := public.p2_scope(p_actor, 'set_profit_rates');
    if v_s = 'all'  then return true; end if;
    if v_s = 'team' then return public.p2_in_team(p_actor, p_target); end if;
    return false;
end;
$$;

-- کردار لەسەر ئۆردەر (هەمان canActOnOrder). action: view|edit|delete|status|distribute
create or replace function public.p2_can_order(p_actor text, p_order_id text, p_action text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
    v_seller text; v_owner boolean; v_scopekey text; v_scope text; v_prefix text;
begin
    if public.p2_role(p_actor) = 'پاشا' then return true; end if;

    select seller_code into v_seller from public.orders where id::text = p_order_id limit 1;
    if not found then return false; end if;

    v_owner := v_seller is not null and lower(btrim(v_seller)) = lower(btrim(p_actor));
    if v_owner and p_action in ('view', 'edit', 'delete') then return true; end if;

    -- بەبێ بینین هیچ کردارێکی تر ناکرێت
    if p_action <> 'view' and not public.p2_can_order(p_actor, p_order_id, 'view') then
        return false;
    end if;

    v_scopekey := case p_action
                    when 'view' then 'view_orders' when 'edit' then 'edit_order'
                    when 'delete' then 'delete_order' when 'status' then 'change_status'
                    when 'distribute' then 'distribute' else null end;
    if v_scopekey is null then return false; end if;

    v_scope := public.p2_scope(p_actor, v_scopekey);
    if v_scope = 'none' then return false; end if;

    v_prefix := case p_action when 'view' then 'tv' when 'edit' then 'te'
                              when 'delete' then 'td' when 'status' then 'ts' else null end;
    if v_prefix is not null and not public.p2_tier_ok(p_actor, v_prefix, v_seller) then
        return false;
    end if;

    if v_scope = 'all' then return true; end if;
    return public.p2_in_team(p_actor, v_seller);
end;
$$;

-- ناوی پیشاندانی کارمەندێک (بۆ `created_by` — متمانەپێکراو، نەک لە براوزەر)
create or replace function public.p2_display_name(p_code text)
returns text language sql stable security definer set search_path = public as $$
    select coalesce(nullif(e.full_name, ''), e.code)
      from public.employees e where e.code = p_code limit 1;
$$;

-- ------------------------------------------------------------
-- ٤) فەنکشنە ناوخۆییەکان دادەخرێن بۆ authenticated
-- ------------------------------------------------------------
-- `wallet_apply` و `coins_add` بنەمای جووڵەی پارەن و هیچ پشکنینێکیان
-- نییە — تەنها لە ناو wrapperـە پشکنراوەکانەوە بانگ دەکرێن (ئەوانە وەک
-- postgres کاردەکەن، بۆیە هەر دەیانگرنەوە). service_role وەک خۆی.
revoke execute on function public.wallet_apply(jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.coins_add(text, bigint, text, bigint, text, text, text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- ٥) wrapperـە پشکنراوەکان — ناسنامە لە سێرڤەرەوە
-- ------------------------------------------------------------

-- زیادکردن/کەمکردنەوەی دەستیی جزدان (submitWalletActionImpl)
create or replace function public.wallet_admin_apply(p_rows jsonb, p_lock_key text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_actor text; v_name text; r jsonb; v_code text; v_clean jsonb;
begin
    if public.p2_is_service() then
        return public.wallet_apply(p_rows, null, p_lock_key);
    end if;
    v_actor := public.current_emp_code();
    if v_actor is null then raise exception 'NOT_STAFF'; end if;
    v_name := public.p2_display_name(v_actor);

    for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
        v_code := r ->> 'user_code';
        if v_code is null then continue; end if;
        if lower(btrim(v_code)) = lower(btrim(v_actor)) and public.p2_role(v_actor) <> 'پاشا' then
            raise exception 'SELF_WALLET';
        end if;
        if not public.p2_can_manage_wallet(v_actor, v_code) then
            raise exception 'NO_PERM_WALLET: %', v_code;
        end if;
    end loop;

    -- ڕیزەکان پاک دەکرێنەوە: created_by/old/new لە براوزەرەوە متمانەی پێ ناکرێت
    select jsonb_agg(jsonb_build_object(
             'user_code',   e ->> 'user_code',
             'amount',      e ->> 'amount',
             'wallet_type', e ->> 'wallet_type',
             'type',        e ->> 'type',
             'description', e ->> 'description',
             'order_id',    e ->> 'order_id'))
      into v_clean
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) e;

    return public.wallet_apply(coalesce(v_clean, '[]'::jsonb), v_name, p_lock_key);
end;
$$;

-- پارەدانی ئۆردەر لە جزدان (syncOrderWalletPayment) — دێلتا لە سێرڤەر
create or replace function public.wallet_pay_order(
    p_order_id text, p_member_code text, p_desired numeric, p_order_code text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_actor text; v_name text; v_paid numeric; v_want numeric; v_delta numeric;
begin
    if not public.p2_is_service() then
        v_actor := public.current_emp_code();
        if v_actor is null then raise exception 'NOT_STAFF'; end if;
        if not public.p2_can_order(v_actor, p_order_id, 'edit') then
            raise exception 'NO_PERM_ORDER';
        end if;
        v_name := public.p2_display_name(v_actor);
    end if;

    v_want := greatest(0, round(coalesce(p_desired, 0)));

    -- بڕی پێشتر دراو لەم ئۆردەرە بۆ ئەم ئەندامە (جووڵەی پارەدان/گەڕانەوە)
    select coalesce(-sum(amount), 0) into v_paid
      from public.transactions
     where order_id = p_order_id and user_code = p_member_code
       and type = any (public.wallet_pay_types());

    v_delta := v_want - v_paid;
    if abs(v_delta) < 0.5 then return '[]'::jsonb; end if;

    return public.wallet_apply(
        jsonb_build_array(jsonb_build_object(
            'user_code',   p_member_code,
            'order_id',    p_order_id,
            'amount',      (-v_delta)::text,
            'wallet_type', 'balance',
            'type',        case when v_delta > 0 then (public.wallet_pay_types())[1]
                                else (public.wallet_pay_types())[2] end,
            'description', case when v_delta > 0
                                then 'پارەدان لە جزدان بۆ ئۆردەری ' || coalesce(p_order_code, p_order_id)
                                else 'گەڕانەوەی پارەی جزدان لە ئۆردەری ' || coalesce(p_order_code, p_order_id) end)),
        v_name, 'order_profit:' || p_order_id);
end;
$$;

-- پێدانی مووچە (submitSalaryImpl) — باڵانس لە سێرڤەر دەژمێردرێت
create or replace function public.pay_salary(
    p_code text, p_balance numeric, p_savings numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor text; v_name text; v_b numeric; v_s numeric; v_rows jsonb := '[]'::jsonb;
begin
    v_b := greatest(0, round(coalesce(p_balance, 0)));
    v_s := greatest(0, round(coalesce(p_savings, 0)));
    if v_b + v_s < 1 then raise exception 'BAD_AMOUNT'; end if;
    if coalesce(btrim(p_reason), '') = '' then raise exception 'NO_REASON'; end if;

    if not public.p2_is_service() then
        v_actor := public.current_emp_code();
        if v_actor is null then raise exception 'NOT_STAFF'; end if;
        if lower(btrim(p_code)) = lower(btrim(v_actor)) and public.p2_role(v_actor) <> 'پاشا' then
            raise exception 'SELF_WALLET';
        end if;
        if not public.p2_can_manage_wallet(v_actor, p_code) then
            raise exception 'NO_PERM_WALLET';
        end if;
        v_name := public.p2_display_name(v_actor);
    end if;

    if v_b > 0 then
        v_rows := v_rows || jsonb_build_object('user_code', p_code, 'amount', (-v_b)::text,
            'wallet_type', 'balance', 'type', 'پێدانی مووچە', 'description', p_reason);
    end if;
    if v_s > 0 then
        v_rows := v_rows || jsonb_build_object('user_code', p_code, 'amount', (-v_s)::text,
            'wallet_type', 'savings', 'type', 'پێدانی مووچە (پاشەکەوت)', 'description', p_reason);
    end if;

    return public.wallet_apply(v_rows, v_name, 'wallet:' || p_code);
end;
$$;

-- ڕاستکردنەوەی مێژووی جزدان (fixWalletHistoryImpl) — جیاوازی لە سێرڤەر
create or replace function public.fix_wallet_history(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_actor text; v_name text;
    v_bal numeric; v_sav numeric; v_exp_bal numeric; v_exp_sav numeric;
    v_db numeric; v_ds numeric; v_rows jsonb := '[]'::jsonb;
begin
    if not public.p2_is_service() then
        v_actor := public.current_emp_code();
        if v_actor is null then raise exception 'NOT_STAFF'; end if;
        if not public.p2_can_manage_wallet(v_actor, p_code) then
            raise exception 'NO_PERM_WALLET';
        end if;
        v_name := public.p2_display_name(v_actor);
    end if;

    select coalesce(balance, 0), coalesce(savings, 0) into v_bal, v_sav
      from public.employees where code = p_code;
    if not found then raise exception 'EMPLOYEE_NOT_FOUND'; end if;

    select coalesce(sum(amount) filter (where coalesce(nullif(wallet_type, ''), 'balance') = 'balance'), 0),
           coalesce(sum(amount) filter (where wallet_type = 'savings'), 0)
      into v_exp_bal, v_exp_sav
      from public.transactions where user_code = p_code;

    v_db := round(v_bal - v_exp_bal);
    v_ds := round(v_sav - v_exp_sav);

    if abs(v_db) >= 1 then
        v_rows := v_rows || jsonb_build_object('user_code', p_code, 'amount', v_db::text,
            'wallet_type', 'balance', 'type', 'ڕاستکردنەوەی مێژوو',
            'description', 'جیاوازی نێوان باڵانسی تۆمارکراو و کۆی جووڵەکان');
    end if;
    if abs(v_ds) >= 1 then
        v_rows := v_rows || jsonb_build_object('user_code', p_code, 'amount', v_ds::text,
            'wallet_type', 'savings', 'type', 'ڕاستکردنەوەی مێژوو',
            'description', 'جیاوازی نێوان پاشەکەوتی تۆمارکراو و کۆی جووڵەکان');
    end if;

    if v_rows = '[]'::jsonb then return '[]'::jsonb; end if;
    return public.wallet_apply(v_rows, v_name, 'wallet:' || p_code);
end;
$$;

-- دیاریکردنی ڕێژەی قازانج (saveProfitRate)
create or replace function public.set_member_profit_rate(p_code text, p_rate numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor text;
begin
    if not public.p2_is_service() then
        v_actor := public.current_emp_code();
        if v_actor is null then raise exception 'NOT_STAFF'; end if;
        if lower(btrim(p_code)) = lower(btrim(v_actor)) and public.p2_role(v_actor) <> 'پاشا' then
            raise exception 'SELF_PROFIT';
        end if;
        if not public.p2_can_set_profit(v_actor, p_code) then
            raise exception 'NO_PERM_PROFIT';
        end if;
    end if;
    update public.employees set profit_rate = p_rate where code = p_code;
    if not found then raise exception 'EMPLOYEE_NOT_FOUND'; end if;
end;
$$;

-- ------------------------------------------------------------
-- ٦) فەنکشنە ئاماژەپێکراوەکان: ناسنامەی ڕاستەقینە بەکاردەهێنن
-- ------------------------------------------------------------

-- قازانجی ئۆردەر — تەنها ئەوەی ڕێگەی دابەشکردنی هەیە لەسەر ئەم ئۆردەرە
create or replace function public.distribute_order_profit(
    p_order_id text, p_rows jsonb, p_created_by text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_net numeric; v_actor text; v_name text := p_created_by;
begin
    if not public.p2_is_service() then
        v_actor := public.current_emp_code();
        if v_actor is null then raise exception 'NOT_STAFF'; end if;
        if not public.p2_can_order(v_actor, p_order_id, 'distribute') then
            raise exception 'NO_PERM_DISTRIBUTE';
        end if;
        v_name := public.p2_display_name(v_actor);
    end if;

    perform pg_advisory_xact_lock(hashtext('order_profit:' || p_order_id));
    v_net := public.order_profit_net(p_order_id);
    if v_net > 0.01 then raise exception 'ALREADY_DISTRIBUTED'; end if;

    return public.wallet_apply(p_rows, v_name, null);
end;
$$;

-- گەڕانەوەی قازانجی ئۆردەر — تەنها ئەوەی ڕێگەی گۆڕینی حاڵەتی هەیە
create or replace function public.return_order_profit(
    p_order_id text, p_created_by text default null, p_description text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    g record; v_old numeric; v_new numeric; v_out jsonb := '[]'::jsonb;
    v_actor text; v_name text := p_created_by;
begin
    if not public.p2_is_service() then
        v_actor := public.current_emp_code();
        if v_actor is null then raise exception 'NOT_STAFF'; end if;
        if not public.p2_can_order(v_actor, p_order_id, 'status') then
            raise exception 'NO_PERM_STATUS';
        end if;
        v_name := public.p2_display_name(v_actor);
    end if;

    perform pg_advisory_xact_lock(hashtext('order_profit:' || p_order_id));

    for g in
        select user_code,
               coalesce(nullif(wallet_type, ''),
                        case when type = 'پاشەکەوتی ئۆردەر' then 'savings' else 'balance' end) as w,
               sum(amount) as net
          from public.transactions
         where order_id = p_order_id
           and type <> all (public.wallet_pay_types())
         group by 1, 2
        having abs(sum(amount)) >= 0.01
    loop
        if g.w = 'savings' then
            update public.employees set savings = coalesce(savings, 0) - g.net
             where code = g.user_code
            returning coalesce(savings, 0) + g.net, coalesce(savings, 0) into v_old, v_new;
        else
            update public.employees set balance = coalesce(balance, 0) - g.net
             where code = g.user_code
            returning coalesce(balance, 0) + g.net, coalesce(balance, 0) into v_old, v_new;
        end if;
        if not found then continue; end if;

        insert into public.transactions
          (user_code, amount, type, description, order_id, created_by, wallet_type, old_balance, new_balance)
        values
          (g.user_code, -g.net, 'گەڕانەوەی ئۆردەر',
           coalesce(p_description, 'گەڕانەوەی ئۆردەر'), p_order_id, v_name, g.w, v_old, v_new);

        v_out := v_out || jsonb_build_object('user_code', g.user_code, 'wallet_type', g.w, 'amount', -g.net);
    end loop;

    return v_out;
end;
$$;

-- بەخشینی خاڵ — تەنها پاشا (ناسنامەی ڕاستەقینە، نەک p_viewer)
create or replace function public.coins_grant(
    p_viewer text, p_user text, p_amount bigint, p_note text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_actor text;
begin
    if not public.p2_is_service() then
        v_actor := public.current_emp_code();
        if v_actor is null or public.p2_role(v_actor) <> 'پاشا' then
            raise exception 'NOT_ALLOWED: تەنها پاشا دەتوانێت';
        end if;
    else
        v_actor := coalesce(p_viewer, 'service');
    end if;
    if coalesce(p_amount, 0) = 0 then return 0; end if;
    return public.coins_add(p_user, p_amount, 'grant', null, null, p_note, v_actor);
end $$;

-- کڕینی جوانکاری — بە ناسنامەی ڕاستەقینە (p_viewer نامێنێت متمانەی پێ بکرێت)
create or replace function public.cosmetic_buy(p_viewer text, p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c public.cosmetics%rowtype; v_coins bigint; v_king boolean; v_viewer text;
begin
    if public.p2_is_service() then
        v_viewer := p_viewer;
    else
        v_viewer := public.current_emp_code();
        if v_viewer is null then return jsonb_build_object('ok', false, 'error', 'NO_USER'); end if;
    end if;

    if not public.shop_can_use(v_viewer) then
        return jsonb_build_object('ok', false, 'error', 'NOT_ALLOWED');
    end if;

    select * into v_c from public.cosmetics where id = p_id;
    if v_c.id is null then return jsonb_build_object('ok', false, 'error', 'NO_ITEM'); end if;

    select (role = 'پاشا') into v_king from public.employees where code = v_viewer;
    if v_king is null then return jsonb_build_object('ok', false, 'error', 'NO_USER'); end if;

    if v_king then
        return jsonb_build_object('ok', true, 'free', true, 'id', p_id,
                                  'coins', (select coins from public.employees where code = v_viewer));
    end if;

    if not v_c.active or (v_c.until is not null and v_c.until < current_date) then
        return jsonb_build_object('ok', false, 'error', 'GONE');
    end if;

    select coins into v_coins from public.employees where code = v_viewer for update;

    if exists (select 1 from public.user_cosmetics
                where user_code = v_viewer and cosmetic_id = p_id) then
        return jsonb_build_object('ok', true, 'already', true, 'coins', v_coins);
    end if;
    if v_coins < v_c.price then
        return jsonb_build_object('ok', false, 'error', 'NO_COINS', 'coins', v_coins, 'need', v_c.price);
    end if;

    insert into public.user_cosmetics (user_code, cosmetic_id, price_paid)
    values (v_viewer, p_id, v_c.price) on conflict do nothing;
    perform public.coins_add(v_viewer, -v_c.price, 'buy', null, p_id, v_c.name, v_viewer);

    select coins into v_coins from public.employees where code = v_viewer;
    return jsonb_build_object('ok', true, 'coins', v_coins, 'id', p_id);
end $$;

-- ناوەڕۆکی ڕەسەنی وەرگرتنی خەڵات — ناوخۆیی، تەنها لە wrapperـەوە بانگ دەکرێت
create or replace function public.claim_reward_impl(
    p_claim_id uuid, p_user_code text, p_customer jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp record; v_c record; v_king record;
  v_creator text; v_name text; v_phone text; v_city text; v_addr text;
  v_date text; v_ocode text; v_order_id bigint;
begin
  select code, full_name, coalesce(suspended, false) as suspended
    into v_emp from public.employees where code = p_user_code;
  if v_emp.code is null then raise exception 'NOT_ALLOWED: ناسنامە نەدۆزرایەوە'; end if;
  if v_emp.suspended then raise exception 'NOT_ALLOWED: ئەکاونتەکە ڕاگیراوە'; end if;
  if not public.reward_can_use(p_user_code) then
    raise exception 'NOT_ALLOWED: دەسەڵاتی چاڵنج و ئاڕپیت نییە';
  end if;

  perform pg_advisory_xact_lock(hashtext('reward:' || p_claim_id::text));

  update public.reward_claims
     set status = 'claimed', claimed_at = clock_timestamp()
   where id = p_claim_id and user_code = p_user_code and status = 'earned'
   returning * into v_c;
  if v_c.id is null then
    raise exception 'ALREADY_CLAIMED: ئەم خەڵاتە پێشتر وەرگیراوە یان بوونی نییە';
  end if;
  if not public.reward_claim_ok(p_claim_id) then
    raise exception 'NOT_ELIGIBLE: چیتر شایستەی ئەم خەڵاتە نیت — ئۆردەرێک گەڕاوەتەوە';
  end if;

  if v_c.reward_kind = 'money' then
    if coalesce(v_c.reward_amount, 0) <= 0 then
      raise exception 'BAD_REWARD: بڕی خەڵاتەکە دیاری نەکراوە';
    end if;
    perform public.wallet_apply(
      jsonb_build_array(jsonb_build_object(
        'user_code', p_user_code, 'amount', v_c.reward_amount, 'wallet_type', 'balance',
        'type', case when v_c.source = 'challenge' then 'خەڵاتی چاڵنج' else 'خەڵاتی ئاڕپی' end,
        'description', coalesce(v_c.reward_title, 'خەڵات'))),
      coalesce(v_emp.full_name, p_user_code), null);
    return jsonb_build_object('ok', true, 'kind', 'money', 'amount', v_c.reward_amount);
  end if;

  if v_c.reward_kind = 'product' then
    v_name  := btrim(coalesce(p_customer->>'name', ''));
    v_phone := regexp_replace(coalesce(p_customer->>'phone', ''), '[^0-9]', '', 'g');
    v_city  := btrim(coalesce(p_customer->>'city', ''));
    v_addr  := btrim(coalesce(p_customer->>'address', ''));
    if length(v_phone) < 10 then raise exception 'BAD_PHONE: ژمارەی مۆبایل تەواو نییە'; end if;
    if v_city = '' then raise exception 'BAD_CITY: شار پێویستە'; end if;

    select coalesce(
             (select c.created_by from public.challenges  c where c.id = v_c.challenge_id),
             (select s.created_by from public.pass_seasons s where s.id = v_c.season_id))
      into v_creator;
    select e.code, coalesce(nullif(e.receipt_name, ''), e.full_name, e.code) as rname
      into v_king from public.employees e where e.code = v_creator and e.role = 'پاشا';
    if v_king.code is null then
      select e.code, coalesce(nullif(e.receipt_name, ''), e.full_name, e.code) as rname
        into v_king from public.employees e where e.role = 'پاشا' order by e.code limit 1;
    end if;
    if v_king.code is null then raise exception 'NO_KING: هیچ پاشایەک نەدۆزرایەوە'; end if;

    v_date  := to_char(now() at time zone 'Asia/Baghdad', 'YYYY-MM-DD HH12:MI:SS AM');
    v_ocode := v_king.code || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 5));

    insert into public.orders (
      date, seller_name, seller_code, seller_manager, seller_admin, seller_consultant,
      postal_code, address, city, customer_name, phone1, phone2, socials,
      item_names, item_qtys, item_prices, image_url, items_total, delivery_price,
      grand_total, amount_received, prepaid_amount, payment_method, payment_proof_url,
      member_profit, gift_names, gift_qtys, gift_prices, gift_total, notes,
      order_code, source, tg_info, status, reward_claim_id
    ) values (
      v_date, v_king.rname, v_king.code, null, null, null, null,
      case when v_addr <> '' then v_city || ' - ' || v_addr else v_city end,
      v_city, v_name, v_phone, '', '',
      coalesce(v_c.reward_product, 'خەڵات'), '1', '0',
      coalesce(v_c.reward_image, ''), 0, 0, 0, 0, 0, null, null,
      0, '', '', '', 0,
      'خەڵاتی چاڵنج بۆ ' || coalesce(v_emp.full_name, p_user_code) || ' — ' || coalesce(v_c.reward_title, ''),
      v_ocode, 'خەڵات', '', 'ئامادە دەکرێت', p_claim_id
    ) returning id into v_order_id;

    update public.reward_claims
       set claimed_order_id = v_order_id, delivery_name = v_name, delivery_phone = v_phone,
           delivery_city = v_city, delivery_address = v_addr
     where id = p_claim_id;

    insert into public.order_logs
           (order_id, order_code, action, detail, from_status, to_status, user_code, user_name)
    values (v_order_id::text, v_ocode, 'create',
            'خەڵاتی چاڵنج — ' || coalesce(v_c.reward_title, ''),
            null, 'ئامادە دەکرێت', p_user_code, coalesce(v_emp.full_name, p_user_code));

    return jsonb_build_object('ok', true, 'kind', 'product', 'order_id', v_order_id, 'order_code', v_ocode);
  end if;

  if v_c.reward_kind = 'cosmetic' then
    declare v_cid text := btrim(coalesce(v_c.reward_product, '')); v_cname text; v_ckind text; v_crole text;
    begin
      if v_cid = '' then raise exception 'BAD_REWARD: جوانکارییەکە دیاری نەکراوە'; end if;
      select c.name, c.kind into v_cname, v_ckind from public.cosmetics c where c.id = v_cid and c.active;
      if v_cname is null then raise exception 'NO_COSMETIC: ئەم جوانکارییە چیتر بەردەست نییە'; end if;
      select e.role into v_crole from public.employees e where e.code = p_user_code;
      if coalesce(v_crole, '') <> 'پاشا' then
        insert into public.user_cosmetics (user_code, cosmetic_id, price_paid)
        values (p_user_code, v_cid, 0) on conflict (user_code, cosmetic_id) do nothing;
        if found then update public.reward_claims set cosmetic_granted = true where id = v_c.id; end if;
      end if;
      return jsonb_build_object('ok', true, 'kind', 'cosmetic', 'id', v_cid, 'name', v_cname, 'cos_kind', v_ckind);
    end;
  end if;

  raise exception 'BAD_REWARD: ئەم جۆرە خەڵاتە هێشتا پشتگیری ناکرێت';
end $$;
revoke execute on function public.claim_reward_impl(uuid,text,jsonb) from public, anon, authenticated;

-- وەرگرتنی خەڵات — تەنها بۆ خودی خۆت (p_user_code دەبێت = ناسنامەی ڕاستەقینە)
create or replace function public.claim_reward(
    p_claim_id uuid, p_user_code text, p_customer jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor text;
begin
    if not public.p2_is_service() then
        v_actor := public.current_emp_code();
        if v_actor is null or lower(btrim(coalesce(p_user_code, ''))) <> lower(btrim(v_actor)) then
            raise exception 'NOT_ALLOWED: تەنها بۆ خۆت';
        end if;
    end if;
    return public.claim_reward_impl(p_claim_id, p_user_code, p_customer);
end $$;

-- ------------------------------------------------------------
-- ٧) ستوونە پارەییەکان لە نووسینی ڕاستەوخۆ دادەخرێن
-- ------------------------------------------------------------
-- authenticated ئیتر ناتوانێت balance/savings/profit_rate/coins
-- ڕاستەوخۆ بگۆڕێت — تەنها لە ڕێگەی wrapperـە پشکنراوەکانەوە.
-- (ستوونەکانی تر وەک خۆیان — ئەوانە بەشەکانی تری قۆناغی ٢ن.)
revoke update on public.employees from authenticated;
grant update (
    code, password, full_name, role, manager, admin, consultant, creator, date,
    telegram_status, telegram_id, telegram_username, telegram_name,
    permissions, avatar, receipt_name, postal_code, notif_prefs, rank_prefs,
    suspended, suspended_at, suspended_by, session_epoch, auth_user_id
) on public.employees to authenticated;

-- دروستکردنی کلیل (generateCode) ستوونە پارەییەکان دانانێت — بۆیە
-- INSERTـیش بۆ ئەوان دادەخرێت، نەک کەس کلیلێکی نوێ بە باڵانسی گەورەوە
-- دروست بکات.
revoke insert on public.employees from authenticated;
grant insert (
    code, password, full_name, role, manager, admin, consultant, creator, date,
    telegram_status, telegram_id, telegram_username, telegram_name,
    permissions, avatar, receipt_name, postal_code, notif_prefs, rank_prefs,
    suspended, suspended_at, suspended_by, session_epoch, auth_user_id
) on public.employees to authenticated;

-- خشتەکانی پارە: نووسین تەنها لە ڕێگەی فەنکشنەوە (خوێندنەوە وەک خۆی)
revoke insert, update, delete on public.transactions   from authenticated;
revoke insert, update, delete on public.coin_ledger     from authenticated;
revoke insert, update, delete on public.user_cosmetics  from authenticated;

-- ------------------------------------------------------------
-- ٨) دەسەڵاتی بەکارهێنان
-- ------------------------------------------------------------
do $$
declare f text;
begin
    foreach f in array array[
        'public.p2_is_service()', 'public.p2_role(text)', 'public.p2_tier_of(text)',
        'public.p2_default_scope(text,text)', 'public.p2_scope(text,text)',
        'public.p2_tier_val(text,text)', 'public.p2_in_team(text,text)',
        'public.p2_in_line(text,text)', 'public.p2_tier_ok(text,text,text)',
        'public.p2_can_manage_wallet(text,text)', 'public.p2_can_set_profit(text,text)',
        'public.p2_can_order(text,text,text)', 'public.p2_display_name(text)',
        'public.wallet_admin_apply(jsonb,text)',
        'public.wallet_pay_order(text,text,numeric,text)',
        'public.pay_salary(text,numeric,numeric,text)',
        'public.fix_wallet_history(text)',
        'public.set_member_profit_rate(text,numeric)'
    ] loop
        execute format('revoke execute on function %s from public, anon', f);
        execute format('grant  execute on function %s to authenticated, service_role', f);
    end loop;
end $$;

-- distribute/return/coins_grant/cosmetic_buy/claim_reward: وەک خۆیان بۆ
-- authenticated دەمێننەوە (ناوەکانیان نەگۆڕاون؛ تەنها ناوەڕۆک گۆڕاوە)
grant execute on function public.distribute_order_profit(text,jsonb,text) to authenticated, service_role;
grant execute on function public.return_order_profit(text,text,text)     to authenticated, service_role;
grant execute on function public.coins_grant(text,text,bigint,text)      to authenticated, service_role;
grant execute on function public.cosmetic_buy(text,text)                 to authenticated, service_role;
grant execute on function public.claim_reward(uuid,text,jsonb)           to authenticated, service_role;

notify pgrst, 'reload schema';
commit;

-- ------------------------------------------------------------
-- پشکنین دوای جێبەجێکردن (دەبێت هەمووی ڕاست بێت):
-- ------------------------------------------------------------
--  select has_function_privilege('authenticated','public.wallet_apply(jsonb,text,text)','execute') = false as wallet_apply_locked;
--  select has_column_privilege('authenticated','public.employees','balance','update') = false as balance_locked;
--  select has_table_privilege('authenticated','public.transactions','insert') = false as tx_insert_locked;
