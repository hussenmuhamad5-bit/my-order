// لینکی گۆگڵ سکرێپت بۆ بەشی ئۆردەرەکان (لینکی خۆت دابنێ)
var APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwtKMGXHm2XEA499c8HT9GDaSsMPQsMpTiZT56ju4LlfWw2_cOgZ-vvSOvvpXYc4nlcZQ/exec";
var SUPABASE_URL = "https://kxztaywhqpekjmjoynin.supabase.co";
// ============================================================
//  کلیلی **گشتی** (publishable) — بە ئەنقەست لێرەیە و نهێنی نییە
// ------------------------------------------------------------
//  ⚠️ پێشتر کلیلی `service_role` لێرە بوو. ئەو کلیلە RLS
//     تێدەپەڕێنێت، و ئەم فایلە گشتییە (GitHub + سایتەکە) — واتا
//     هەر کەسێک لە ئینتەرنێت دەسەڵاتی تەواوی هەبوو بەسەر داتابەیسدا.
//  ئەم کلیلە بەتەنها **هیچ** دەسەڵاتێکی نییە (db/100): هەموو داتاکە
//  بە sessionـی کارمەندەوە دێت، کە بە `staff-login` وەردەگیرێت.
//  ⛔ هەرگیز کلیلی `sb_secret_…` یان `service_role` لێرە دامەنێ.
// ============================================================
var SUPABASE_KEY = "sb_publishable_a4_jL7fSgtlcD3j4e9e3sw_75AZBCwz";

// ============================================================
//  دووبارە ناردنەوەی خۆکار بۆ داواکارییە خوێندنەوەییەکان
// ------------------------------------------------------------
//  ⚠️ هەندێک ئایفۆن لەسەر هەندێک ئینتەرنێت (بەتایبەتی Kurdistan Net
//     و I.Q Online) لە ٥٠–٧٠%ی داواکارییە POSTـەکانیان ون دەبن:
//     لۆگی Supabase پیشانی دەدات کە preflight (OPTIONS) دەگات، بەڵام
//     POSTـەکە هەرگیز ناگات. GETـەکان کاردەکەن چونکە Safari و
//     کتێبخانەی supabase-js خۆیان بێدەنگ دووبارەیان دەکەنەوە
//     (`RETRYABLE_METHODS = GET/HEAD/OPTIONS`) — بەڵام POST هەرگیز.
//     هەموو `supabase.rpc()`ـێک POSTـە، بۆیە ئۆردەرەکان و جووڵەکانی
//     جزدان شکستیان دەهێنا («پەیوەندی نەکرا») لە کاتێکدا باڵانس
//     (GET) دەهات. ئەندرۆید و تۆڕەکانی تر ئەم کێشەیەیان نییە.
//
//  ئێستا ئەگەر RPCـێکی خوارەوە لە ئاستی تۆڕدا شکستی هێنا (نەک
//  وەڵامی هەڵە لە سێرڤەرەوە)، تا ٣ جار دووبارە دەنێردرێتەوە.
//  GET لێرە دووبارە ناکرێتەوە — کتێبخانەکە خۆی دەیکات.
//
//  ⚠️ لیستەکە تەنها فەنکشنی STABLEـە (`pg_proc.provolatile = 's'`).
//     PostgREST ئەمانە لە ترانزاکشنی تەنها-خوێندنەوەدا جێبەجێ دەکات،
//     بۆیە دووبارەکردنەوەیان **ناتوانێت** هیچ شتێک دووجار بنووسێت.
//     فەنکشنێکی نوێ کە دەنووسێت (پارە، ئۆردەر، کۆمێنت…) **هەرگیز**
//     لێرە زیاد مەکە — ئەگەر داواکارییەکە گەیشتبێت و تەنها وەڵامەکە
//     ون بووبێت، دووبارەکردنەوە دەبێتە دوو جار نووسین.
// ============================================================
var SB_RETRY_RPCS = {
    orders_page: 1, orders_status_counts: 1, orders_day_counts: 1, orders_member_counts: 1,
    wallet_tx_page: 1, wallet_tx_hold: 1, wallets_overview: 1,
    member_stats: 1, rank_page: 1, login_code_status: 1,
    notifications_page: 1, my_notif_unread_counts: 1, my_notif_unread_by_kind: 1,
    my_unread_comment_counts: 1, my_unread_announcements: 1, announcements_by_ids: 1, announcement_stats: 1,
    order_comments_page: 1, order_comment_reactions_page: 1, order_comment_readers: 1,
    my_trash_page: 1, trash_page: 1, trash_counts: 1, trash_payload: 1,
    quick_phrases_list: 1, quick_phrases_admin: 1,
    cosmetics_catalog: 1, cosmetics_admin_list: 1, shop_home: 1,
    reward_progress_list: 1, reward_claims_list: 1,
    current_emp_code: 1
};
var SB_RETRY_DELAYS = [300, 800, 1600];   // میلیچرکە — ٣ هەوڵی زیادە

function _sbCanRetry(url, method) {
    if (method !== 'POST') return false;
    // تەواوکردنی چوونەژوورەوە (`verifyOtp`). بێ‌مەترسییە: تۆکنەکە
    // تەنها یەک جار کاردەکات، بۆیە ئەگەر یەکەمیان گەیشتبێت دووەمیان
    // تەنها هەڵە دەداتەوە — هیچ شتێک دووجار نابێت.
    if (/\/auth\/v1\/verify(?:[?#]|$)/.test(url)) return true;
    var m = /\/rest\/v1\/rpc\/([A-Za-z0-9_]+)(?:[?#]|$)/.exec(url);
    return !!(m && SB_RETRY_RPCS[m[1]]);
}

function sbFetch(input, init) {
    var url = typeof input === 'string' ? input : String((input && input.url) || input);
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (!_sbCanRetry(url, method)) return fetch(input, init);

    var attempt = 0;
    function run() {
        return fetch(input, init).catch(function (err) {
            // AbortError = کۆدەکە خۆی ڕایگرت، نەک تۆڕ — دووبارە مەکەرەوە
            if ((err && err.name === 'AbortError') || attempt >= SB_RETRY_DELAYS.length) throw err;
            var wait = SB_RETRY_DELAYS[attempt++];
            console.warn('sbFetch: هەوڵی ' + (attempt + 1) + ' بۆ ' + method + ' ' + url.split('?')[0], err);
            return new Promise(function (r) { setTimeout(r, wait); }).then(run);
        });
    }
    return run();
}

// Initialize Supabase client
var supabase = null;
// کتێبخانەکە خۆی — `window.supabase` دوای `createClient` دەبێتە
// کڵاینتەکە، بۆیە ڕیفرێنسێکی جیا پێویستە بۆ کڵاینتی کاتی (بڕوانە
// `staffSwitchTo`).
var SB_LIB = null;

// Function to initialize Supabase
function initializeSupabase() {
    try {
        if (window.supabase && window.supabase.createClient) {
            SB_LIB = window.supabase;
            supabase = SB_LIB.createClient(SUPABASE_URL, SUPABASE_KEY, {
                global: { fetch: sbFetch },
                auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
            });
            
            // Check if the client has the required methods
            if (supabase && supabase.from && typeof supabase.from === 'function') {
                console.log('Supabase client initialized successfully');
                return true;
            } else if (supabase && supabase.rest && supabase.rest.from && typeof supabase.rest.from === 'function') {
                // For UMD build, the database methods might be under .rest
                supabase.from = supabase.rest.from.bind(supabase.rest);
                console.log('Supabase client initialized successfully (using .rest.from)');
                return true;
            } else {
                console.error('Supabase client does not have from method');
                console.log('Available methods:', Object.getOwnPropertyNames(supabase));
                return false;
            }
        } else {
            console.error('Supabase library not loaded or createClient not available');
            return false;
        }
    } catch (error) {
        console.error('Error initializing Supabase:', error);
        return false;
    }
}

// ============================================================
//  بارکردنی کتێبخانەی Supabase
// ------------------------------------------------------------
//  ⚠️ پێشتر تەنها یەک CDN بوو. لەسەر هەندێک ئینتەرنێت — بەتایبەتی
//     لەسەر مۆبایلی هەندێک کۆمپانیا — `cdn.jsdelivr.net` ڕێگری
//     لێدەکرێت یان خاوە. ئەوکات `window.supabase` هەرگیز دروست
//     نەدەبوو و هەموو داواکارییەکان شکستیان دەهێنا بە پەیامی
//     «کێشە لە پەیوەندی هەیە» — لە کاتێکدا ئینتەرنێتەکە باش بوو.
//
//  ئێستا سێ سەرچاوە بەدوای یەکەوە تاقی دەکرێنەوە، و هەریەکەیان
//  کاتی دیاریکراوی هەیە (٨ چرکە) — ئەگەرنا CDNـێکی خاو هەموو
//  کردنەوەی ئەپەکە ڕادەگرێت.
// ============================================================
//  یەکەم سەرچاوە **هەمان سەرچاوەی ئەپەکەیە** (`vendor/`). ئەگەر
//  پەڕەکە خۆی هاتبێت، ئەم فایلەش دێت — بۆیە هیچ لایەنێکی سێیەم
//  ناتوانێت ڕێگری بکات. CDNــەکان تەنها وەک پاشەکەوت ماونەتەوە.
var SUPABASE_CDNS = [
    'vendor/supabase.min.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
    'https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.min.js'
];

// ⚠️ `var supabase` لە ئاستی سەرەوەیە، واتا هەر خۆی
//    `window.supabase`ــە. دوای `createClient`، ئەو خانەیە دەبێتە
//    **کڵاینتەکە** نەک کتێبخانەکە — بۆیە `window.supabase` بوونی
//    هەیە بەڵام `createClient`ــی نییە. ئەم ئاڵایە جیاوازییەکە
//    ڕوون دەکاتەوە، ئەگەرنا دووبارە هەوڵدانەوە هەڵە بڕیار دەدات.
var _sbLibLoaded = false;

function _loadScriptOnce(src, timeoutMs) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        let done = false;
        const finish = (ok, err) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            ok ? resolve() : reject(err || new Error('load failed'));
        };
        const timer = setTimeout(() => {
            script.remove();
            finish(false, new Error('timeout: ' + src));
        }, timeoutMs || 8000);

        script.src = src;
        script.onload = () => finish(_sbLibReady(), new Error('loaded but empty: ' + src));
        script.onerror = () => { script.remove(); finish(false, new Error('error: ' + src)); };
        document.head.appendChild(script);
    });
}

function _sbLibReady() {
    return !!(window.supabase && window.supabase.createClient);
}

function loadSupabaseScript() {
    if (_sbLibLoaded || _sbLibReady()) return Promise.resolve();

    let chain = Promise.reject();
    SUPABASE_CDNS.forEach(src => {
        chain = chain.catch(() => {
            if (_sbLibReady()) return;
            return _loadScriptOnce(src, 8000);
        });
    });

    return chain.then(() => {
        _sbLibLoaded = true;
        console.log('Supabase script loaded');
    }).catch(err => {
        console.error('Failed to load Supabase from all sources', err);
        throw new Error('Failed to load Supabase script');
    });
}

// Try to initialize immediately
if (typeof window !== 'undefined') {
    initializeSupabase();
}

// ============================================================
//  چوونەژوورەوەی کارمەند (session) — هاوبەش بۆ index.html و app.html
// ------------------------------------------------------------
//  `staff-login` (Edge Function) کۆد/پاسوۆرد یان initDataـی تلیگرام
//  لەسەر سێرڤەر دەپشکنێت و `token_hash`ـێکی یەکجاری دەداتەوە؛
//  `verifyOtp` ئەوە دەکات بە session. supabase-js خۆی sessionـەکە
//  هەڵدەگرێت (`localStorage`) و نوێی دەکاتەوە.
//
//  چەند ئەکاونت لەسەر یەک ئامێر: تەنها یەک session چالاکە. کاتێک
//  ئەکاونت دەگۆڕدرێت، refresh tokenـی ئەکاونتی پێشوو لە
//  `staffSessions` «پارک» دەکرێت و دواتر بەکاردەهێنرێتەوە.
//  ⚠️ تۆکنی پارککراو هەرگیز لە پشتەوە نوێ ناکرێتەوە — ئەگەرنا
//     کۆپییەکەی ناو `staffSessions` کۆن دەبێت و Supabase وەک
//     «دووبارە بەکارهێنان» دەیبینێت و هەموو sessionـەکە دەکوژێت.
// ============================================================
var STAFF_LOGIN_URL = SUPABASE_URL + '/functions/v1/staff-login';
var STAFF_LOGIN_MSGS = {
    no_code: "❌ ئەم کۆدە بوونی نییە!",
    bad_password: "❌ وشەی نهێنییەکە هەڵەیە!",
    held: "⛔ ئەم ئەکاونتە ڕاگیراوە. پەیوەندی بە بەڕێوەبەرایەتییەوە بکە.",
    too_many: "⛔ هەوڵی هەڵە زۆر بوو — ١٥ خولەک چاوەڕێ بکە و دووبارە هەوڵ بدەوە.",
    bad_length: "⚠️ وشەی نهێنی دەبێت لە نێوان 6 بۆ 15 پیت یان ژمارە بێت!",
    has_password: "⚠️ ئەم کۆدە ئێستا پاسوۆردی لەسەر دانراوە. تکایە بە پاسوۆردەکەت بچۆ ژوورەوە.",
    network: "❌ کێشە لە پەیوەندی ئینتەرنێت هەیە.",
    verify_failed: "❌ چوونەژوورەوە تەواو نەبوو — دووبارە هەوڵ بدەوە.",
    // Supabase بۆ هەر IPـێک سنووری هەیە (~٣٠ چوونەژوورەوە بە یەکجار). لەسەر
    // ئینتەرنێتی مۆبایل زۆر کەس یەک IPـیان هەیە — بە تایبەتی ڕۆژی نوێکردنەوە.
    rate_limited: "⏳ زۆر کەس لە هەمان کاتدا دەچنە ژوورەوە — یەک خولەک چاوەڕێ بکە و دووبارە هەوڵ بدەوە.",
    server: "❌ کێشەیەک لە سێرڤەر ڕوویدا — دووبارە هەوڵ بدەوە."
};
function staffLoginMsg(err) { return STAFF_LOGIN_MSGS[err] || STAFF_LOGIN_MSGS.server; }

// initDataـی **واژووکراو**ی تلیگرام — بەتاڵ لە دەرەوەی تلیگرام.
// ⚠️ `initDataUnsafe` نا: ئەوە دەکرێت ساختە بکرێت؛ ئەمە سێرڤەر دەیپشکنێت.
function tgInitData() {
    try { return (window.Telegram && Telegram.WebApp && Telegram.WebApp.initData) || ''; }
    catch (e) { return ''; }
}

// بانگکردنی `staff-login`. هەمیشە { ok, error?, … } دەگەڕێنێتەوە، هەرگیز throw ناکات.
// ⚠️ `fetch`ـی ڕاستەوخۆ، نەک `supabase.functions.invoke`: ئەو کلیلی
//    گشتی وەک `Authorization: Bearer` دەنێرێت، کە کلیلی نوێ نییە.
// ⚠️ هەمان کێشەی ئایفۆن (POST ون دەبێت) — بۆیە هەڵەی تۆڕ تا ٣ جار
//    دووبارە دەکرێتەوە. `setup` نا: ئەگەر یەکەمیان گەیشتبێت،
//    دووەمیان «has_password» دەداتەوە — `staffLogin` چارەسەری دەکات.
async function staffLoginCall(payload, accessToken) {
    var headers = { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY };
    if (accessToken) headers['Authorization'] = 'Bearer ' + accessToken;
    var tries = payload.action === 'setup' ? 1 : 1 + SB_RETRY_DELAYS.length;
    for (var i = 0; i < tries; i++) {
        if (i > 0) await new Promise(function (r) { setTimeout(r, SB_RETRY_DELAYS[i - 1]); });
        var res;
        try {
            res = await fetch(STAFF_LOGIN_URL, { method: 'POST', headers: headers, body: JSON.stringify(payload) });
        } catch (e) {
            console.warn('staff-login network', e);
            continue;
        }
        try { return await res.json(); } catch (e) { return { ok: false, error: 'server' }; }
    }
    return { ok: false, error: 'network' };
}

// sessionـی ئێستا (یان null) — بەبێ throw
async function staffCurrentSession() {
    try {
        var r = await supabase.auth.getSession();
        return (r && r.data && r.data.session) || null;
    } catch (e) { return null; }
}

function _staffParked() {
    try { return JSON.parse(localStorage.getItem('staffSessions') || '{}') || {}; } catch (e) { return {}; }
}
function _staffParkedSet(m) {
    try { localStorage.setItem('staffSessions', JSON.stringify(m || {})); } catch (e) { }
}
// refresh tokenـی ئەکاونتێک لە پارک لادەبرێت (بۆ نموونە لە «لابردن»)
function staffForgetParked(code) {
    var m = _staffParked();
    if (code && m[code]) { delete m[code]; _staffParkedSet(m); }
}

// ⭐ تەنها شوێنێک کە sessionـی چالاک دەگۆڕێت.
//    `fromCode` = ئەکاونتی ئێستای ئامێرەکە — sessionـەکەی پارک دەکرێت
//    تا بتوانرێت بگەڕێیتەوە بۆی بەبێ پاسوۆرد.
async function _staffAdopt(fromCode, applyNew) {
    var prev = await staffCurrentSession();
    var err = await applyNew();
    if (err) {
        // نوێکە سەرکەوتوو نەبوو → sessionـی پێشوو دەگەڕێنرێتەوە
        if (prev) { try { await supabase.auth.setSession({ access_token: prev.access_token, refresh_token: prev.refresh_token }); } catch (e) { } }
        return err;
    }
    var now = await staffCurrentSession();
    if (prev && fromCode && (!now || now.refresh_token !== prev.refresh_token)) {
        var m = _staffParked(); m[fromCode] = prev.refresh_token; _staffParkedSet(m);
    }
    return null;
}

// لینکی یەکجاری → session (sessionـی پێشوو پارک دەکرێت)
async function _staffVerify(r, fromCode) {
    return _staffAdopt(fromCode, async function () {
        var v = await supabase.auth.verifyOtp({ token_hash: r.token_hash, type: r.type || 'magiclink' });
        if (v && v.error) return v.error.status === 429 ? 'rate_limited' : (v.error.message || 'verify_failed');
        return null;
    });
}

// ~٢ چرکە چاوەڕێ دەکات بزانێت پەڕەیەکی تری ئەم ئامێرە (هەمان localStorage)
// sessionـێکی **نوێی** ئەم ئەکاونتەی دانا یان نا — نەک ئەوەی پێشتر هەبوو
// (بۆ نموونە دوای گۆڕینی پاسوۆرد سێرڤەر ئەوەی کوشتووە)
async function _staffWaitShared(code, beforeRt) {
    for (var i = 0; i < 5; i++) {
        await new Promise(function (res) { setTimeout(res, 400); });
        var s = await staffCurrentSession();
        var m = s && s.user && s.user.app_metadata;
        if (m && m.emp_code === code && s.refresh_token !== beforeRt) return true;
    }
    return false;
}

// چوونەژوورەوە: `staff-login` → `verifyOtp`.
//   payload  = { action: 'password'|'setup'|'telegram'|'impersonate', … }
//   opts.fromCode    = ئەکاونتی ئێستای ئامێرەکە (بۆ پارککردن)
//   opts.accessToken = بۆ `impersonate`
// دەگەڕێنێتەوە: { ok: true, employee } یان { ok: false, error }
async function staffLogin(payload, opts) {
    opts = opts || {};
    if (!supabase || !supabase.auth) return { ok: false, error: 'network' };

    var before = await staffCurrentSession();
    var r = await staffLoginCall(payload, opts.accessToken);
    // `setup` گەیشت بەڵام وەڵامەکە ون بوو → پاسوۆردەکە ئێستا دانراوە
    if (payload.action === 'setup' && !r.ok && r.error === 'network') {
        r = await staffLoginCall({ action: 'password', code: payload.code, password: payload.new_password, init_data: payload.init_data });
        if (!r.ok && r.error !== 'network') r = { ok: false, error: 'network' };
    }
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'server' };

    var verr = await _staffVerify(r, opts.fromCode);
    // ⭐ لینکەکە بەتاڵ بووەوە: هەمان ئەکاونت لە هەمان ساتدا لە پەڕەیەکی تر
    //    (یان ئامێرێکی تر) لینکی وەرگرت، و Supabase تەنها نوێترینیان قبووڵ
    //    دەکات. (لە production بینرا: تلیگرامی ئەندرۆید، دوو پەڕە، ٥٥ms.)
    //    پێشتر ئەمە دەیبردە پەڕەی چوونەژوورەوە و sessionـی پەڕەکەی تریشی دەکوژاند.
    if (verr && verr !== 'rate_limited' && r.employee && r.employee.code) {
        if (await _staffWaitShared(r.employee.code, before && before.refresh_token)) {
            verr = null;   // پەڕەکەی تری ئەم ئامێرە سەرکەوت — sessionـەکە هاوبەشە
        } else {
            // جارێکی تر، لینکێکی نوێ. `setup` پاسوۆردەکەی پێشتر دانا.
            var again = payload.action === 'setup'
                ? { action: 'password', code: payload.code, password: payload.new_password, init_data: payload.init_data }
                : payload;
            var r2 = await staffLoginCall(again, opts.accessToken);
            if (r2 && r2.ok) { r = r2; verr = await _staffVerify(r2, opts.fromCode); }
        }
    }
    if (verr) {
        console.warn('verifyOtp:', verr);
        return { ok: false, error: verr === 'rate_limited' ? 'rate_limited' : 'verify_failed' };
    }

    staffForgetParked(r.employee && r.employee.code);   // ئێستا چالاکە، نەک پارک
    return { ok: true, employee: r.employee };
}

// گەڕانەوە بۆ ئەکاونتێکی پاشەکەوتکراو بە sessionـە پارککراوەکەی.
// ⚠️ کڵاینتێکی کاتی بەکاردێت بۆ نوێکردنەوەی تۆکنەکە: ئەگەر شکستی
//    هێنا، کڵاینتە سەرەکییەکە دەستی لێنادرێت (supabase-js لە
//    شکستی `refreshSession`ـدا sessionـی ئێستا دەسڕێتەوە).
// دەگەڕێنێتەوە: { ok: true } یان { ok: false, error: 'no_saved_session'|'expired' }
async function staffSwitchTo(fromCode, toCode) {
    var parked = _staffParked();
    var tok = parked[toCode];
    if (!tok || !SB_LIB) return { ok: false, error: 'no_saved_session' };

    var tmp = SB_LIB.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'sb-staff-switch-tmp' }
    });
    var fresh = null;
    try {
        var rr = await tmp.auth.refreshSession({ refresh_token: tok });
        fresh = rr && rr.data && rr.data.session;
    } catch (e) { fresh = null; }
    if (!fresh) { staffForgetParked(toCode); return { ok: false, error: 'expired' }; }

    var err = await _staffAdopt(fromCode, async function () {
        var s = await supabase.auth.setSession({ access_token: fresh.access_token, refresh_token: fresh.refresh_token });
        return (s && s.error) ? s.error.message : null;
    });
    if (err) return { ok: false, error: 'expired' };
    staffForgetParked(toCode);
    return { ok: true };
}

// sessionـی پارککراوی ئەکاونتێک لە سێرڤەریش دەکوژرێت (نەک تەنها
// لەم ئامێرە بسڕدرێتەوە) — بۆ «لابردنی ئەکاونت». هەوڵی باشترین:
// هەڵە بێدەنگ دەبێت، تۆکنەکە هەر لێرە دەسڕدرێتەوە.
async function staffRevokeParked(code) {
    var tok = _staffParked()[code];
    staffForgetParked(code);
    if (!tok || !SB_LIB) return;
    try {
        var tmp = SB_LIB.createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'sb-staff-revoke-tmp' }
        });
        var rr = await tmp.auth.refreshSession({ refresh_token: tok });
        if (rr && rr.data && rr.data.session) await tmp.auth.signOut({ scope: 'local' });
    } catch (e) { }
}

// دەرچوون لەم ئامێرە: sessionـەکە لە سێرڤەریش دەکوژرێت
async function staffSignOut() {
    try { await supabase.auth.signOut({ scope: 'local' }); } catch (e) { }
}

var currentUser = null;
var CF_R2_PUBLIC_URL = "https://pub-5d1996bbd70b4d5e99499860829c4b46.r2.dev";

function normalizeMediaUrl(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.includes('kxztaywhqpekjmjoynin.supabase.co/storage/v1/object/public/order-images/')) {
        return url.replace('https://kxztaywhqpekjmjoynin.supabase.co/storage/v1/object/public/order-images/', CF_R2_PUBLIC_URL + '/');
    }
    return url;
}

try {
    var savedUserStr = localStorage.getItem('myAppUser');
    if (savedUserStr && savedUserStr !== "undefined") {
        currentUser = JSON.parse(savedUserStr);
        if (currentUser) {
            var userChanged = false;
            if (currentUser.avatar) {
                var na = normalizeMediaUrl(currentUser.avatar);
                if (na !== currentUser.avatar) { currentUser.avatar = na; userChanged = true; }
            }
            if (currentUser.rank_prefs) {
                if (currentUser.rank_prefs.avatar) {
                    var nra = normalizeMediaUrl(currentUser.rank_prefs.avatar);
                    if (nra !== currentUser.rank_prefs.avatar) { currentUser.rank_prefs.avatar = nra; userChanged = true; }
                }
                if (currentUser.rank_prefs.banner) {
                    var nrb = normalizeMediaUrl(currentUser.rank_prefs.banner);
                    if (nrb !== currentUser.rank_prefs.banner) { currentUser.rank_prefs.banner = nrb; userChanged = true; }
                }
            }
            if (userChanged) {
                localStorage.setItem('myAppUser', JSON.stringify(currentUser));
            }
        }
    }
} catch (e) {
    localStorage.removeItem('myAppUser');
}

try {
    var accStr = localStorage.getItem('accountList');
    if (accStr && accStr !== 'undefined') {
        var accList = JSON.parse(accStr);
        if (Array.isArray(accList)) {
            var accsChanged = false;
            accList.forEach(function (acc) {
                if (acc && acc.avatar) {
                    var na = normalizeMediaUrl(acc.avatar);
                    if (na !== acc.avatar) { acc.avatar = na; accsChanged = true; }
                }
            });
            if (accsChanged) {
                localStorage.setItem('accountList', JSON.stringify(accList));
            }
        }
    }
} catch (e) { }