// ============================================================
//  staff-login — Edge Function
// ------------------------------------------------------------
//  تەنها پەیوەندی بە داتابەیس و Supabase Authـەوە. هەموو بڕیارەکان
//  لە `handler.ts`ـدان (و لەوێ تاقی دەکرێنەوە).
//
//  بڵاوکردنەوە: Supabase → Edge Functions → Deploy new function →
//    ناو: staff-login ، هەردوو فایلی `index.ts` و `handler.ts`
//    ⚠️ «Verify JWT» **کوژاوە** بێت — ئەم فەنکشنە خۆی دەپشکنێت،
//       و پەڕەی چوونەژوورەوە هێشتا JWTـی نییە.
//  یان بە CLI: `supabase functions deploy staff-login --no-verify-jwt`
//
//  ژینگە (Secrets) — هەموویان خۆکارن، پێویست بە دانان ناکات:
//    SUPABASE_URL, SUPABASE_SECRET_KEYS (یان SUPABASE_SERVICE_ROLE_KEY)
//  ئارەزوومەندانە:
//    TELEGRAM_BOT_TOKEN  — ئەگەر بۆتی Mini App جیاواز بوو لەوەی Vault
//    STAFF_EMAIL_DOMAIN  — بنەڕەت: staff.my-order.invalid
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { createHandler, staffEmail, type Deps, type Employee } from './handler.ts';

// کلیلی نوێ (`sb_secret_…`) لە پێشترە؛ کلیلی کۆن تەنها وەک پاشەکەوت —
// کاتێک کلیلە کۆنەکان دەکوژێنرێنەوە، ئەم فەنکشنە هەر کاردەکات.
function secretKey(): string {
    try {
        const m = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '');
        if (m && typeof m.default === 'string' && m.default) return m.default;
    } catch { /* دانەنراوە */ }
    return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const EMAIL_DOMAIN = Deno.env.get('STAFF_EMAIL_DOMAIN') || 'staff.my-order.invalid';

const admin = createClient(SUPABASE_URL, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const deps: Deps = {
    async getEmployee(code) {
        const { data, error } = await admin.from('employees').select('*').eq('code', code).maybeSingle();
        if (error) throw error;
        return data as Employee | null;
    },

    async findEmployeesByTelegram(tgId) {
        const { data, error } = await admin.from('employees').select('*').eq('telegram_id', tgId).limit(5);
        if (error) throw error;
        return (data ?? []) as Employee[];
    },

    async hasActiveChatLink(code, tgId) {
        const { data, error } = await admin.from('employee_chats').select('code')
            .eq('code', code).eq('telegram_id', tgId).is('unlinked_at', null).limit(1);
        if (error) throw error;
        return !!(data && data.length);
    },

    async updateEmployee(code, patch) {
        const { data, error } = await admin.from('employees').update(patch).eq('code', code).select('*').single();
        if (error) throw error;
        return data as Employee;
    },

    async linkChat(code, tg) {
        const { error } = await admin.rpc('link_employee_chat', {
            p_code: code, p_telegram_id: tg.id, p_username: tg.username || null, p_name: tg.name || null,
        });
        if (error) throw error;
    },

    async recentFailures(code, sinceIso) {
        const { count, error } = await admin.from('staff_login_failures')
            .select('id', { count: 'exact', head: true }).eq('code', code).gte('at', sinceIso);
        if (error) throw error;
        return count ?? 0;
    },

    async recordFailure(code) {
        const { error } = await admin.from('staff_login_failures').insert({ code });
        if (error) console.error('recordFailure', error);
    },

    async botTokens() {
        const out: string[] = [];
        const extra = Deno.env.get('TELEGRAM_BOT_TOKEN');
        if (extra) out.push(extra);
        const { data, error } = await admin.rpc('staff_bot_token');
        if (error) console.error('staff_bot_token', error);
        if (typeof data === 'string' && data) out.push(data);
        return out;
    },

    // بەکارهێنەری Auth بۆ ئەم کارمەندە (یەکجار دروست دەکرێت) +
    // لینکی چوونەژوورەوەی یەکجاری. هیچ ئیمەیڵێک نانێردرێت.
    async issueLogin(emp) {
        const email = staffEmail(emp.code, EMAIL_DOMAIN);
        let uid = emp.auth_user_id || null;

        if (!uid) {
            const { data, error } = await admin.auth.admin.createUser({
                email, email_confirm: true, app_metadata: { emp_code: emp.code },
            });
            if (data?.user) uid = data.user.id;
            // «email_exists» = هەوڵێکی پێشوو پێش بەستنەوە وەستا — خوارەوە دەدۆزرێتەوە
            else if (error && !/exist|already|registered/i.test(error.message)) throw error;
        }

        const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
        if (le) throw le;
        if (!link?.properties?.hashed_token || !link.user) throw new Error('generateLink: empty');
        uid = link.user.id;

        if (emp.auth_user_id !== uid) {
            const { error } = await admin.from('employees').update({ auth_user_id: uid }).eq('code', emp.code);
            if (error) throw error;
        }
        return { token_hash: link.properties.hashed_token, type: link.properties.verification_type || 'magiclink' };
    },

    async userFromJwt(jwt) {
        const { data, error } = await admin.auth.getUser(jwt);
        return error || !data?.user ? null : data.user.id;
    },

    async employeeByAuthUser(uid) {
        const { data, error } = await admin.from('employees').select('*').eq('auth_user_id', uid).maybeSingle();
        if (error) throw error;
        return data as Employee | null;
    },

    now: () => Date.now(),
};

Deno.serve(createHandler(deps));
