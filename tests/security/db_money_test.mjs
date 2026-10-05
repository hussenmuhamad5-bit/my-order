// db/110_money_guard.sql لە PGlite — پاراستنی پارە لەسەر سێرڤەر.
// هیچ پەیوەندییەک بە داتابەیسی ڕاستەقینەوە نییە.  ڕاکردن لەناو ئەم فۆڵدەرە:
//   node db_money_test.mjs   (یان بەشێکی `npm test`)
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const MIG = fs.readFileSync(`${REPO}/db/110_money_guard.sql`, 'utf8');
const RB = fs.readFileSync(`${REPO}/db/110_money_guard_rollback.sql`, 'utf8');

// ئامێرەکانی prod کە db/110 پشتی پێ دەبەستێت (هەمان ناوەڕۆک).
const PREREQ = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create table public.employees (
  code text primary key, password text not null default '', full_name text, role text,
  manager text default '', admin text default '', consultant text default '', creator text default '',
  date text, telegram_status text, telegram_id text, telegram_username text, telegram_name text,
  balance numeric default 0, savings numeric default 0, profit_rate numeric default 0, coins bigint default 0,
  permissions jsonb, avatar text, receipt_name text, postal_code text, notif_prefs jsonb, rank_prefs jsonb,
  suspended boolean not null default false, suspended_at timestamptz, suspended_by text,
  session_epoch int not null default 0, auth_user_id uuid);

create table public.orders (id bigserial primary key, seller_code text, status text,
  seller_manager text, seller_admin text, seller_consultant text, order_code text, reward_claim_id uuid,
  date text, seller_name text, postal_code text, address text, city text, customer_name text,
  phone1 text, phone2 text, socials text, item_names text, item_qtys text, item_prices text,
  image_url text, items_total numeric, delivery_price numeric, grand_total numeric,
  amount_received numeric, prepaid_amount numeric, payment_method text, payment_proof_url text,
  member_profit numeric, gift_names text, gift_qtys text, gift_prices text, gift_total numeric,
  notes text, source text, tg_info text);

create table public.transactions (id bigserial primary key, user_code text, amount numeric, type text,
  description text, order_id text, created_by text, wallet_type text, old_balance numeric, new_balance numeric);

create table public.coin_ledger (id uuid primary key default gen_random_uuid(), user_code text, amount bigint,
  reason text, order_id bigint, item_id text, note text, created_by text);

create table public.cosmetics (id text primary key, name text, kind text, rarity text, price bigint,
  active boolean default true, until date);
create table public.user_cosmetics (user_code text, cosmetic_id text, price_paid bigint,
  unique(user_code, cosmetic_id));
create table public.reward_claims (id uuid primary key default gen_random_uuid(), user_code text,
  status text, reward_kind text, reward_amount numeric, reward_title text, source text,
  challenge_id uuid, season_id uuid, reward_product text, reward_image text, claimed_at timestamptz,
  claimed_order_id bigint, delivery_name text, delivery_phone text, delivery_city text,
  delivery_address text, cosmetic_granted boolean);
create table public.order_logs (id bigserial primary key, order_id text, order_code text, action text,
  detail text, from_status text, to_status text, user_code text, user_name text);
create table public.challenges (id uuid primary key, created_by text);
create table public.pass_seasons (id uuid primary key, created_by text);

-- RLS وەک دۆخی دوای db/100: authenticated هەمووی دەبینێت/دەنووسێت (پێش db/110)
do $$ declare t text; begin
  foreach t in array array['employees','orders','transactions','coin_ledger','user_cosmetics',
                           'cosmetics','reward_claims','order_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop; end $$;

-- ناسنامەی ڕاستەقینە بۆ تێست: لە GUCـەوە (لە prod: auth.uid)
create function public.current_emp_code() returns text language sql stable
  set search_path = public as $$ select nullif(current_setting('test.actor', true), '') $$;

-- ئامێرە پارەییە ڕەسەنەکان (هەمان ناوەڕۆکی prod)
create function public.wallet_pay_types() returns text[] language sql immutable as $$
  select array['پارەدانی ئۆردەر لە جزدان', 'گەڕانەوەی پارەی جزدان'] $$;

create function public.wallet_apply(p_rows jsonb, p_created_by text default null, p_lock_key text default null)
returns jsonb language plpgsql set search_path = public as $$
declare r jsonb; v_code text; v_amt numeric; v_wallet text; v_old numeric; v_new numeric; v_out jsonb := '[]'::jsonb;
begin
  if p_lock_key is not null then perform pg_advisory_xact_lock(hashtext(p_lock_key)); end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_code := r->>'user_code'; v_amt := coalesce((r->>'amount')::numeric, 0);
    v_wallet := coalesce(nullif(r->>'wallet_type', ''), 'balance');
    if v_code is null or v_amt = 0 then continue; end if;
    if v_wallet = 'savings' then
      update public.employees set savings = coalesce(savings,0)+v_amt where code=v_code
        returning coalesce(savings,0)-v_amt, coalesce(savings,0) into v_old, v_new;
    else
      update public.employees set balance = coalesce(balance,0)+v_amt where code=v_code
        returning coalesce(balance,0)-v_amt, coalesce(balance,0) into v_old, v_new;
    end if;
    if not found then raise exception 'EMPLOYEE_NOT_FOUND: %', v_code; end if;
    insert into public.transactions (user_code, amount, type, description, order_id, created_by, wallet_type, old_balance, new_balance)
    values (v_code, v_amt, r->>'type', r->>'description', nullif(r->>'order_id',''),
            coalesce(r->>'created_by', p_created_by), v_wallet, v_old, v_new);
    v_out := v_out || jsonb_build_object('user_code', v_code, 'wallet_type', v_wallet, 'old_balance', v_old, 'new_balance', v_new);
  end loop;
  return v_out;
end $$;

create function public.coins_add(p_user_code text, p_amount bigint, p_reason text,
  p_order_id bigint default null, p_item_id text default null, p_note text default null, p_by text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_user_code is null or coalesce(p_amount,0) = 0 then return 0; end if;
  insert into public.coin_ledger (user_code, amount, reason, order_id, item_id, note, created_by)
  values (p_user_code, p_amount, p_reason, p_order_id, p_item_id, p_note, p_by)
  on conflict do nothing returning id into v_id;
  if v_id is null then return 0; end if;
  update public.employees set coins = coins + p_amount where code = p_user_code;
  return p_amount;
end $$;

create function public.order_profit_net(p_order_id text) returns numeric language sql stable set search_path = public as $$
  select coalesce(sum(amount), 0) from public.transactions
   where order_id = p_order_id and type <> all (public.wallet_pay_types()) $$;
create function public.shop_can_use(p text) returns boolean language sql stable set search_path = public as $$
  select case when e.role='پاشا' then true when e.permissions is null then true
              when not (e.permissions ? 'use_shop') then true
              else coalesce((e.permissions->>'use_shop')::boolean, true) end
    from public.employees e where e.code = p $$;
create function public.reward_can_use(p text) returns boolean language sql stable as $$ select true $$;
create function public.reward_claim_ok(p uuid) returns boolean language sql stable as $$ select true $$;

-- تیمەکان:
--   KING(پاشا) → MGR(بەڕێوەبەر) → SUP(سەرپەرشت) → MEM(ئەندام)
--   MGR2(بەڕێوەبەر) → OUT(ئەندام)   [دارێکی جیا]
insert into public.employees (code, role, full_name, manager, admin, consultant, creator, permissions) values
  ('KING', 'پاشا',      'King',  '',     '',    '',   '',     null),
  ('MGR',  'بەڕێوەبەر', 'Mgr',   '',     '',    '',   'KING',
     '{"view_orders":"team","create_key":true,"manage_wallets":"team","view_wallets":"team","set_profit_rates":"team","distribute":"team","change_status":"team"}'),
  ('SUP',  'سەرپەرشت',  'Sup',   'MGR',  '',    '',   'MGR',  '{"view_orders":"team","change_status":"team"}'),
  ('MEM',  'ئەندام',    'Mem',   'MGR',  'SUP', '',   'SUP',  null),
  ('MGR2', 'بەڕێوەبەر', 'Mgr2',  '',     '',    '',   'KING', '{"view_orders":"team","manage_wallets":"team"}'),
  ('OUT',  'ئەندام',    'Out',   'MGR2', '',    '',   'MGR2', null);
update public.employees set balance = 1000, savings = 500, coins = 100;
insert into public.orders (seller_code, status) values ('MEM','ئامادە دەکرێت'),('OUT','ئامادە دەکرێت');
insert into public.cosmetics (id, name, kind, price, active) values ('hat1','Hat','hat',50,true);
`;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✔', n); } else { fail++; console.log('  ✘', n, x !== undefined ? JSON.stringify(x).slice(0, 300) : ''); } };

const db = new PGlite();
await db.exec(PREREQ);
await db.exec(MIG);

// کردارێک وەک ڕۆڵ + ناسنامەی دیاریکراو
async function as(role, actor, sql, params) {
  const claims = JSON.stringify(role ? { role } : {});
  await db.exec(`reset role; select set_config('request.jwt.claims', '${claims.replace(/'/g, "''")}', false);
                 select set_config('test.actor', '${(actor || '').replace(/'/g, "''")}', false); set role ${role || 'authenticated'};`);
  try { const r = await db.query(sql, params); return { rows: r.rows }; }
  catch (e) { return { error: e.message }; }
  finally { await db.exec('reset role;'); }
}
const val = async (sql) => { await db.exec('reset role;'); const r = await db.query(sql); return r.rows[0]; };
const bal = async (code) => Number((await val(`select balance, savings, coins from employees where code='${code}'`)).balance);
const coins = async (code) => Number((await val(`select coins from employees where code='${code}'`)).coins);

console.log('\nPERMISSION ENGINE (team / line / wallet / profit)');
let r;
r = await val(`select public.p2_in_team('MGR','MEM') a, public.p2_in_team('MGR','SUP') b, public.p2_in_team('MGR','OUT') c, public.p2_in_team('MGR','MGR') d`);
ok('team(MGR) = {MGR,SUP,MEM}, excludes OUT', r.a && r.b && !r.c && r.d, r);
r = await val(`select public.p2_in_team('SUP','MGR') a, public.p2_in_team('MEM','SUP') b`);
ok('team includes superiors (SUP→MGR, MEM→SUP)', r.a && r.b, r);
r = await val(`select public.p2_can_manage_wallet('KING','MEM') a, public.p2_can_manage_wallet('MGR','MEM') b,
                      public.p2_can_manage_wallet('MGR','OUT') c, public.p2_can_manage_wallet('MEM','SUP') d,
                      public.p2_can_manage_wallet('MGR2','OUT') e`);
ok('manage_wallet: King✓ MGR→MEM✓ MGR→OUT✗ MEM→SUP✗ MGR2→OUT✓', r.a && r.b && !r.c && !r.d && r.e, r);
r = await val(`select public.p2_can_set_profit('MGR','MEM') a, public.p2_can_set_profit('MGR','OUT') b, public.p2_can_set_profit('MEM','SUP') c`);
ok('set_profit: MGR→MEM✓ MGR→OUT✗ MEM→SUP✗', r.a && !r.b && !r.c, r);

console.log('\nTIER CAP (wm_mem = off blocks an otherwise-allowed manager)');
await db.exec(`update employees set permissions = permissions || '{"wm_mem":"off"}' where code='MGR'`);
ok('MGR can no longer manage MEM once wm_mem=off', !(await val(`select public.p2_can_manage_wallet('MGR','MEM') a`)).a);
await db.exec(`update employees set permissions = permissions - 'wm_mem' where code='MGR'`);
ok('…and can again when the cap is removed', (await val(`select public.p2_can_manage_wallet('MGR','MEM') a`)).a);

console.log('\nDIRECT WRITES ARE LOCKED FOR authenticated');
r = await as('authenticated', 'MGR', `update employees set balance = 999999 where code='MEM'`);
ok('cannot update balance directly', !!r.error && /permission denied/i.test(r.error), r.error);
r = await as('authenticated', 'MGR', `update employees set coins = 999999 where code='MGR'`);
ok('cannot update coins directly', !!r.error, r.error);
r = await as('authenticated', 'MGR', `update employees set profit_rate = 99 where code='MEM'`);
ok('cannot update profit_rate directly', !!r.error, r.error);
r = await as('authenticated', 'MGR', `update employees set full_name = 'x' where code='MEM'`);
ok('CAN still update a non-money column (full_name)', !r.error, r.error);
r = await as('authenticated', 'MGR', `insert into transactions (user_code, amount) values ('MGR', 1)`);
ok('cannot insert transactions directly', !!r.error, r.error);
r = await as('authenticated', 'MGR', `insert into employees (code, balance) values ('HACK', 1000000)`);
ok('cannot create an employee with a balance', !!r.error, r.error);
r = await as('authenticated', 'MGR', `select public.wallet_apply('[{"user_code":"MGR","amount":1}]'::jsonb)`);
ok('cannot call wallet_apply directly', !!r.error, r.error);
r = await as('authenticated', 'MGR', `select public.coins_add('MGR', 1000, 'hack')`);
ok('cannot call coins_add directly', !!r.error, r.error);

console.log('\nSALARY (pay_salary) — real caller, team + self rules');
const memBefore = await bal('MEM');
r = await as('authenticated', 'MGR', `select public.pay_salary('MEM', 100, 0, 'salary')`);
ok('MGR pays MEM salary', !r.error && (await bal('MEM')) === memBefore - 100, r.error || (await bal('MEM')));
r = await as('authenticated', 'MEM', `select public.pay_salary('SUP', 100, 0, 'x')`);
ok('MEM (no manage) cannot pay SUP', !!r.error && /NO_PERM_WALLET/.test(r.error), r.error);
r = await as('authenticated', 'MGR', `select public.pay_salary('MGR', 100, 0, 'self')`);
ok('MGR cannot pay their own salary (self lock)', !!r.error && /SELF_WALLET/.test(r.error), r.error);
r = await as('authenticated', 'MGR', `select public.pay_salary('OUT', 100, 0, 'x')`);
ok('MGR cannot pay OUT (another tree)', !!r.error && /NO_PERM_WALLET/.test(r.error), r.error);
r = await as('authenticated', 'KING', `select public.pay_salary('OUT', 50, 0, 'king')`);
ok('King can pay anyone', !r.error, r.error);

console.log('\nWALLET ADMIN (wallet_admin_apply) — identity cannot be spoofed');
const outC = await bal('OUT');
// MEM tries to credit itself a million by passing MGR-style rows: actor is still MEM → denied
r = await as('authenticated', 'MEM', `select public.wallet_admin_apply('[{"user_code":"MEM","amount":1000000,"wallet_type":"balance","type":"hack"}]'::jsonb)`);
ok('MEM cannot credit itself via wallet_admin_apply', !!r.error, r.error);
// created_by is forced to the real actor's name, not a spoofed one
r = await as('authenticated', 'MGR', `select public.wallet_admin_apply('[{"user_code":"MEM","amount":10,"wallet_type":"balance","type":"bonus","created_by":"SPOOFED"}]'::jsonb)`);
const lastBy = (await val(`select created_by from transactions where user_code='MEM' order by id desc limit 1`)).created_by;
ok('created_by is the real actor, not the spoofed value', !r.error && lastBy === 'Mgr', { lastBy, err: r.error });

console.log('\nPROFIT RATE (set_member_profit_rate)');
r = await as('authenticated', 'MGR', `select public.set_member_profit_rate('MEM', 0.5)`);
ok('MGR sets MEM profit rate', !r.error && Number((await val(`select profit_rate from employees where code='MEM'`)).profit_rate) === 0.5, r.error);
r = await as('authenticated', 'MGR', `select public.set_member_profit_rate('MGR', 0.9)`);
ok('MGR cannot set own profit rate', !!r.error && /SELF_PROFIT/.test(r.error), r.error);
r = await as('authenticated', 'MEM', `select public.set_member_profit_rate('SUP', 0.9)`);
ok('MEM cannot set SUP profit rate', !!r.error, r.error);

console.log('\nCOINS / COSMETIC / REWARD — real identity');
r = await as('authenticated', 'KING', `select public.coins_grant('ignored', 'MEM', 25, 'gift')`);
ok('King grants coins (p_viewer is ignored)', !r.error, r.error);
r = await as('authenticated', 'MGR', `select public.coins_grant('KING', 'MGR', 999999, 'hack')`);
ok('MGR cannot grant coins even passing King as p_viewer', !!r.error && /NOT_ALLOWED/.test(r.error), r.error);
const memCoins = await coins('MEM');
r = await as('authenticated', 'MEM', `select public.cosmetic_buy('ignored','hat1')`);
ok('MEM buys a cosmetic with its own coins (identity from session)', !r.error && (await coins('MEM')) === memCoins - 50, { err: r.error, c: await coins('MEM') });
// reward claim only for yourself
const claim = (await val(`insert into reward_claims (user_code, status, reward_kind, reward_amount, reward_title, source)
                          values ('MEM','earned','money',200,'prize','challenge') returning id`)).id;
r = await as('authenticated', 'SUP', `select public.claim_reward('${claim}', 'MEM', null)`);
ok('SUP cannot claim MEMs reward', !!r.error && /NOT_ALLOWED/.test(r.error), r.error);
r = await as('authenticated', 'MEM', `select public.claim_reward('${claim}', 'MEM', null)`);
ok('MEM claims its own reward (money lands in wallet)', !r.error, r.error);

console.log('\nORDER PROFIT (distribute / return) gated by order permission');
r = await as('authenticated', 'MGR', `select public.distribute_order_profit('1', '[{"user_code":"MEM","amount":30,"type":"قازانج","order_id":"1"}]'::jsonb)`);
ok('MGR distributes profit on MEMs order (team)', !r.error, r.error);
r = await as('authenticated', 'MGR', `select public.distribute_order_profit('2', '[{"user_code":"OUT","amount":30,"type":"قازانج","order_id":"2"}]'::jsonb)`);
ok('MGR cannot distribute on OUTs order (other tree)', !!r.error && /NO_PERM_DISTRIBUTE/.test(r.error), r.error);
r = await as('authenticated', 'MGR', `select public.distribute_order_profit('1', '[{"user_code":"MEM","amount":5,"type":"قازانج","order_id":"1"}]'::jsonb)`);
ok('cannot distribute twice (ALREADY_DISTRIBUTED)', !!r.error && /ALREADY_DISTRIBUTED/.test(r.error), r.error);

console.log('\nSERVICE ROLE BYPASS (Dart / bot / Edge Functions stay free)');
r = await as('service_role', '', `select public.pay_salary('MEM', 10, 0, 'backend')`);
ok('service_role can pay salary (no employee identity needed)', !r.error, r.error);
r = await as('service_role', '', `select public.wallet_admin_apply('[{"user_code":"OUT","amount":5,"type":"x"}]'::jsonb)`);
ok('service_role can wallet_admin_apply', !r.error, r.error);

console.log('\nORDER PERMISSION OWNERSHIP (p2_can_order)');
r = await val(`select public.p2_can_order('MEM','1','view') a, public.p2_can_order('MEM','1','edit') b, public.p2_can_order('OUT','1','view') c`);
ok('owner sees/edits own order; outsider cannot view', r.a && r.b && !r.c, r);

console.log('\nROLLBACK');
try { await db.exec(RB); ok('rollback runs', true); } catch (e) { ok('rollback runs', false, e.message); }
r = await as('authenticated', 'MGR', `update employees set balance = 1 where code='MEM'`);
ok('after rollback balance is writable again', !r.error, r.error);
r = await as('authenticated', 'MGR', `select public.wallet_apply('[{"user_code":"MEM","amount":0}]'::jsonb)`);
ok('after rollback wallet_apply is callable again', !r.error, r.error);

try { await db.exec(MIG); ok('migration re-applies after rollback', true); } catch (e) { ok('migration re-applies after rollback', false, e.message); }

console.log(`\n${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
