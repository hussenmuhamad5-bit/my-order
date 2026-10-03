// ============================================================
//  staff-login — لۆجیکی چوونەژوورەوە (بێ هیچ پەیوەندییەکی ڕاستەوخۆ)
// ------------------------------------------------------------
//  ئەم فایلە هیچ شتێکی Supabase یان Deno import ناکات: هەموو
//  داواکارییەکانی داتابەیس لە `deps`ـەوە دێن. بۆیە هەمان کۆد لە
//  Edge Function (Deno) و لە تاقیکردنەوەی ناوخۆیی (Node) کاردەکات.
//  `index.ts` تەنها `deps`ی ڕاستەقینە دروست دەکات.
//
//  کردارەکان (`action`):
//    password    — کۆد + پاسوۆرد (+ initData بۆ بەستنەوەی تلیگرام)
//    setup       — دانانی پاسوۆردی یەکەم بۆ کۆدی نوێ
//    telegram    — ناسینەوەی خۆکار بە initDataـی واژووکراوی تلیگرام
//    impersonate — «چوونەژوورەوە بەم ئەکاونتە» (دەسەڵاتی login_as)
//
//  وەڵامی سەرکەوتوو: { ok, token_hash, type, employee }
//  کڵاینت `supabase.auth.verifyOtp({ token_hash, type })` بانگ دەکات
//  و sessionـەکە وەردەگرێت. ⚠️ `token_hash` تەنها یەک جار کاردەکات.
//
//  ⚠️ پاسوۆرد هەرگیز لە وەڵامدا ناگەڕێتەوە.
// ============================================================

export type Employee = {
    code: string;
    password?: string | null;
    suspended?: boolean | null;
    auth_user_id?: string | null;
    role?: string | null;
    permissions?: unknown;
    telegram_id?: string | null;
    telegram_username?: string | null;
    telegram_name?: string | null;
    [k: string]: unknown;
};

export type TgUser = { id: string; username: string; name: string };

export interface Deps {
    getEmployee(code: string): Promise<Employee | null>;
    findEmployeesByTelegram(tgId: string): Promise<Employee[]>;
    hasActiveChatLink(code: string, tgId: string): Promise<boolean>;
    updateEmployee(code: string, patch: Record<string, unknown>): Promise<Employee>;
    linkChat(code: string, tg: TgUser): Promise<void>;
    recentFailures(code: string, sinceIso: string): Promise<number>;
    recordFailure(code: string): Promise<void>;
    botTokens(): Promise<string[]>;
    /** بەکارهێنەری Auth دروست/بەستنەوە دەکات و لینکی یەکجاری دەگەڕێنێتەوە */
    issueLogin(emp: Employee): Promise<{ token_hash: string; type: string }>;
    userFromJwt(jwt: string): Promise<string | null>;
    employeeByAuthUser(uid: string): Promise<Employee | null>;
    now(): number;
}

// ---- ڕێکخستنەکان ----
export const FAIL_LIMIT = 10;             // هەوڵی هەڵە
export const FAIL_WINDOW_MS = 15 * 60e3;  // لە ١٥ خولەکدا
export const TG_MAX_AGE_S = 24 * 3600;    // initData تا ٢٤ کاتژمێر
export const PW_MIN = 6, PW_MAX = 15;     // هەمان سنووری پەڕەی چوونەژوورەوە

export const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
}
const fail = (status: number, error: string) => json(status, { ok: false, error });

// ---- یارمەتییە پاکەکان ----

const enc = new TextEncoder();

/** بەراوردی کاتی-جێگیر — کاتی وەڵام ئاشکرای ناکات چەند پیت ڕاستە */
export function safeEqual(a: string, b: string): boolean {
    const x = enc.encode(String(a));
    const y = enc.encode(String(b));
    const n = Math.max(x.length, y.length);
    let diff = x.length ^ y.length;
    for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
    return diff === 0;
}

/**
 * ئیمەیڵی ناوخۆیی بۆ بەکارهێنەری Auth — هەرگیز ئیمەیڵی بۆ نانێردرێت.
 * کۆدەکان هەستیارن بۆ پیتی گەورە/بچووک (`SIOi7` ≠ `sioi7`) بەڵام
 * ئیمەیڵ نییە، بۆیە کۆدەکە بە hex دەنووسرێت.
 * `.invalid` (RFC 2606) هەرگیز ناتوانێت پۆستی پێبگات.
 */
export function staffEmail(code: string, domain = 'staff.my-order.invalid'): string {
    const hex = Array.from(enc.encode(code), (b) => b.toString(16).padStart(2, '0')).join('');
    return `e${hex}@${domain}`;
}

/** ڕیزی کارمەند بەبێ پاسوۆرد — ئەوەی دەچێتە `localStorage` */
export function publicRow(emp: Employee): Record<string, unknown> {
    const { password: _p, auth_user_id: _a, ...rest } = emp;
    return rest;
}

const isHeld = (emp: Employee | null) => !!(emp && emp.suspended);
const hasPassword = (emp: Employee) => String(emp.password ?? '').trim() !== '';

/**
 * هەمان یاسای `can('login_as')` لە app.html:
 *   پاشا → بەڵێ؛ فۆرماتی نوێی دەسەڵات → `login_as === true`؛
 *   ئەگەرنا بنەڕەتی پلە — کە تەنها پاشا login_asـی هەیە.
 */
export function canLoginAs(emp: Employee): boolean {
    const aliases: Record<string, string> = { 'ئەدمین': 'سەرپەرشت' };
    const role = aliases[String(emp.role ?? '')] ?? String(emp.role ?? '');
    if (role === 'پاشا') return true;
    let p: unknown = emp.permissions;
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = null; } }
    if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
    const o = p as Record<string, unknown>;
    const newFormat = 'view_orders' in o || 'create_key' in o || 'distribute' in o || 'change_status' in o;
    return newFormat && o.login_as === true;
}

// `BufferSource`/`ArrayBuffer` — نەک `Uint8Array` — تا لەگەڵ هەردوو
// TypeScriptـی کۆن (Deno) و نوێ (کە Uint8Array بووەتە generic) کاربکات
async function hmacSha256(key: BufferSource, data: BufferSource): Promise<ArrayBuffer> {
    const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return crypto.subtle.sign('HMAC', k, data);
}
const toHex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * پشکنینی واژووی initDataـی تلیگرام (core.telegram.org/bots/webapps
 * → «Validating data received via the Mini App»).
 *   secret = HMAC_SHA256(key="WebAppData", data=bot_token)
 *   hash   = hex(HMAC_SHA256(key=secret, data=data_check_string))
 *   data_check_string = هەموو خانەکان بێجگە لە `hash`، ڕیزکراو، بە \n
 * ⚠️ `signature` (Bot API 8+) **لە ناویدا دەمێنێت** — تەنها `hash` لادەبرێت.
 * چەند تۆکنێک قبوڵ دەکات (بۆ کاتی گۆڕینی تۆکنی بۆت).
 */
export async function verifyInitData(
    initData: string, tokens: string[], nowMs: number, maxAgeS = TG_MAX_AGE_S,
): Promise<TgUser | null> {
    if (!initData || typeof initData !== 'string' || initData.length > 8192) return null;
    const params = new URLSearchParams(initData);
    const hash = params.get('hash') || '';
    if (!/^[0-9a-f]{64}$/i.test(hash)) return null;

    const pairs: string[] = [];
    params.forEach((v, k) => { if (k !== 'hash') pairs.push(`${k}=${v}`); });
    pairs.sort();
    const dcs = enc.encode(pairs.join('\n'));

    let valid = false;
    for (const token of tokens) {
        if (!token) continue;
        const secret = await hmacSha256(enc.encode('WebAppData'), enc.encode(token));
        const sig = toHex(await hmacSha256(secret, dcs));
        if (safeEqual(sig, hash.toLowerCase())) { valid = true; break; }
    }
    if (!valid) return null;

    const authDate = Number(params.get('auth_date'));
    const nowS = Math.floor(nowMs / 1000);
    if (!Number.isFinite(authDate) || authDate > nowS + 60 || nowS - authDate > maxAgeS) return null;

    try {
        const u = JSON.parse(params.get('user') || 'null');
        if (!u || u.id == null) return null;
        const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
        return { id: String(u.id), username: String(u.username || ''), name };
    } catch {
        return null;
    }
}

const str = (v: unknown, max: number): string | null =>
    (typeof v === 'string' && v.length > 0 && v.length <= max) ? v : null;

// ---- سەرەکی ----

export function createHandler(deps: Deps) {
    async function tgFrom(initData: unknown): Promise<TgUser | null> {
        const s = str(initData, 8192);
        if (!s) return null;
        return verifyInitData(s, await deps.botTokens(), deps.now());
    }

    // ناسنامەی تلیگرام دەبەسترێتەوە — هەمان کاری پێشووی index.html،
    // بەڵام ئێستا تەنها کاتێک واژووەکە ڕاستە
    async function linkTelegram(emp: Employee, tg: TgUser | null): Promise<Employee> {
        if (!tg) return emp;
        let fresh = emp;
        if (String(emp.telegram_id ?? '') !== tg.id
            || String(emp.telegram_username ?? '') !== tg.username
            || String(emp.telegram_name ?? '') !== tg.name) {
            fresh = await deps.updateEmployee(emp.code, {
                telegram_id: tg.id, telegram_username: tg.username, telegram_name: tg.name,
            });
        }
        try { await deps.linkChat(emp.code, tg); } catch { /* ئاگادارکردنەوە نابێت چوونەژوورەوە بوەستێنێت */ }
        return fresh;
    }

    async function success(emp: Employee): Promise<Response> {
        const link = await deps.issueLogin(emp);
        return json(200, { ok: true, token_hash: link.token_hash, type: link.type, employee: publicRow(emp) });
    }

    async function doPassword(body: Record<string, unknown>): Promise<Response> {
        const code = str(body.code, 64);
        const password = str(body.password, 128);
        if (!code || !password) return fail(400, 'bad_request');

        const since = new Date(deps.now() - FAIL_WINDOW_MS).toISOString();
        if (await deps.recentFailures(code, since) >= FAIL_LIMIT) return fail(429, 'too_many');

        const emp = await deps.getEmployee(code);
        if (!emp) return fail(404, 'no_code');
        if (isHeld(emp)) return fail(403, 'held');
        if (!hasPassword(emp)) return fail(409, 'needs_setup');
        if (!safeEqual(String(emp.password), password)) {
            await deps.recordFailure(code);
            return fail(401, 'bad_password');
        }
        return success(await linkTelegram(emp, await tgFrom(body.init_data)));
    }

    async function doSetup(body: Record<string, unknown>): Promise<Response> {
        const code = str(body.code, 64);
        const pw = typeof body.new_password === 'string' ? body.new_password : '';
        if (!code) return fail(400, 'bad_request');
        if (pw.length < PW_MIN || pw.length > PW_MAX) return fail(400, 'bad_length');

        const emp = await deps.getEmployee(code);
        if (!emp) return fail(404, 'no_code');
        if (isHeld(emp)) return fail(403, 'held');
        // لەوانەیە لە ئامێرێکی تر لەم ماوەیەدا دانرابێت
        if (hasPassword(emp)) return fail(409, 'has_password');

        const tg = await tgFrom(body.init_data);
        const patch: Record<string, unknown> = { password: pw };
        if (tg) Object.assign(patch, { telegram_id: tg.id, telegram_username: tg.username, telegram_name: tg.name });
        const fresh = await deps.updateEmployee(code, patch);
        if (tg) { try { await deps.linkChat(code, tg); } catch { /* هیچ */ } }
        return success(fresh);
    }

    async function doTelegram(body: Record<string, unknown>): Promise<Response> {
        const tg = await tgFrom(body.init_data);
        if (!tg) return fail(401, 'tg_invalid');

        // ئەگەر ئامێرەکە ئەکاونتێکی دیاریکراوی هەبوو و ئەم تلیگرامە
        // پێشتر بەو ئەکاونتەوە بەسترابێت → هەمان ئەکاونت
        let emp: Employee | null = null;
        const prefer = str(body.prefer_code, 64);
        if (prefer) {
            const p = await deps.getEmployee(prefer);
            if (p && (String(p.telegram_id ?? '') === tg.id || await deps.hasActiveChatLink(prefer, tg.id))) emp = p;
            // `strict`: تەنها ئەو ئەکاونتە — نەک ئەکاونتێکی تری هەمان تلیگرام
            // (ئاڵوگۆڕی ئەکاونت، گەڕانەوەی ئەپ)
            if (!emp && body.strict === true) return fail(404, 'not_linked');
        }
        if (!emp) {
            const list = await deps.findEmployeesByTelegram(tg.id);
            emp = list[0] ?? null;
        }
        if (!emp) return fail(404, 'not_linked');
        if (isHeld(emp)) return fail(403, 'held');
        return success(emp);
    }

    async function doImpersonate(body: Record<string, unknown>, req: Request): Promise<Response> {
        const auth = req.headers.get('authorization') || '';
        const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
        if (!jwt) return fail(401, 'no_session');
        const uid = await deps.userFromJwt(jwt);
        if (!uid) return fail(401, 'no_session');

        const caller = await deps.employeeByAuthUser(uid);
        if (!caller || isHeld(caller)) return fail(403, 'not_staff');
        if (!canLoginAs(caller)) return fail(403, 'forbidden');

        const code = str(body.target_code, 64);
        if (!code) return fail(400, 'bad_request');
        const target = await deps.getEmployee(code);
        if (!target) return fail(404, 'no_code');
        if (isHeld(target)) return fail(403, 'held');
        return success(target);
    }

    return async function handle(req: Request): Promise<Response> {
        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
        if (req.method !== 'POST') return fail(405, 'method');

        let body: Record<string, unknown>;
        try {
            const b = await req.json();
            if (!b || typeof b !== 'object' || Array.isArray(b)) return fail(400, 'bad_request');
            body = b as Record<string, unknown>;
        } catch {
            return fail(400, 'bad_request');
        }

        try {
            switch (body.action) {
                case 'password': return await doPassword(body);
                case 'setup': return await doSetup(body);
                case 'telegram': return await doTelegram(body);
                case 'impersonate': return await doImpersonate(body, req);
                default: return fail(400, 'bad_action');
            }
        } catch (e) {
            console.error('staff-login', body.action, e);
            return fail(500, 'server');
        }
    };
}
