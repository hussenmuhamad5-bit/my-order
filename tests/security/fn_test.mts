// تاقیکردنەوەی لۆجیکی `staff-login` (handler.ts) بە داتای ساختە — Node 22+ (--experimental-strip-types)
import { createHandler, verifyInitData, staffEmail, safeEqual, canLoginAs, publicRow, type Employee } from '../../supabase/functions/staff-login/handler.ts';
import { sign } from '@telegram-apps/init-data-node';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x?: unknown) => { if (c) { pass++; console.log('  ✔', n); } else { fail++; console.log('  ✘', n, x === undefined ? '' : JSON.stringify(x)); } };

const BOT = '123456:TEST-BOT-TOKEN';
const OTHER_BOT = '999:OTHER';
const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const tgInit = (user: Record<string, unknown>, ageS = 60, token = BOT, extra: Record<string, unknown> = {}) =>
    sign({ user: { first_name: 'Ali', ...user }, query_id: 'AAE1', ...extra } as never, token, new Date(NOW - ageS * 1000));

function makeWorld() {
    const emps: Record<string, Employee> = {
        KING1: { code: 'KING1', password: 'kingpw1', role: 'پاشا', suspended: false, telegram_id: '500', full_name: 'King' },
        MEMB1: { code: 'MEMB1', password: 'memberpw', role: 'ئەندام', suspended: false, telegram_id: '', full_name: 'Member', permissions: { view_orders: 'team', login_as: false } },
        BOSS1: { code: 'BOSS1', password: 'bosspw', role: 'بەڕێوەبەر', suspended: false, permissions: { view_orders: 'team', login_as: true } },
        HELD1: { code: 'HELD1', password: 'heldpw', role: 'ئەندام', suspended: true, telegram_id: '700' },
        NEW01: { code: 'NEW01', password: '', role: 'ئەندام', suspended: false },
        SIOi7: { code: 'SIOi7', password: 'abc123', role: 'ئەندام', suspended: false, telegram_id: '800' },
        sioi7: { code: 'sioi7', password: 'zzz999', role: 'ئەندام', suspended: false },
    };
    const chats: Array<{ code: string; tg: string; unlinked: boolean }> = [{ code: 'SIOi7', tg: '500', unlinked: false }];
    const failures: Array<{ code: string; at: number }> = [];
    const issued: string[] = [];
    const sessions: Record<string, string> = { 'jwt-king': 'uid-KING1', 'jwt-memb': 'uid-MEMB1', 'jwt-boss': 'uid-BOSS1', 'jwt-held': 'uid-HELD1' };
    for (const c of Object.keys(emps)) emps[c].auth_user_id = 'uid-' + c;
    const deps = {
        getEmployee: async (c: string) => emps[c] ? { ...emps[c] } : null,
        findEmployeesByTelegram: async (t: string) => Object.values(emps).filter(e => e.telegram_id === t).map(e => ({ ...e })),
        hasActiveChatLink: async (c: string, t: string) => chats.some(x => x.code === c && x.tg === t && !x.unlinked),
        updateEmployee: async (c: string, p: Record<string, unknown>) => { Object.assign(emps[c], p); return { ...emps[c] }; },
        linkChat: async (c: string, tg: { id: string }) => { chats.push({ code: c, tg: tg.id, unlinked: false }); },
        recentFailures: async (c: string, since: string) => failures.filter(f => f.code === c && f.at >= Date.parse(since)).length,
        recordFailure: async (c: string) => { failures.push({ code: c, at: NOW }); },
        botTokens: async () => [BOT],
        issueLogin: async (e: Employee) => { issued.push(e.code); return { token_hash: 'th-' + e.code, type: 'magiclink' }; },
        userFromJwt: async (j: string) => sessions[j] ?? null,
        employeeByAuthUser: async (u: string) => { const e = Object.values(emps).find(x => x.auth_user_id === u); return e ? { ...e } : null; },
        now: () => NOW,
    };
    return { emps, chats, failures, issued, handle: createHandler(deps) };
}

async function call(w: ReturnType<typeof makeWorld>, body: unknown, headers: Record<string, string> = {}, method = 'POST') {
    const res = await w.handle(new Request('https://x/functions/v1/staff-login', {
        method, headers: { 'content-type': 'application/json', ...headers },
        body: method === 'POST' ? JSON.stringify(body) : undefined,
    }));
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, cors: res.headers.get('access-control-allow-origin') };
}

console.log('\nhelpers');
ok('safeEqual equal', safeEqual('abc', 'abc'));
ok('safeEqual differs', !safeEqual('abc', 'abd') && !safeEqual('abc', 'abcd') && !safeEqual('', 'a'));
ok('staffEmail keeps case distinct', staffEmail('SIOi7') !== staffEmail('sioi7'), [staffEmail('SIOi7'), staffEmail('sioi7')]);
ok('staffEmail is lowercase hex', /^e[0-9a-f]+@staff\.my-order\.invalid$/.test(staffEmail('ÄbC-1')), staffEmail('ÄbC-1'));
ok('publicRow strips password + auth_user_id', !('password' in publicRow({ code: 'a', password: 'x', auth_user_id: 'u', full_name: 'n' })) && publicRow({ code: 'a', password: 'x', full_name: 'n' }).full_name === 'n');
ok('canLoginAs: king', canLoginAs({ code: 'k', role: 'پاشا' }));
ok('canLoginAs: member default no', !canLoginAs({ code: 'm', role: 'ئەندام' }));
ok('canLoginAs: manager with login_as', canLoginAs({ code: 'b', role: 'بەڕێوەبەر', permissions: { view_orders: 'team', login_as: true } }));
ok('canLoginAs: permissions as JSON string', canLoginAs({ code: 'b', role: 'ئەندام', permissions: JSON.stringify({ create_key: false, login_as: true }) }));
ok('canLoginAs: old-format perms ignored', !canLoginAs({ code: 'b', role: 'ئەندام', permissions: { login_as: true } }));

console.log('\nTelegram initData verification');
let tg = await verifyInitData(tgInit({ id: 500, username: 'king' }), [BOT], NOW);
ok('valid signature accepted', tg?.id === '500' && tg?.username === 'king' && tg?.name === 'Ali', tg);
tg = await verifyInitData(tgInit({ id: 500 }, 60, BOT, { signature: 'abc_def-sig' }), [BOT], NOW);
ok('valid with Bot API 8 "signature" field', tg?.id === '500', tg);
ok('wrong bot token rejected', !(await verifyInitData(tgInit({ id: 500 }, 60, OTHER_BOT), [BOT], NOW)));
ok('accepts when one of several tokens matches', !!(await verifyInitData(tgInit({ id: 500 }, 60, OTHER_BOT), [BOT, OTHER_BOT], NOW)));
const good = tgInit({ id: 500 });
ok('tampered user id rejected', !(await verifyInitData(good.replace(/%22id%22%3A500/, '%22id%22%3A501'), [BOT], NOW)));
ok('expired (25h) rejected', !(await verifyInitData(tgInit({ id: 500 }, 25 * 3600), [BOT], NOW)));
ok('future auth_date rejected', !(await verifyInitData(tgInit({ id: 500 }, -3600), [BOT], NOW)));
ok('missing hash rejected', !(await verifyInitData('user=%7B%22id%22%3A1%7D&auth_date=1', [BOT], NOW)));
ok('garbage rejected', !(await verifyInitData('%%%', [BOT], NOW)) && !(await verifyInitData('', [BOT], NOW)));

console.log('\naction=password');
let w = makeWorld(), r;
r = await call(w, { action: 'password', code: 'KING1', password: 'kingpw1' });
ok('correct password → 200 + token', r.status === 200 && r.body.ok && r.body.token_hash === 'th-KING1' && r.body.type === 'magiclink', r);
ok('response never contains password', !JSON.stringify(r.body).includes('kingpw1') && !('password' in r.body.employee), r.body);
ok('CORS header present', r.cors === '*');
r = await call(w, { action: 'password', code: 'KING1', password: 'wrong' });
ok('wrong password → 401 bad_password', r.status === 401 && r.body.error === 'bad_password', r);
r = await call(w, { action: 'password', code: 'KING1', password: 'KINGPW1' });
ok('password is case-sensitive', r.status === 401, r);
r = await call(w, { action: 'password', code: 'NOPE', password: 'x' });
ok('unknown code → 404 no_code', r.status === 404 && r.body.error === 'no_code', r);
r = await call(w, { action: 'password', code: 'HELD1', password: 'heldpw' });
ok('suspended → 403 held (even with right password)', r.status === 403 && r.body.error === 'held', r);
r = await call(w, { action: 'password', code: 'NEW01', password: 'whatever' });
ok('no password yet → 409 needs_setup', r.status === 409 && r.body.error === 'needs_setup', r);
r = await call(w, { action: 'password', code: 'sioi7', password: 'abc123' });
ok('codes are case-sensitive (sioi7 ≠ SIOi7)', r.status === 401, r);
r = await call(w, { action: 'password', code: 'KING1' });
ok('missing password → 400', r.status === 400, r);
r = await call(w, { action: 'password', code: 'MEMB1', password: 'memberpw', init_data: tgInit({ id: 901, username: 'mem' }) });
ok('valid initData links Telegram on login', r.status === 200 && w.emps.MEMB1.telegram_id === '901' && w.chats.some(c => c.code === 'MEMB1' && c.tg === '901'), w.emps.MEMB1);
r = await call(w, { action: 'password', code: 'BOSS1', password: 'bosspw', init_data: tgInit({ id: 902 }, 60, OTHER_BOT) });
ok('forged initData does NOT link Telegram (login still works)', r.status === 200 && !w.emps.BOSS1.telegram_id, w.emps.BOSS1);

console.log('\nbrute-force limit');
w = makeWorld();
for (let i = 0; i < 10; i++) await call(w, { action: 'password', code: 'MEMB1', password: 'guess' + i });
r = await call(w, { action: 'password', code: 'MEMB1', password: 'memberpw' });
ok('after 10 wrong tries → 429 too_many, even with the right password', r.status === 429 && r.body.error === 'too_many', r);
r = await call(w, { action: 'password', code: 'KING1', password: 'kingpw1' });
ok('other accounts unaffected', r.status === 200, r);

console.log('\naction=setup');
w = makeWorld();
r = await call(w, { action: 'setup', code: 'NEW01', new_password: '12345' });
ok('too short → 400 bad_length', r.status === 400 && r.body.error === 'bad_length', r);
r = await call(w, { action: 'setup', code: 'NEW01', new_password: '1234567890123456' });
ok('too long → 400 bad_length', r.status === 400 && r.body.error === 'bad_length', r);
r = await call(w, { action: 'setup', code: 'NEW01', new_password: 'newpass1', init_data: tgInit({ id: 333 }) });
ok('sets password + returns token', r.status === 200 && w.emps.NEW01.password === 'newpass1' && r.body.token_hash === 'th-NEW01', r);
ok('setup links verified Telegram', w.emps.NEW01.telegram_id === '333');
r = await call(w, { action: 'setup', code: 'NEW01', new_password: 'hijack12' });
ok('cannot setup again once a password exists → 409', r.status === 409 && r.body.error === 'has_password' && w.emps.NEW01.password === 'newpass1', r);
r = await call(w, { action: 'setup', code: 'KING1', new_password: 'hijack12' });
ok('cannot overwrite an existing password', r.status === 409 && w.emps.KING1.password === 'kingpw1', r);
r = await call(w, { action: 'setup', code: 'HELD1', new_password: 'whatever1' });
ok('suspended cannot setup', r.status === 403, r);

console.log('\naction=telegram');
w = makeWorld();
r = await call(w, { action: 'telegram', init_data: tgInit({ id: 500 }) });
ok('linked Telegram → KING1', r.status === 200 && r.body.token_hash === 'th-KING1', r);
r = await call(w, { action: 'telegram', init_data: tgInit({ id: 500 }), prefer_code: 'SIOi7' });
ok('prefer_code with an active chat link → that account', r.status === 200 && r.body.token_hash === 'th-SIOi7', r);
r = await call(w, { action: 'telegram', init_data: tgInit({ id: 500 }), prefer_code: 'MEMB1' });
ok('prefer_code NOT linked to this Telegram is ignored', r.status === 200 && r.body.token_hash === 'th-KING1', r);
r = await call(w, { action: 'telegram', init_data: tgInit({ id: 500 }), prefer_code: 'MEMB1', strict: true });
ok('strict prefer_code NOT linked → 404 (no fallback to another account)', r.status === 404 && r.body.error === 'not_linked', r);
r = await call(w, { action: 'telegram', init_data: tgInit({ id: 500 }), prefer_code: 'SIOi7', strict: true });
ok('strict prefer_code linked → that account', r.status === 200 && r.body.token_hash === 'th-SIOi7', r);
r = await call(w, { action: 'telegram', init_data: tgInit({ id: 500 }, 60, OTHER_BOT) });
ok('forged initData → 401 tg_invalid', r.status === 401 && r.body.error === 'tg_invalid', r);
r = await call(w, { action: 'telegram', init_data: tgInit({ id: 12345 }) });
ok('unknown Telegram → 404 not_linked', r.status === 404 && r.body.error === 'not_linked', r);
r = await call(w, { action: 'telegram', init_data: tgInit({ id: 700 }) });
ok('suspended account → 403 held', r.status === 403 && r.body.error === 'held', r);
ok('no login issued for any failure above', JSON.stringify(w.issued) === JSON.stringify(['KING1', 'SIOi7', 'KING1', 'SIOi7']), w.issued);

console.log('\naction=impersonate');
w = makeWorld();
r = await call(w, { action: 'impersonate', target_code: 'MEMB1' });
ok('no session → 401', r.status === 401 && r.body.error === 'no_session', r);
r = await call(w, { action: 'impersonate', target_code: 'MEMB1' }, { authorization: 'Bearer bad' });
ok('invalid session → 401', r.status === 401, r);
r = await call(w, { action: 'impersonate', target_code: 'KING1' }, { authorization: 'Bearer jwt-memb' });
ok('member without login_as → 403 forbidden', r.status === 403 && r.body.error === 'forbidden', r);
r = await call(w, { action: 'impersonate', target_code: 'MEMB1' }, { authorization: 'Bearer jwt-king' });
ok('king → member works', r.status === 200 && r.body.token_hash === 'th-MEMB1', r);
r = await call(w, { action: 'impersonate', target_code: 'MEMB1' }, { authorization: 'Bearer jwt-boss' });
ok('manager with login_as permission works', r.status === 200, r);
r = await call(w, { action: 'impersonate', target_code: 'HELD1' }, { authorization: 'Bearer jwt-king' });
ok('cannot enter a suspended account', r.status === 403 && r.body.error === 'held', r);
r = await call(w, { action: 'impersonate', target_code: 'MEMB1' }, { authorization: 'Bearer jwt-held' });
ok('suspended caller → 403 not_staff', r.status === 403 && r.body.error === 'not_staff', r);

console.log('\nrequest handling');
w = makeWorld();
r = await call(w, null, {}, 'OPTIONS');
ok('OPTIONS preflight → 204 + CORS', r.status === 204 && r.cors === '*', r);
r = await call(w, null, {}, 'GET');
ok('GET → 405', r.status === 405, r);
r = await call(w, { action: 'nope' });
ok('unknown action → 400', r.status === 400 && r.body.error === 'bad_action', r);
const raw = await w.handle(new Request('https://x', { method: 'POST', body: '{not json' }));
ok('bad JSON → 400', raw.status === 400);
const boom = createHandler({ ...({} as never), getEmployee: async () => { throw new Error('db down'); }, recentFailures: async () => 0, now: () => NOW } as never);
const br = await boom(new Request('https://x', { method: 'POST', body: JSON.stringify({ action: 'password', code: 'a', password: 'b' }) }));
ok('internal error → 500 server (no details leaked)', br.status === 500 && (await br.json()).error === 'server');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
