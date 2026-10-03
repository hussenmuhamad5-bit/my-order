// ============================================================
//  gdrive-test — پشکنینی فۆڵدەری باکئەپ لە Google Drive
// ------------------------------------------------------------
//  ⚠️ پێشتر هەر کەسێک دەیتوانی بانگی بکات. ئێستا تەنها پاشا.
//  ⚠️ کلیلی تایبەتی service accountـی گووگڵ لە کۆدەکەدا بوو —
//     ئەم فایلە لە GitHubـی گشتیدایە، بۆیە ئێستا لە Secret دێت:
//       GOOGLE_SA_PRIVATE_KEY  (هەموو دەقی -----BEGIN PRIVATE KEY----- …)
//       GOOGLE_SA_EMAIL        (ئارەزوومەندانە)
//     Supabase → Edge Functions → Secrets. بڕوانە SECURITY-ROLLOUT.md
//  «Verify JWT» کوژاوە بێت — پشکنینەکە لە `requireKing`ـدایە.
// ============================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SERVICE_EMAIL = Deno.env.get('GOOGLE_SA_EMAIL') || "telegram-bot-sheet@root-quasar-493815-t9.iam.gserviceaccount.com";
// Secretـەکان هەندێک جار `\n` وەک دوو پیت هەڵدەگرن
const PRIVATE_KEY_PEM = (Deno.env.get('GOOGLE_SA_PRIVATE_KEY') || '').replace(/\\n/g, '\n');

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

function pemToBinary(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----[^\n]+-----/g, '')
    .replace(/\s+/g, '');
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf;
}

function base64url(input: Uint8Array | string): string {
  let b64: string;
  if (typeof input === 'string') {
    b64 = btoa(input);
  } else {
    let binary = '';
    for (let i = 0; i < input.length; i++) binary += String.fromCharCode(input[i]);
    b64 = btoa(binary);
  }
  return b64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getGoogleAccessToken(): Promise<string> {
  if (!PRIVATE_KEY_PEM.includes('PRIVATE KEY')) {
    throw new Error('GOOGLE_SA_PRIVATE_KEY لە Edge Function Secrets دانەنراوە');
  }
  const binaryKey = pemToBinary(PRIVATE_KEY_PEM);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: SERVICE_EMAIL,
    scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.metadata.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const encHeader = base64url(JSON.stringify(header));
  const encClaim = base64url(JSON.stringify(claim));
  const dataToSign = new TextEncoder().encode(`${encHeader}.${encClaim}`);

  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, dataToSign);
  const encSig = base64url(new Uint8Array(signature));
  const jwt = `${encHeader}.${encClaim}.${encSig}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) {
    throw new Error(tokenData.error_description || tokenData.error || 'هەڵە لە وەرگرتنی تۆکن لە گووگڵ');
  }
  return tokenData.access_token;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const denied = await requireKing(req);
    if (denied) return denied;

    let targetEmail = '';
    try {
      const body = await req.json();
      targetEmail = (body.email || '').trim().toLowerCase();
    } catch (_) {}

    const token = await getGoogleAccessToken();
    const q = "name = 'my-order-backup' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    const r = await fetch(
      'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name,owners,sharedWithMeTime,webViewLink,capabilities)',
      {
        headers: { 'Authorization': 'Bearer ' + token }
      }
    );

    const data = await r.json();
    const files = data.files || [];

    if (files.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          found: false,
          message: "فۆڵدەری 'my-order-backup' لەسەر درایڤ نەدۆزرایەوە. تکایە دڵنیابە لە دروستکردنی فۆڵدەرەکە لەناو گووگڵ درایڤەکەت و شەیرکردنی بە مۆڵەتی Editor لەگەڵ: " + SERVICE_EMAIL
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    let matchedFolder = files[0];
    if (targetEmail) {
      const match = files.find((f: any) =>
        f.owners && f.owners.some((o: any) => (o.emailAddress || '').toLowerCase() === targetEmail)
      );
      if (match) matchedFolder = match;
    }

    const owner = (matchedFolder.owners && matchedFolder.owners[0]) || {};

    let innerFiles: any[] = [];
    try {
      const innerQ = `'${matchedFolder.id}' in parents and trashed = false`;
      const innerRes = await fetch(
        'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(innerQ) + '&pageSize=5&fields=files(id,name,mimeType,size,modifiedTime)',
        { headers: { 'Authorization': 'Bearer ' + token } }
      );
      const innerData = await innerRes.json();
      innerFiles = innerData.files || [];
    } catch (_) {}

    return new Response(
      JSON.stringify({
        success: true,
        found: true,
        folder: {
          id: matchedFolder.id,
          name: matchedFolder.name,
          ownerName: owner.displayName || 'خاوەنی درایڤ',
          ownerEmail: owner.emailAddress || targetEmail,
          sharedAt: matchedFolder.sharedWithMeTime || new Date().toISOString(),
          webViewLink: matchedFolder.webViewLink || ('https://drive.google.com/drive/folders/' + matchedFolder.id),
          canEdit: matchedFolder.capabilities ? matchedFolder.capabilities.canAddChildren : true,
          filesCount: innerFiles.length,
          files: innerFiles.map((f: any) => ({ name: f.name, modifiedTime: f.modifiedTime }))
        },
        message: `✅ پەیوەندی گووگڵ درایڤ سەرکەوتوو بوو! فۆڵدەری '${matchedFolder.name}' بە سەرکەوتوویی بەستراوەتەوە.`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || String(err) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
