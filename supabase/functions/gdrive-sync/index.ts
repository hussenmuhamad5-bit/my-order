// ============================================================
//  gdrive-sync — ئەکاونتەکانی Google Drive بۆ باکئەپ
// ------------------------------------------------------------
//  ⚠️ پێشتر هیچ پشکنینێکی نەبوو: هەر کەسێک لە ئینتەرنێت دەیتوانی
//     `add_account` بانگ بکات و درایڤی خۆی زیاد بکات — واتا
//     باکئەپی داتابەیس بۆ ئەو دەچوو. ئێستا تەنها پاشا (بە sessionـی
//     چوونەژوورەوە) دەتوانێت بانگی بکات.
//  ⚠️ کلیلی service_role ـی ناو کۆدەکە لابرا. کلیلی نوێ
//     (`SUPABASE_SECRET_KEYS`) لە پێشترە، بۆیە دوای کوژاندنەوەی
//     کلیلە کۆنەکان هەر کاردەکات.
//  «Verify JWT» کوژاوە بێت — پشکنینەکە لە `requireKing`ـدایە.
// ============================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import _sodium from "https://esm.sh/libsodium-wrappers";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function secretKey(): string {
  try {
    const m = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '');
    if (m && typeof m.default === 'string' && m.default) return m.default;
  } catch { /* دانەنراوە */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// تەنها پاشای چالاک — هەمان یاسای کارتی باکئەپ لە app.html
async function requireKing(req: Request): Promise<Response | null> {
  const auth = req.headers.get('authorization') || '';
  const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!jwt) return json(401, { success: false, error: 'no_session' });
  const { data: u, error } = await admin.auth.getUser(jwt);
  if (error || !u?.user) return json(401, { success: false, error: 'no_session' });
  const { data: emp } = await admin.from('employees').select('role, suspended')
    .eq('auth_user_id', u.user.id).maybeSingle();
  if (!emp || emp.suspended || emp.role !== 'پاشا') return json(403, { success: false, error: 'forbidden' });
  return null;
}

async function getBackupSettings() {
  const { data, error } = await admin.from('backup_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error('Failed to read backup settings: ' + error.message);
  return data || {};
}

async function updateGDriveAccounts(accounts: any[]) {
  const { data, error } = await admin.from('backup_settings')
    .update({ gdrive_accounts: accounts, updated_at: new Date().toISOString() })
    .eq('id', 1).select();
  if (error) throw new Error('Failed to update accounts: ' + error.message);
  return data;
}

function buildRcloneConfig(accounts: any[]): string {
  let config = '';
  accounts.forEach((acc, idx) => {
    if (!acc.token) return;
    const remote = acc.remote_name || (idx === 0 ? 'gdrive' : `gdrive${idx + 1}`);
    const tokenStr = typeof acc.token === 'string' ? acc.token : JSON.stringify(acc.token);
    config += `[${remote}]\ntype = drive\nscope = drive\ntoken = ${tokenStr}\n\n`;
  });
  return config;
}

async function syncToGitHub(accounts: any[], repo: string, token: string) {
  const rcloneConfig = buildRcloneConfig(accounts);
  const base64Config = btoa(rcloneConfig);

  // 1. Get GitHub public key
  const pkRes = await fetch(`https://api.github.com/repos/${repo}/actions/secrets/public-key`, {
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'SupabaseEdge'
    }
  });
  if (!pkRes.ok) throw new Error('Failed to get GitHub repo public key: ' + pkRes.statusText);
  const { key_id, key } = await pkRes.json();

  // 2. Encrypt with libsodium crypto_box_seal
  await _sodium.ready;
  const sodium = _sodium;
  const pubKeyBytes = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
  const sealedBytes = sodium.crypto_box_seal(base64Config, pubKeyBytes);
  const encryptedBase64 = sodium.to_base64(sealedBytes, sodium.base64_variants.ORIGINAL);

  // 3. Put secret
  const putRes = await fetch(`https://api.github.com/repos/${repo}/actions/secrets/RCLONE_CONFIG`, {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'SupabaseEdge'
    },
    body: JSON.stringify({
      encrypted_value: encryptedBase64,
      key_id: key_id
    })
  });

  if (!putRes.ok && putRes.status !== 201 && putRes.status !== 204) {
    const err = await putRes.json().catch(() => ({}));
    throw new Error('Failed to save secret to GitHub: ' + (err.message || putRes.statusText));
  }

  return { ok: true, activeRemotesCount: accounts.filter(a => a.token).length };
}

async function triggerGitHubBackup(repo: string, token: string) {
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/backup.yml/dispatches`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'SupabaseEdge'
    },
    body: JSON.stringify({ ref: 'main' })
  });
  if (res.status !== 204 && !res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error('Failed to trigger workflow: ' + (err.message || res.statusText));
  }
  return { ok: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const denied = await requireKing(req);
    if (denied) return denied;

    let body: any = {};
    if (req.method === 'POST') {
      try { body = await req.json(); } catch (_) {}
    }

    const action = body.action || 'sync';
    const settings: any = await getBackupSettings();
    const repo = settings.github_repo || 'hussenmuhamad5-bit/my-order-backups';
    const ghToken = settings.github_token;
    let accounts: any[] = Array.isArray(settings.gdrive_accounts) ? [...settings.gdrive_accounts] : [];

    if (action === 'sync') {
      const syncResult = await syncToGitHub(accounts, repo, ghToken);
      return new Response(JSON.stringify({
        success: true,
        message: 'کۆنفیگی گووگڵ درایڤ لە گێتهاب نوێکرایەوە',
        accounts: accounts.map(a => ({ id: a.id, email: a.email, name: a.name, remote_name: a.remote_name, status: a.status })),
        details: syncResult
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'remove_account') {
      const accId = body.account_id;
      if (!accId) throw new Error('account_id پێویستە');
      accounts = accounts.filter(a => a.id !== accId);
      await updateGDriveAccounts(accounts);
      const syncResult = await syncToGitHub(accounts, repo, ghToken);
      return new Response(JSON.stringify({
        success: true,
        message: 'ئەکاونتەکە بە سەرکەوتوویی لە درایڤ و گێتهاب لادرا',
        accounts: accounts.map(a => ({ id: a.id, email: a.email, name: a.name, remote_name: a.remote_name, status: a.status })),
        details: syncResult
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'add_account') {
      const { email, name, token } = body;
      if (!email) throw new Error('ئیمەیڵ پێویستە');
      if (!token) throw new Error('تۆکنی مۆڵەت پێویستە');

      const existingIdx = accounts.findIndex(a => (a.email || '').toLowerCase() === email.toLowerCase());
      const remoteName = existingIdx === 0 ? 'gdrive' : (existingIdx > 0 ? (accounts[existingIdx].remote_name || `gdrive${existingIdx + 1}`) : (accounts.length === 0 ? 'gdrive' : `gdrive${accounts.length + 1}`));

      const record = {
        id: existingIdx >= 0 ? accounts[existingIdx].id : ('gdrive_' + Date.now()),
        remote_name: remoteName,
        name: name || email.split('@')[0],
        email: email.trim(),
        status: 'active',
        token: token,
        created_at: existingIdx >= 0 ? accounts[existingIdx].created_at : new Date().toISOString()
      };

      if (existingIdx >= 0) {
        accounts[existingIdx] = record;
      } else {
        accounts.push(record);
      }

      await updateGDriveAccounts(accounts);
      const syncResult = await syncToGitHub(accounts, repo, ghToken);

      return new Response(JSON.stringify({
        success: true,
        message: `ئەکاونتی (${email}) بە سەرکەوتوویی زیادکرا`,
        accounts: accounts.map(a => ({ id: a.id, email: a.email, name: a.name, remote_name: a.remote_name, status: a.status })),
        details: syncResult
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'test_backup') {
      await triggerGitHubBackup(repo, ghToken);
      return new Response(JSON.stringify({
        success: true,
        message: 'باکئەپی تاقیکاری لەسەر گێتهاب دەستی پێکرد'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      success: false,
      message: 'Unknown action: ' + action
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });

  } catch (err: any) {
    return new Response(JSON.stringify({
      success: false,
      error: err.message || String(err)
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});
