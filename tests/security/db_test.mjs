// db/100_staff_auth.sql (+ rollback) لە PGlite (Postgres لە ناو Node) لەگەڵ ڕۆڵەکانی Supabase.
// هیچ پەیوەندییەک بە داتابەیسی ڕاستەقینەوە نییە.  ڕاکردن: `npm test` لەم فۆڵدەرە.
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const MIG = fs.readFileSync(`${REPO}/db/100_staff_auth.sql`, 'utf8');
const RB = fs.readFileSync(`${REPO}/db/100_staff_auth_rollback.sql`, 'utf8');

const BOOT = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator noinherit login;
grant anon, authenticated, service_role to authenticator;

create schema auth;
create table auth.users (id uuid primary key, email text);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema vault;
create table vault.decrypted_secrets (name text, decrypted_secret text);
insert into vault.decrypted_secrets values ('telegram_bot_token', 'TEST:TOKEN');

create schema storage;
create table storage.objects (id serial primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects to anon, authenticated, service_role;
grant all on sequence storage.objects_id_seq to anon, authenticated, service_role;
create policy order_images_insert on storage.objects for insert to public with check (bucket_id = 'order-images');
create policy order_images_public_read on storage.objects for select to public using (bucket_id = 'order-images');

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create extension pg_trgm schema public;

create table public.employees (
  code text primary key, password text not null default '', full_name text, role text,
  permissions jsonb, suspended boolean not null default false, suspended_at timestamptz,
  suspended_by text, session_epoch int not null default 0, telegram_id text, avatar text);
create function public.employees_session_guard() returns trigger language plpgsql set search_path to 'public' as $$
declare v_bump boolean := false;
begin
  if new.password is distinct from old.password then v_bump := true; end if;
  if coalesce(new.suspended,false) and not coalesce(old.suspended,false) then v_bump := true; new.suspended_at := now(); end if;
  if not coalesce(new.suspended,false) and coalesce(old.suspended,false) then new.suspended_at := null; new.suspended_by := null; end if;
  if v_bump then new.session_epoch := coalesce(old.session_epoch,0) + 1; end if;
  return new;
end $$;
create trigger trg_employees_session_guard before update on public.employees for each row execute function employees_session_guard();

create table public.orders (id bigserial primary key, seller_code text, status text);
create table public.dispatch_items (id bigserial primary key, x text);
create table public.dispatch_batches (id bigserial primary key, x text);
create table public.delivery_fees (id bigserial primary key, x text);
create table public.dispatch_city_prices (id bigserial primary key, x text);
create table public.cities (id serial primary key, name text);
create table public.realtime_events (id bigserial primary key, entity text);
do $$ declare t text; begin
  foreach t in array array['employees','orders','dispatch_items','dispatch_batches','delivery_fees','dispatch_city_prices','cities','realtime_events'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop; end $$;
create policy dispatch_batches_all on public.dispatch_batches for all to anon, authenticated using (true) with check (true);
create policy dispatch_items_all on public.dispatch_items for all to anon, authenticated using (true) with check (true);
create policy delivery_fees_all on public.delivery_fees for all to anon, authenticated using (true) with check (true);
create policy dispatch_city_prices_all on public.dispatch_city_prices for all to public using (true) with check (true);
create policy cities_select_all on public.cities for select to anon, authenticated, service_role using (true);

create function public.login_code_status(p_code text)
returns table(full_name text, avatar text, role text, needs_password boolean, suspended boolean)
language sql stable security definer set search_path to 'public' as $$
  select e.full_name, e.avatar, e.role, (btrim(coalesce(e.password,'')) = ''), coalesce(e.suspended,false)
  from employees e where e.code = p_code limit 1 $$;
create function public.orders_count(p text) returns bigint language sql stable as $$ select count(*) from orders where seller_code = p $$;
create function public.wallet_apply(p_code text) returns text language plpgsql security definer set search_path = public as $$
begin update employees set full_name = full_name where code = p_code; return 'ok'; end $$;

insert into auth.users values ('11111111-1111-1111-1111-111111111111', 'king@x'),
                              ('22222222-2222-2222-2222-222222222222', 'held@x'),
                              ('33333333-3333-3333-3333-333333333333', 'stranger@x');
insert into public.employees (code, password, full_name, role) values
  ('KING1', 'secret1', 'King', 'پاشا'), ('HELD1', 'pw', 'Held', 'ئەندام'), ('NEW01', '', 'Newbie', 'ئەندام');
insert into public.orders (seller_code, status) values ('KING1','a'),('KING1','b'),('HELD1','c');
insert into public.dispatch_items (x) values ('d1');
insert into public.cities (name) values ('Erbil');
insert into auth.sessions (user_id) values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
`;

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.log('  ✘', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}
// Run SQL as a role with JWT claims, the way PostgREST does it
async function as(role, sub, sql, params) {
  const claims = JSON.stringify(sub ? { role, sub } : { role });
  await db.exec(`reset role; select set_config('request.jwt.claims', '${claims.replace(/'/g, "''")}', false); set role ${role};`);
  try { const r = await db.query(sql, params); return { rows: r.rows }; }
  catch (e) { return { error: e.message }; }
  finally { await db.exec('reset role;'); }
}
const KING = '11111111-1111-1111-1111-111111111111';
const HELD = '22222222-2222-2222-2222-222222222222';
const STRANGER = '33333333-3333-3333-3333-333333333333';

await db.exec(BOOT);

console.log('\nBEFORE migration (the leak today):');
ok('anon can read orders today', !(await as('anon', null, 'select * from orders')).error);
ok('anon can edit dispatch_items today', !(await as('anon', null, "update dispatch_items set x='hacked' where true")).error);

console.log('\nRUN migration');
await db.exec(MIG);
await db.exec(`update employees set auth_user_id = '${KING}' where code = 'KING1';
               update employees set auth_user_id = '${HELD}' where code = 'HELD1';
               update employees set suspended = true where code = 'HELD1';`);
ok('suspending HELD1 revoked its auth sessions',
  (await db.query(`select count(*)::int n from auth.sessions where user_id = '${HELD}'`)).rows[0].n === 0);
ok('KING1 sessions untouched',
  (await db.query(`select count(*)::int n from auth.sessions where user_id = '${KING}'`)).rows[0].n === 1);

console.log('\nANON (anyone on the internet with the public key):');
let r;
r = await as('anon', null, 'select * from orders');                       ok('cannot read orders', !!r.error, r);
r = await as('anon', null, 'select password from employees');             ok('cannot read passwords', !!r.error, r);
r = await as('anon', null, "update dispatch_items set x='hacked' where true"); ok('cannot edit dispatch_items', !!r.error, r);
r = await as('anon', null, 'select * from delivery_fees');                ok('cannot read delivery_fees', !!r.error, r);
r = await as('anon', null, 'select * from cities');                       ok('cannot read cities', !!r.error, r);
r = await as('anon', null, "select public.wallet_apply('KING1')");        ok('cannot call SECURITY DEFINER rpc', !!r.error, r);
r = await as('anon', null, "select public.orders_count('KING1')");        ok('cannot call invoker rpc', !!r.error, r);
r = await as('anon', null, "select * from public.login_code_status('NEW01')");
ok('CAN call login_code_status (login page)', !r.error && r.rows.length === 1 && r.rows[0].needs_password === true, r);
r = await as('anon', null, "select * from public.staff_bot_token()");     ok('cannot read bot token', !!r.error, r);
r = await as('anon', null, "insert into storage.objects (bucket_id, name) values ('order-images','x.jpg')");
ok('cannot upload images', !!r.error, r);
r = await as('anon', null, "select count(*) from storage.objects where bucket_id='order-images'");
ok('can still view public images', !r.error, r);
r = await as('anon', null, 'select public.staff_gate()');                 ok('pre-request gate passes anon', !r.error, r);

console.log('\nAUTHENTICATED EMPLOYEE (KING1):');
r = await as('authenticated', KING, 'select count(*)::int n from orders');
ok('reads all orders', !r.error && r.rows[0].n === 3, r);
r = await as('authenticated', KING, "insert into orders (seller_code, status) values ('KING1','new') returning id");
ok('inserts orders', !r.error, r);
r = await as('authenticated', KING, "update dispatch_items set x='ok' where true");
ok('updates dispatch_items', !r.error, r);
r = await as('authenticated', KING, "select public.wallet_apply('KING1')");   ok('calls definer rpc', !r.error, r);
r = await as('authenticated', KING, "select public.orders_count('KING1')");   ok('calls invoker rpc', !r.error, r);
r = await as('authenticated', KING, 'select count(*)::int n from cities');     ok('reads cities', !r.error && r.rows[0].n === 1, r);
r = await as('authenticated', KING, "insert into storage.objects (bucket_id, name) values ('order-images','k.jpg')");
ok('uploads images', !r.error, r);
r = await as('authenticated', KING, "insert into storage.objects (bucket_id, name) values ('other','k.jpg')");
ok('cannot upload to another bucket', !!r.error, r);
r = await as('authenticated', KING, 'select public.staff_gate()');            ok('pre-request gate passes employee', !r.error, r);
r = await as('authenticated', KING, 'select public.current_emp_code() c');    ok('current_emp_code = KING1', r.rows && r.rows[0].c === 'KING1', r);
r = await as('authenticated', KING, 'select * from public.staff_bot_token()'); ok('employee cannot read bot token', !!r.error, r);
r = await as('authenticated', KING, 'select * from public.staff_login_failures'); ok('employee cannot read login failures', !!r.error, r);

console.log('\nSUSPENDED EMPLOYEE (HELD1, still holding a valid JWT):');
r = await as('authenticated', HELD, 'select count(*)::int n from orders');    ok('sees 0 orders', !r.error && r.rows[0].n === 0, r);
r = await as('authenticated', HELD, "insert into orders (seller_code) values ('HELD1')"); ok('cannot insert', !!r.error, r);
r = await as('authenticated', HELD, 'select public.staff_gate()');            ok('pre-request gate blocks (so definer rpcs too)', !!r.error && /Not an active employee/.test(r.error), r);

console.log('\nAUTHENTICATED NON-EMPLOYEE (e.g. a self-signup):');
r = await as('authenticated', STRANGER, 'select count(*)::int n from orders');  ok('sees 0 orders', !r.error && r.rows[0].n === 0, r);
r = await as('authenticated', STRANGER, 'select public.staff_gate()');          ok('pre-request gate blocks', !!r.error, r);

console.log('\nSERVICE ROLE (Dart app, bot, Edge Functions):');
r = await as('service_role', null, 'select count(*)::int n from orders');       ok('reads everything', !r.error && r.rows[0].n === 4, r);
r = await as('service_role', null, 'select public.staff_bot_token() t');        ok('reads bot token', !r.error && r.rows[0].t === 'TEST:TOKEN', r);
r = await as('service_role', null, "insert into staff_login_failures (code) values ('X')"); ok('writes login failures', !r.error, r);
r = await as('service_role', null, 'select public.staff_gate()');               ok('pre-request gate passes', !r.error, r);

console.log('\nOTHER CHECKS:');
r = await db.query(`select count(*)::int n from pg_policies where schemaname='public' and policyname='staff_all'`);
ok('staff_all on every public table except staff_login_failures', r.rows[0].n === 8, r.rows);
r = await db.query(`select count(*)::int n from information_schema.role_table_grants where grantee='anon' and table_schema='public'`);
ok('anon has zero table grants', r.rows[0].n === 0, r.rows);
r = await db.query(`select has_function_privilege('anon', 'public.similarity(text,text)', 'EXECUTE') ok`);
ok('extension functions (pg_trgm) left untouched', r.rows[0].ok === true, r.rows);
r = await db.query(`select rolconfig from pg_roles where rolname='authenticator'`);
ok('pre-request hook registered', JSON.stringify(r.rows[0].rolconfig || []).includes('pgrst.db_pre_request=public.staff_gate'), r.rows);
// A new function created later must not be open to anon
await db.exec(`create function public.future_fn() returns int language sql as 'select 1'`);
r = await db.query(`select has_function_privilege('anon','public.future_fn()','EXECUTE') a, has_function_privilege('authenticated','public.future_fn()','EXECUTE') b`);
ok('future functions: anon no, authenticated yes', r.rows[0].a === false && r.rows[0].b === true, r.rows);
await db.exec(`create table public.future_tbl (id int)`);
r = await db.query(`select has_table_privilege('anon','public.future_tbl','SELECT') a`);
ok('future tables: anon no', r.rows[0].a === false, r.rows);
await db.exec(`drop function public.future_fn(); drop table public.future_tbl;`);

await db.exec(`update employees set full_name = 'King A' where code = 'KING1'`);
ok('a normal profile edit keeps sessions', (await db.query(`select count(*)::int n from auth.sessions where user_id = '${KING}'`)).rows[0].n === 1);
await db.exec(`update employees set password = 'changed' where code = 'KING1'`);
ok('a password change revokes that user\'s sessions', (await db.query(`select count(*)::int n from auth.sessions where user_id = '${KING}'`)).rows[0].n === 0);

console.log('\nIDEMPOTENT: run migration a second time');
try { await db.exec(MIG); ok('second run succeeds', true); } catch (e) { ok('second run succeeds', false, e.message); }

console.log('\nROLLBACK');
try { await db.exec(RB); ok('rollback runs', true); } catch (e) { ok('rollback runs', false, e.message); }
r = await as('anon', null, 'select count(*)::int n from orders');
ok('after rollback anon reads orders again (old behaviour)', !r.error, r);
r = await as('anon', null, "update dispatch_items set x='again' where true");
ok('after rollback dispatch_items open again', !r.error, r);
r = await as('anon', null, "insert into storage.objects (bucket_id, name) values ('order-images','y.jpg')");
ok('after rollback anon uploads again', !r.error, r);
r = await db.query(`select rolconfig from pg_roles where rolname='authenticator'`);
ok('pre-request hook removed', !JSON.stringify(r.rows[0].rolconfig || []).includes('db_pre_request'), r.rows);
await db.exec(`create function public.future_fn2() returns int language sql as 'select 1'`);
r = await db.query(`select has_function_privilege('anon','public.future_fn2()','EXECUTE') a`);
ok('after rollback future functions open to anon again (old default)', r.rows[0].a === true, r.rows);
await db.exec(`drop function public.future_fn2()`);
try { await db.exec(MIG); ok('migration re-applies after rollback', true); } catch (e) { ok('migration re-applies after rollback', false, e.message); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
