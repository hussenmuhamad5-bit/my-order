-- ============================================================
--  ١١٠ — گەڕانەوە (rollback): دۆخی پێش `110_money_guard.sql`
-- ------------------------------------------------------------
--  ⚠️ ئەمە پاراستنی پارە لادەبات: دیسان هەر کارمەندێک دەیتوانی
--     باڵانس/خاڵ/قازانجی هەر کەسێک بگۆڕێت. تەنها وەک هەنگاوی
--     کاتی بەکاری بهێنە ئەگەر شتێک تێکچوو.
-- ============================================================

begin;

-- ١) دەسەڵاتی ڕاستەوخۆی نووسین دەگەڕێنەوە
grant update, insert on public.employees to authenticated;
grant insert, update, delete on public.transactions  to authenticated;
grant insert, update, delete on public.coin_ledger    to authenticated;
grant insert, update, delete on public.user_cosmetics to authenticated;

grant execute on function public.wallet_apply(jsonb, text, text) to authenticated, service_role;
grant execute on function public.coins_add(text, bigint, text, bigint, text, text, text) to authenticated, service_role;

-- ٢) فەنکشنە ئاماژەپێکراوەکان بۆ دۆخی ڕەسەنیان (بێ پشکنین / متمانە بە پارامەتەر)
create or replace function public.distribute_order_profit(p_order_id text, p_rows jsonb, p_created_by text default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_net numeric;
begin
  perform pg_advisory_xact_lock(hashtext('order_profit:' || p_order_id));
  v_net := public.order_profit_net(p_order_id);
  if v_net > 0.01 then raise exception 'ALREADY_DISTRIBUTED'; end if;
  return public.wallet_apply(p_rows, p_created_by, null);
end; $$;

create or replace function public.return_order_profit(p_order_id text, p_created_by text default null, p_description text default null)
returns jsonb language plpgsql set search_path = public as $$
declare g record; v_old numeric; v_new numeric; v_out jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('order_profit:' || p_order_id));
  for g in
    select user_code,
           coalesce(nullif(wallet_type, ''), case when type = 'پاشەکەوتی ئۆردەر' then 'savings' else 'balance' end) as w,
           sum(amount) as net
      from public.transactions
     where order_id = p_order_id and type <> all (public.wallet_pay_types())
     group by 1, 2 having abs(sum(amount)) >= 0.01
  loop
    if g.w = 'savings' then
      update public.employees set savings = coalesce(savings,0) - g.net where code = g.user_code
        returning coalesce(savings,0) + g.net, coalesce(savings,0) into v_old, v_new;
    else
      update public.employees set balance = coalesce(balance,0) - g.net where code = g.user_code
        returning coalesce(balance,0) + g.net, coalesce(balance,0) into v_old, v_new;
    end if;
    if not found then continue; end if;
    insert into public.transactions (user_code, amount, type, description, order_id, created_by, wallet_type, old_balance, new_balance)
    values (g.user_code, -g.net, 'گەڕانەوەی ئۆردەر', coalesce(p_description, 'گەڕانەوەی ئۆردەر'), p_order_id, p_created_by, g.w, v_old, v_new);
    v_out := v_out || jsonb_build_object('user_code', g.user_code, 'wallet_type', g.w, 'amount', -g.net);
  end loop;
  return v_out;
end; $$;

create or replace function public.coins_grant(p_viewer text, p_user text, p_amount bigint, p_note text default null)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  perform public.reward_assert_king(p_viewer);
  if coalesce(p_amount, 0) = 0 then return 0; end if;
  return public.coins_add(p_user, p_amount, 'grant', null, null, p_note, p_viewer);
end $$;

create or replace function public.cosmetic_buy(p_viewer text, p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c public.cosmetics%rowtype; v_coins bigint; v_king boolean;
begin
  if not public.shop_can_use(p_viewer) then return jsonb_build_object('ok', false, 'error', 'NOT_ALLOWED'); end if;
  select * into v_c from public.cosmetics where id = p_id;
  if v_c.id is null then return jsonb_build_object('ok', false, 'error', 'NO_ITEM'); end if;
  select (role = 'پاشا') into v_king from public.employees where code = p_viewer;
  if v_king is null then return jsonb_build_object('ok', false, 'error', 'NO_USER'); end if;
  if v_king then return jsonb_build_object('ok', true, 'free', true, 'id', p_id,
      'coins', (select coins from public.employees where code = p_viewer)); end if;
  if not v_c.active or (v_c.until is not null and v_c.until < current_date) then
    return jsonb_build_object('ok', false, 'error', 'GONE'); end if;
  select coins into v_coins from public.employees where code = p_viewer for update;
  if exists (select 1 from public.user_cosmetics where user_code = p_viewer and cosmetic_id = p_id) then
    return jsonb_build_object('ok', true, 'already', true, 'coins', v_coins); end if;
  if v_coins < v_c.price then
    return jsonb_build_object('ok', false, 'error', 'NO_COINS', 'coins', v_coins, 'need', v_c.price); end if;
  insert into public.user_cosmetics (user_code, cosmetic_id, price_paid) values (p_viewer, p_id, v_c.price) on conflict do nothing;
  perform public.coins_add(p_viewer, -v_c.price, 'buy', null, p_id, v_c.name, p_viewer);
  select coins into v_coins from public.employees where code = p_viewer;
  return jsonb_build_object('ok', true, 'coins', v_coins, 'id', p_id);
end $$;

-- claim_reward ڕەسەن (SECURITY INVOKER، متمانە بە p_user_code) — لە
-- `claim_reward_impl`ـەوە (ناوەڕۆکەکەی هەمانە) دروست دەکرێتەوە
create or replace function public.claim_reward(p_claim_id uuid, p_user_code text, p_customer jsonb default null)
returns jsonb language plpgsql set search_path = public as $$
begin
  return public.claim_reward_impl(p_claim_id, p_user_code, p_customer);
end $$;
grant execute on function public.claim_reward_impl(uuid,text,jsonb) to authenticated, service_role;

-- ٣) wrapperـە نوێیەکان و هێلپەرەکان لادەبرێن
drop function if exists public.wallet_admin_apply(jsonb, text);
drop function if exists public.wallet_pay_order(text, text, numeric, text);
drop function if exists public.pay_salary(text, numeric, numeric, text);
drop function if exists public.fix_wallet_history(text);
drop function if exists public.set_member_profit_rate(text, numeric);

drop function if exists public.p2_can_order(text, text, text);
drop function if exists public.p2_can_manage_wallet(text, text);
drop function if exists public.p2_can_set_profit(text, text);
drop function if exists public.p2_tier_ok(text, text, text);
drop function if exists public.p2_in_team(text, text);
drop function if exists public.p2_in_line(text, text);
drop function if exists public.p2_tier_val(text, text);
drop function if exists public.p2_scope(text, text);
drop function if exists public.p2_default_scope(text, text);
drop function if exists public.p2_tier_of(text);
drop function if exists public.p2_role(text);
drop function if exists public.p2_display_name(text);
drop function if exists public.p2_is_service();
drop view if exists public.p2_parent;

commit;
