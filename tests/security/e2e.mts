// تاقیکردنەوەی تەواو: index.html / app.html / config.js ـی ڕاستەقینە لە Chromium، لەگەڵ Supabaseـی ساختە
// (GoTrue + PostgREST ـی ساختە کە یاساکانی db/100 جێبەجێ دەکەن + handler.ts ـی ڕاستەقینە).
import { chromium, type BrowserContext, type Page, type Route } from 'playwright';
import { createHandler, type Employee } from '../../supabase/functions/staff-login/handler.ts';
import { sign } from '@telegram-apps/init-data-node';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const REPO = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const SB = 'https://kxztaywhqpekjmjoynin.supabase.co';
const PUBLISHABLE = 'sb_publishable_a4_jL7fSgtlcD3j4e9e3sw_75AZBCwz';
const BOT = '123456:TEST-BOT';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x?: unknown) => { if (c) { pass++; console.log('  ✔', n); } else { fail++; console.log('  ✘', n, x === undefined ? '' : JSON.stringify(x).slice(0, 600)); } };

// ---------------- static server for the site ----------------
const UMD = fs.readFileSync(createRequire(import.meta.url).resolve('@supabase/supabase-js/dist/umd/supabase.js'));
const srv = http.createServer((q, r) => {
    const u = (q.url || '/').split('?')[0];
    if (u === '/vendor/supabase.min.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end(UMD); }
    const f = path.join(REPO, u === '/' ? 'index.html' : u);
    if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    const ct = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8';
    r.writeHead(200, { 'content-type': ct }); r.end(fs.readFileSync(f));
}).listen(8766);
const SITE = 'http://localhost:8766';

// ---------------- fake world ----------------
type World = ReturnType<typeof makeWorld>;
function makeWorld() {
    const emps: Record<string, Employee> = {
        KING1: { code: 'KING1', password: 'kingpw1', full_name: 'King One', role: 'پاشا', suspended: false, session_epoch: 0, telegram_id: '500', permissions: null, avatar: '', rank_prefs: {}, coins: 0 },
        MEMB1: { code: 'MEMB1', password: 'memberpw', full_name: 'Member One', role: 'ئەندام', suspended: false, session_epoch: 0, telegram_id: '', permissions: null, avatar: '', rank_prefs: {}, coins: 0 },
        NEW01: { code: 'NEW01', password: '', full_name: 'New Person', role: 'ئەندام', suspended: false, session_epoch: 0, telegram_id: '', permissions: null, avatar: '', rank_prefs: {}, coins: 0 },
    };
    const chats: Array<{ code: string; tg: string }> = [];
    const users: Record<string, string> = {};            // uid → code
    const otps: Record<string, string> = {};             // token_hash → uid (single use)
    const access: Record<string, string> = {};           // access jwt → uid
    const refresh: Record<string, { uid: string; revoked: boolean }> = {};
    const failures: Array<{ code: string; at: number }> = [];
    const log: Array<{ m: string; p: string; auth: string; apikey: string }> = [];
    let n = 0;

    const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    function newSession(uid: string) {
        n++;
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const at = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: uid, role: 'authenticated', aud: 'authenticated', exp, session_id: 's' + n })}.sig${n}`;
        const rt = 'rt-' + users[uid] + '-' + n;
        access[at] = uid; refresh[rt] = { uid, revoked: false };
        return { access_token: at, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: rt,
            user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'e@x.invalid', app_metadata: { emp_code: users[uid] }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } };
    }
    function revokeUser(uid: string) { for (const k in refresh) if (refresh[k].uid === uid) refresh[k].revoked = true; for (const k in access) if (access[k] === uid) delete access[k]; }

    const handler = createHandler({
        getEmployee: async (c) => emps[c] ? { ...emps[c] } : null,
        findEmployeesByTelegram: async (t) => Object.values(emps).filter(e => e.telegram_id === t).map(e => ({ ...e })),
        hasActiveChatLink: async (c, t) => chats.some(x => x.code === c && x.tg === t),
        updateEmployee: async (c, p) => {
            if ('password' in p && p.password !== emps[c].password) emps[c].session_epoch = Number(emps[c].session_epoch) + 1;
            Object.assign(emps[c], p); return { ...emps[c] };
        },
        linkChat: async (c, tg) => { chats.push({ code: c, tg: tg.id }); },
        recentFailures: async (c, since) => failures.filter(f => f.code === c && f.at >= Date.parse(since)).length,
        recordFailure: async (c) => { failures.push({ code: c, at: Date.now() }); },
        botTokens: async () => [BOT],
        issueLogin: async (e) => {
            let uid = Object.keys(users).find(u => users[u] === e.code);
            if (!uid) { uid = 'uid-' + e.code; users[uid] = e.code; }
            emps[e.code].auth_user_id = uid;
            // like GoTrue: a new magic link replaces the user's previous unused one
            for (const k in otps) if (otps[k] === uid) delete otps[k];
            const th = 'th-' + e.code + '-' + (++n);
            otps[th] = uid;
            return { token_hash: th, type: 'magiclink' };
        },
        userFromJwt: async (j) => access[j] ?? null,
        employeeByAuthUser: async (u) => { const c = users[u]; return c ? { ...emps[c] } : null; },
        now: () => Date.now(),
    });
    // loginDelayMs: hold staff-login answers so two logins can overlap (T13)
    const opt = { loginDelayMs: 0 };
    const stats = { verifyFail: 0 };
    return { emps, chats, users, otps, access, refresh, failures, log, newSession, revokeUser, handler, opt, stats };
}

async function serveSupabase(w: World, route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const h = req.headers();
    const auth = h['authorization'] || '';
    w.log.push({ m: req.method(), p, auth, apikey: h['apikey'] || '' });
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
    const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
        route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', ...extra }, body: body === undefined ? '' : JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });

    // Edge Function → the real handler
    if (p === '/functions/v1/staff-login') {
        const res = await w.handler(new Request(req.url(), { method: req.method(), headers: h, body: req.postData() ?? undefined }));
        if (w.opt.loginDelayMs) await new Promise(r => setTimeout(r, w.opt.loginDelayMs));
        return route.fulfill({ status: res.status, headers: { ...cors, 'content-type': 'application/json' }, body: await res.text() });
    }

    // GoTrue
    if (p === '/auth/v1/verify') {
        const b = JSON.parse(req.postData() || '{}');
        const uid = w.otps[b.token_hash];
        if (!uid) { w.stats.verifyFail++; return json(403, { code: 'otp_expired', msg: 'Token has expired or is invalid' }); }
        delete w.otps[b.token_hash];
        return json(200, w.newSession(uid));
    }
    if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
        const b = JSON.parse(req.postData() || '{}');
        const r = w.refresh[b.refresh_token];
        if (!r || r.revoked) return json(400, { code: 'refresh_token_not_found', error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
        r.revoked = true;
        return json(200, w.newSession(r.uid));
    }
    if (p === '/auth/v1/logout') {
        const uid = w.access[auth.replace(/^Bearer /, '')];
        if (uid) w.revokeUser(uid);
        return route.fulfill({ status: 204, headers: cors });
    }
    if (p === '/auth/v1/user') {
        const uid = w.access[auth.replace(/^Bearer /, '')];
        return uid ? json(200, { id: uid, aud: 'authenticated', role: 'authenticated', email: 'e@x.invalid', app_metadata: { emp_code: w.users[uid] }, user_metadata: {} }) : json(401, { code: 'bad_jwt' });
    }

    // PostgREST, enforcing db/100. Like the real pre-request gate (`staff_gate`), a signed-in
    // non-staff session is refused on EVERY request, `login_code_status` included (seen on
    // production); anon → 42501 except `login_code_status`.
    if (p.startsWith('/rest/v1/')) {
        const uid = w.access[auth.replace(/^Bearer /, '')];
        const code = uid ? w.users[uid] : null;
        const emp = code ? w.emps[code] : null;
        if (uid && (!emp || emp.suspended)) return json(403, { code: 'not_staff', details: null, hint: null, message: 'Not an active employee' });
        if (p === '/rest/v1/rpc/login_code_status') {
            const c = JSON.parse(req.postData() || '{}').p_code;
            const e = w.emps[c];
            return json(200, e ? [{ full_name: e.full_name, avatar: e.avatar, role: e.role, needs_password: !String(e.password || '').trim(), suspended: !!e.suspended }] : []);
        }
        if (!uid) return json(401, { code: '42501', message: 'permission denied for table ' + p });
        if (p === '/rest/v1/rpc/current_emp_code') return json(200, code);
        if (p === '/rest/v1/employees') {
            const eqCode = (url.searchParams.get('code') || '').replace(/^eq\./, '');
            const eqTg = (url.searchParams.get('telegram_id') || '').replace(/^eq\./, '');
            if (req.method() === 'PATCH') {
                const body = JSON.parse(req.postData() || '{}');
                const t = w.emps[eqCode];
                if (t) {
                    if ('password' in body && body.password !== t.password) { t.session_epoch = Number(t.session_epoch) + 1; if (t.auth_user_id) w.revokeUser(String(t.auth_user_id)); }
                    Object.assign(t, body);
                }
                return json(204, undefined);
            }
            let rows = Object.values(w.emps);
            if (eqCode) rows = rows.filter(e => e.code === eqCode);
            if (eqTg) rows = rows.filter(e => e.telegram_id === eqTg);
            if ((h['accept'] || '').includes('vnd.pgrst.object')) return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: '0 rows' });
            return json(200, rows);
        }
        if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...cors, 'content-range': '*/0' } });
        if ((h['accept'] || '').includes('vnd.pgrst.object')) return json(406, { code: 'PGRST116', message: '0 rows' });
        return json(200, []);
    }
    if (p.startsWith('/storage/v1/')) return json(200, { Key: 'x' });
    return json(404, {});
}

function tgStub(initData: string, user: Record<string, unknown> | null) {
    if (!initData) return '/* outside Telegram */';
    return `(function(){
      function deep(){ var f=function(){}; return new Proxy(f,{ get:function(t,k){ if(k==='then') return undefined; if(k===Symbol.toPrimitive) return function(){return ''}; return deep(); }, apply:function(){ return undefined; } }); }
      var fields = { initData: ${JSON.stringify(initData)}, initDataUnsafe: { user: ${JSON.stringify(user)} }, version: '8.0', platform: 'ios',
        colorScheme: 'light', themeParams: {}, viewportHeight: 800, viewportStableHeight: 800, isExpanded: true,
        safeAreaInset: {top:0,bottom:0,left:0,right:0}, contentSafeAreaInset: {top:0,bottom:0,left:0,right:0},
        isVersionAtLeast: function(){ return true; }, ready: function(){}, expand: function(){} };
      window.Telegram = { WebApp: new Proxy(fields, { get: function(t,k){ return (k in t) ? t[k] : deep(); } }) };
    })();`;
}

type Tg = { initData: string; user: Record<string, unknown> | null };
async function newPage(w: World, tg: Tg = { initData: '', user: null }, storage?: Record<string, string>) {
    const ctx = await browser.newContext();
    if (storage) await ctx.addInitScript((st) => { if (location.origin === 'http://localhost:8766' && !sessionStorage.getItem('__seeded')) { for (const k in st) localStorage.setItem(k, st[k]); sessionStorage.setItem('__seeded', '1'); } }, storage);
    return { ctx, ...await addPage(ctx, w, tg) };
}
// another tab in the same browser (shares localStorage with the first)
async function addPage(ctx: BrowserContext, w: World, tg: Tg = { initData: '', user: null }) {
    const page = await ctx.newPage();
    const dialogs: string[] = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    page.on('pageerror', e => { if (!/Proxy|deep/.test(String(e))) console.log('    [pageerror]', String(e).slice(0, 200)); });
    // ⚠️ Playwright tries routes newest-first: catch-all must be registered FIRST
    await page.route(/^https:\/\/(?!kxztaywhqpekjmjoynin)/, r => r.fulfill({ status: 200, body: '' }));
    await page.route('https://telegram.org/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: tgStub(tg.initData, tg.user) }));
    await page.route(/^https:\/\/kxztaywhqpekjmjoynin\.supabase\.co\//, r => serveSupabase(w, r));
    await page.routeWebSocket(/supabase\.co/, () => { /* realtime: never connects */ });
    return { page, dialogs };
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const waitApp = (page: Page) => page.waitForURL(/app\.html/, { timeout: 15000 }).then(() => true, () => false);
const waitIndex = (page: Page) => page.waitForURL(/index\.html/, { timeout: 15000 }).then(() => true, () => false);
const ls = (page: Page, k: string) => page.evaluate((key) => localStorage.getItem(key), k);
const sessionCode = async (page: Page) => page.evaluate(async () => { const s = await (window as any).staffCurrentSession(); return s && s.user ? String(s.user.id).replace(/^uid-/, '') : null; });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// every time this tab lands on the login page
const trackLoginPage = (page: Page) => { const navs: string[] = []; page.on('framenavigated', f => { if (f === page.mainFrame() && /index\.html/.test(f.url())) navs.push(f.url()); }); return navs; };

// ============ T1: password login, then the app uses the session ============
console.log('\nT1 password login (outside Telegram)');
{
    const w = makeWorld();
    const { ctx, page, dialogs } = await newPage(w);
    await page.goto(SITE + '/index.html');
    await page.fill('#login-code', 'KING1');
    await page.fill('#login-pass', 'kingpw1');
    await sleep(800);
    await page.click('#login-btn');
    ok('redirects to app.html', await waitApp(page), dialogs);
    await sleep(3500);
    ok('stays in the app (no forced logout)', page.url().includes('app.html'), { url: page.url(), dialogs });
    const my = JSON.parse(await ls(page, 'myAppUser') || 'null');
    ok('myAppUser saved without password', my && my.code === 'KING1' && !('password' in my), my);
    ok('active session is KING1', await sessionCode(page) === 'KING1');
    const rest = w.log.filter(l => l.p.startsWith('/rest/v1/') && l.p !== '/rest/v1/rpc/login_code_status');
    ok('app made data requests', rest.length > 5, rest.length);
    ok('every data request carries the user JWT (never a key as bearer)', rest.every(l => /^Bearer [^.]+\.[^.]+\.sig/.test(l.auth)), rest.filter(l => !/^Bearer [^.]+\.[^.]+\.sig/.test(l.auth)).slice(0, 3));
    ok('apikey header is the publishable key', rest.every(l => l.apikey === PUBLISHABLE));
    ok('no service_role key anywhere', !w.log.some(l => /service_role|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.eyJpc3MiOiJzdXBhYmFzZSIs/.test(l.auth + l.apikey)));
    ok('login page never read the employees table before login', !w.log.some(l => l.p === '/rest/v1/employees' && !/sig/.test(l.auth)));
    await ctx.close();
}

// ============ T2: wrong password / unknown code / brute force ============
console.log('\nT2 wrong password, unknown code, too many tries');
{
    const w = makeWorld();
    const { ctx, page, dialogs } = await newPage(w);
    await page.goto(SITE + '/index.html');
    await page.fill('#login-code', 'KING1'); await page.fill('#login-pass', 'nope'); await sleep(700);
    await page.click('#login-btn'); await sleep(1200);
    ok('wrong password message', dialogs.some(d => d.includes('وشەی نهێنییەکە هەڵەیە')), dialogs);
    ok('still on login page, no session', page.url().includes('index.html') && !(await sessionCode(page)));
    await page.fill('#login-code', 'ZZZZZ'); await page.fill('#login-pass', 'x123456'); await sleep(700);
    await page.click('#login-btn'); await sleep(1200);
    ok('unknown code message', dialogs.some(d => d.includes('بوونی نییە')), dialogs);
    for (let i = 0; i < 9; i++) { await page.fill('#login-code', 'KING1'); await page.fill('#login-pass', 'bad' + i); await page.click('#login-btn'); await sleep(350); }
    await page.fill('#login-pass', 'kingpw1'); await page.click('#login-btn'); await sleep(1200);
    ok('after 10 failures even the right password is refused for 15 min', dialogs.some(d => d.includes('١٥ خولەک')) && !page.url().includes('app.html'), dialogs.slice(-2));
    await ctx.close();
}

// ============ T3: existing user after rollout, inside Telegram → silent re-login ============
console.log('\nT3 existing user (no session yet) inside Telegram → silent');
{
    const w = makeWorld();
    const initData = sign({ user: { id: 500, first_name: 'King' }, query_id: 'Q' } as never, BOT, new Date());
    const old = { ...w.emps.KING1 };   // what the old app left in localStorage (incl. password!)
    const { ctx, page, dialogs } = await newPage(w, { initData, user: { id: 500, first_name: 'King' } }, { myAppUser: JSON.stringify(old) });
    await page.goto(SITE + '/index.html');
    ok('goes straight to app.html', await waitApp(page));
    await sleep(3500);
    ok('stays in the app with no password prompt', page.url().includes('app.html') && dialogs.length === 0, { url: page.url(), dialogs });
    ok('session established for KING1', await sessionCode(page) === 'KING1');
    await ctx.close();
}

// ============ T4: existing user after rollout, outside Telegram → asked to log in once ============
console.log('\nT4 existing user (no session) outside Telegram → one-time login');
{
    const w = makeWorld();
    const { ctx, page, dialogs } = await newPage(w, undefined, { myAppUser: JSON.stringify({ ...w.emps.MEMB1 }) });
    await page.goto(SITE + '/index.html');
    ok('sent back to the login page', await waitApp(page).then(() => waitIndex(page)));
    await sleep(1500);
    ok('explains why (security update)', dialogs.some(d => d.includes('نوێکردنەوەی ئاسایش')), dialogs);
    ok('old myAppUser removed (no redirect loop)', (await ls(page, 'myAppUser')) === null);
    await page.fill('#login-code', 'MEMB1'); await page.fill('#login-pass', 'memberpw'); await sleep(700);
    await page.click('#login-btn');
    ok('logs in normally after that', await waitApp(page));
    await ctx.close();
}

// ============ T5: Telegram signature forged → no access ============
console.log('\nT5 forged Telegram identity');
{
    const w = makeWorld();
    const forged = sign({ user: { id: 500, first_name: 'King' }, query_id: 'Q' } as never, '999:ATTACKER', new Date());
    const { ctx, page } = await newPage(w, { initData: forged, user: { id: 500, first_name: 'King' } });
    await page.goto(SITE + '/index.html');
    await sleep(2500);
    ok('stays on login page (old code would have logged in as KING1)', page.url().includes('index.html') && !(await sessionCode(page)), page.url());
    await ctx.close();
}

// ============ T6: first-time password setup ============
console.log('\nT6 first-time setup');
{
    const w = makeWorld();
    const { ctx, page, dialogs } = await newPage(w);
    await page.goto(SITE + '/index.html');
    await page.fill('#login-code', 'NEW01');
    await page.locator('#login-code').dispatchEvent('input');
    await page.waitForSelector('#pw-setup.show', { timeout: 5000 }).catch(() => null);
    const shown = await page.locator('#pw-setup.show').count();
    ok('setup panel appears for a code with no password', shown === 1);
    if (shown) {
        await page.fill('#pw-new', 'fresh123');
        const confirmSel = await page.$('#pw-confirm') ? '#pw-confirm' : (await page.$('#pw-new2') ? '#pw-new2' : null);
        if (confirmSel) await page.fill(confirmSel, 'fresh123');
        await page.locator('#pw-new').dispatchEvent('input');
        if (confirmSel) await page.locator(confirmSel).dispatchEvent('input');
        await page.click('#pw-setup-btn');
        ok('logs in after setting the password', await waitApp(page), dialogs);
        ok('password stored server-side', w.emps.NEW01.password === 'fresh123');
    }
    await ctx.close();
}

// ============ T7: account switching with parked sessions ============
console.log('\nT7 switch accounts and back (no password)');
{
    const w = makeWorld();
    const { ctx, page, dialogs } = await newPage(w);
    await page.goto(SITE + '/index.html');
    await page.fill('#login-code', 'KING1'); await page.fill('#login-pass', 'kingpw1'); await sleep(700);
    await page.click('#login-btn'); await waitApp(page); await sleep(2500);
    // add a second account
    await page.goto(SITE + '/index.html?add=1');
    await page.fill('#login-code', 'MEMB1'); await page.fill('#login-pass', 'memberpw'); await sleep(700);
    await page.click('#login-btn'); await waitApp(page); await sleep(2500);
    ok('now MEMB1', await sessionCode(page) === 'MEMB1');
    const parked1 = JSON.parse(await ls(page, 'staffSessions') || '{}');
    ok('KING1 session parked', !!parked1.KING1 && !parked1.MEMB1, parked1);
    await page.evaluate(() => (window as any).switchAccount('KING1'));
    await page.waitForLoadState('load'); await sleep(3500);
    ok('switched back to KING1 without a password', await sessionCode(page) === 'KING1' && page.url().includes('app.html'), { url: page.url(), dialogs });
    const parked2 = JSON.parse(await ls(page, 'staffSessions') || '{}');
    ok('MEMB1 parked, KING1 active', !!parked2.MEMB1 && !parked2.KING1, parked2);
    ok('parked token is never refreshed in the background (no reuse)', !Object.values(w.refresh).some(r => r.revoked && Object.values(parked2).includes(Object.keys(w.refresh).find(k => w.refresh[k] === r) as string)));
    await page.evaluate(() => (window as any).switchAccount('MEMB1'));
    await page.waitForLoadState('load'); await sleep(3500);
    ok('and to MEMB1 again', await sessionCode(page) === 'MEMB1');
    await ctx.close();
}

// ============ T8: impersonation (login_as) ============
console.log('\nT8 King uses «login as» on a member');
{
    const w = makeWorld();
    const { ctx, page } = await newPage(w);
    await page.goto(SITE + '/index.html');
    await page.fill('#login-code', 'KING1'); await page.fill('#login-pass', 'kingpw1'); await sleep(700);
    await page.click('#login-btn'); await waitApp(page); await sleep(3000);
    await page.evaluate(() => (window as any).loginAsAccount('MEMB1', 'Member'));
    await page.waitForLoadState('load'); await sleep(3500);
    ok('now inside MEMB1', await sessionCode(page) === 'MEMB1');
    const parked = JSON.parse(await ls(page, 'staffSessions') || '{}');
    ok('King session parked to come back', !!parked.KING1, parked);
    // a member trying login_as through the console is refused by the server
    const r = await page.evaluate(async () => { const s = await (window as any).staffCurrentSession(); return (window as any).staffLoginCall({ action: 'impersonate', target_code: 'KING1' }, s.access_token); });
    ok('member cannot impersonate the King (server says forbidden)', r && r.ok === false && r.error === 'forbidden', r);
    await ctx.close();
}

// ============ T9: suspension and password change kick the device ============
console.log('\nT9 suspended mid-session / password changed elsewhere');
{
    const w = makeWorld();
    const { ctx, page, dialogs } = await newPage(w);
    await page.goto(SITE + '/index.html');
    await page.fill('#login-code', 'MEMB1'); await page.fill('#login-pass', 'memberpw'); await sleep(700);
    await page.click('#login-btn'); await waitApp(page); await sleep(3000);
    w.emps.MEMB1.suspended = true;
    await page.evaluate(() => (window as any).ensureAccountActive());
    ok('suspended → logged out with the held message', await waitIndex(page) && dialogs.some(d => d.includes('ڕاگیراوە')), dialogs);
    ok('no session left on the device', !(await sessionCode(page)));
    await ctx.close();
}
{
    const w = makeWorld();
    const { ctx, page } = await newPage(w);
    await page.goto(SITE + '/index.html');
    await page.fill('#login-code', 'MEMB1'); await page.fill('#login-pass', 'memberpw'); await sleep(700);
    await page.click('#login-btn'); await waitApp(page); await sleep(3000);
    // own password change from the profile screen, driven through the real 2-step form
    const before = await sessionCode(page);
    await page.evaluate(async () => {
        (document.getElementById('pw-current') as HTMLInputElement).value = 'memberpw';
        await (window as any).verifyCurrentPassword();
        (document.getElementById('pw-new') as HTMLInputElement).value = 'newpass9';
        (document.getElementById('pw-confirm') as HTMLInputElement).value = 'newpass9';
    });
    await page.evaluate(async () => { try { await (window as any).submitPasswordChange(); } catch (e) { } });
    await sleep(2500);
    ok('own password change: server revoked old sessions but this device re-logged in', before === 'MEMB1' && await sessionCode(page) === 'MEMB1' && page.url().includes('app.html') && w.emps.MEMB1.password === 'newpass9', { pw: w.emps.MEMB1.password, url: page.url() });
    await ctx.close();
}

// ============ T10: retry of lost POSTs still works with sessions ============
console.log('\nT10 iPhone-style lost POSTs');
{
    const w = makeWorld();
    const { ctx, page } = await newPage(w);
    let dropped = 0;
    await page.route(/\/rest\/v1\/rpc\/orders_page/, async r => { if (dropped < 2) { dropped++; return r.abort('connectionreset'); } return serveSupabase(w, r); });
    await page.goto(SITE + '/index.html');
    await page.fill('#login-code', 'KING1'); await page.fill('#login-pass', 'kingpw1'); await sleep(700);
    await page.click('#login-btn'); await waitApp(page); await sleep(5000);
    const err = await page.locator('.conn-err').count();
    ok('orders list recovered after 2 dropped POSTs (no «connection failed»)', dropped === 2 && err === 0, { dropped, err });
    await ctx.close();
}

// ============ T11: Supabase per-IP limit on login verification ============
console.log('\nT11 rate-limited verification (shared mobile IP)');
{
    const w = makeWorld();
    const { ctx, page, dialogs } = await newPage(w);
    await page.route(/\/auth\/v1\/verify/, r => r.fulfill({ status: 429, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ code: 'over_request_rate_limit', msg: 'Request rate limit reached' }) }));
    await page.goto(SITE + '/index.html');
    await page.fill('#login-code', 'KING1'); await page.fill('#login-pass', 'kingpw1'); await sleep(700);
    await page.click('#login-btn'); await sleep(2000);
    ok('clear «wait a minute» message, stays on login page', dialogs.some(d => d.includes('یەک خولەک')) && page.url().includes('index.html'), dialogs);
    await ctx.close();
}

// ============ T12: a suspended account's session is still on this device ============
console.log('\nT12 suspended account still holding a session on this device');
{
    // someone else sets their first password on the same device
    const w = makeWorld();
    const { ctx, page, dialogs } = await newPage(w);
    await page.goto(SITE + '/index.html');
    await page.fill('#login-code', 'MEMB1'); await page.fill('#login-pass', 'memberpw'); await sleep(700);
    await page.click('#login-btn'); await waitApp(page); await sleep(2500);
    w.emps.MEMB1.suspended = true;
    await page.goto(SITE + '/index.html?add=1');
    await page.fill('#login-code', 'NEW01');
    await page.locator('#login-code').dispatchEvent('input');
    await page.waitForSelector('#pw-setup.show', { timeout: 5000 }).catch(() => null);
    const shown = await page.locator('#pw-setup.show').count();
    ok('code check still works (stale session dropped, asked as a guest)', shown === 1, dialogs);
    if (shown) {
        await page.fill('#pw-new', 'fresh123');
        const confirmSel = await page.$('#pw-confirm') ? '#pw-confirm' : (await page.$('#pw-new2') ? '#pw-new2' : null);
        if (confirmSel) await page.fill(confirmSel, 'fresh123');
        await page.locator('#pw-new').dispatchEvent('input');
        if (confirmSel) await page.locator(confirmSel).dispatchEvent('input');
        await page.click('#pw-setup-btn');
        ok('first password set and logged in', await waitApp(page) && w.emps.NEW01.password === 'fresh123', dialogs);
    }
    await ctx.close();
}
{
    // switching to a saved account that was suspended meanwhile
    const w = makeWorld();
    const { ctx, page, dialogs } = await newPage(w);
    await page.goto(SITE + '/index.html');
    await page.fill('#login-code', 'MEMB1'); await page.fill('#login-pass', 'memberpw'); await sleep(700);
    await page.click('#login-btn'); await waitApp(page); await sleep(2500);
    await page.goto(SITE + '/index.html?add=1');
    await page.fill('#login-code', 'KING1'); await page.fill('#login-pass', 'kingpw1'); await sleep(700);
    await page.click('#login-btn'); await waitApp(page); await sleep(2500);
    w.emps.MEMB1.suspended = true;   // KING1 active, MEMB1 parked
    await page.goto(SITE + '/index.html?add=1');
    await page.evaluate(() => (window as any).quickLogin('MEMB1'));
    await sleep(1500);
    ok('held message, not «no longer exists»', dialogs.some(d => d.includes('ڕاگیراوە')) && !dialogs.some(d => d.includes('بوونی نییە')), dialogs);
    ok('suspended account kept in the saved list', JSON.parse(await ls(page, 'savedAccounts') || '[]').some((a: { code: string }) => a.code === 'MEMB1'));
    ok('its session is not left active on the device', await sessionCode(page) !== 'MEMB1');
    ok('KING1 session still parked to come back', !!JSON.parse(await ls(page, 'staffSessions') || '{}').KING1);
    ok('stays on the login page', page.url().includes('index.html'));
    await page.evaluate(() => (window as any).quickLogin('KING1'));
    ok('tapping KING1 goes back in without a password', await waitApp(page) && (await sleep(2500), await sessionCode(page)) === 'KING1', { url: page.url(), dialogs });
    await ctx.close();
}

// ============ T13: the same account logs in twice at the same moment ============
// Seen on production: one phone, two pages of the Mini App → two staff-login calls 55 ms
// apart. Supabase keeps only the newest magic link, so the first page's link is dead.
console.log('\nT13 the same account logs in twice at the same moment');
{
    // two tabs / web views on one device (they share localStorage)
    const w = makeWorld();
    w.opt.loginDelayMs = 1500;   // both links are issued before either is used
    const initData = sign({ user: { id: 500, first_name: 'King' }, query_id: 'Q' } as never, BOT, new Date());
    const tg = { initData, user: { id: 500, first_name: 'King' } };
    const { ctx, page, dialogs } = await newPage(w, tg, { myAppUser: JSON.stringify({ ...w.emps.KING1, password: undefined }) });
    const tab2 = await addPage(ctx, w, tg);
    const navs1 = trackLoginPage(page), navs2 = trackLoginPage(tab2.page);
    await Promise.all([page.goto(SITE + '/app.html'), tab2.page.goto(SITE + '/app.html')]);
    await sleep(9000);
    const calls = w.log.filter(l => l.m === 'POST' && l.p === '/functions/v1/staff-login').length;
    ok('the two logins really collided (a link was replaced)', calls >= 2 && w.stats.verifyFail >= 1, { calls, verifyFail: w.stats.verifyFail });
    ok('no bounce through the login page, no extra login round', navs1.length === 0 && navs2.length === 0 && calls === 2, { navs1, navs2, calls });
    const relogin = (d: string[]) => d.some(x => x.includes('نوێکردنەوەی ئاسایش'));
    ok('tab 1 is in the app as KING1, never told to log in again', page.url().includes('app.html') && await sessionCode(page) === 'KING1' && !relogin(dialogs), { url: page.url(), dialogs });
    ok('tab 2 is in the app as KING1, never told to log in again', tab2.page.url().includes('app.html') && await sessionCode(tab2.page) === 'KING1' && !relogin(tab2.dialogs), { url: tab2.page.url(), dialogs: tab2.dialogs });
    await ctx.close();
}
{
    // two devices (separate storage)
    const w = makeWorld();
    w.opt.loginDelayMs = 1500;
    const initData = sign({ user: { id: 500, first_name: 'King' }, query_id: 'Q' } as never, BOT, new Date());
    const tg = { initData, user: { id: 500, first_name: 'King' } };
    const seed = { myAppUser: JSON.stringify({ ...w.emps.KING1, password: undefined }) };
    const a = await newPage(w, tg, seed);
    const b = await newPage(w, tg, seed);
    const navsA = trackLoginPage(a.page), navsB = trackLoginPage(b.page);
    await Promise.all([a.page.goto(SITE + '/app.html'), b.page.goto(SITE + '/app.html')]);
    await sleep(9000);
    const relogin = (d: string[]) => d.some(x => x.includes('نوێکردنەوەی ئاسایش'));
    const calls = w.log.filter(l => l.m === 'POST' && l.p === '/functions/v1/staff-login').length;
    ok('two devices: the logins collided', w.stats.verifyFail >= 1, w.stats);
    ok('two devices: the loser asks once more instead of bouncing to the login page', navsA.length === 0 && navsB.length === 0 && calls === 3, { navsA, navsB, calls });
    ok('two devices: both end in the app as KING1 without «log in again»',
        a.page.url().includes('app.html') && b.page.url().includes('app.html')
        && await sessionCode(a.page) === 'KING1' && await sessionCode(b.page) === 'KING1'
        && !relogin(a.dialogs) && !relogin(b.dialogs),
        { a: a.page.url(), b: b.page.url(), da: a.dialogs, db: b.dialogs });
    await a.ctx.close(); await b.ctx.close();
}

await browser.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
