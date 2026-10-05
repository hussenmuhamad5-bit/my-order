# گواستنەوە: دانیشتنی هەوری (Cloud) ← دانیشتنی ناوخۆیی (Local)

> **بۆ Claudeـی ناوخۆیی:** ئەم فایلە بە تەواوی بخوێنەوە پێش ئەوەی دەست لە هیچ فایلێک بدەیت.
> لە نێوان ١ و ٥ی ئۆکتۆبەری ٢٠٢٦، دانیشتنێکی Claude لە هەور (claude.ai/code) ڕاستەوخۆ لە GitHub و
> Supabase کاری لەسەر ئەم پڕۆژەیە کرد. فۆڵدەری ناوخۆیی و یادەوەریی تۆ **ئەو گۆڕانکارییانەیان تێدا نییە**.
> هەرچی لێرەدا نووسراوە لە هەرچی پێشتر دەتزانی نوێترە. لەگەڵ بەکارهێنەر بە **کوردیی سۆرانی** قسە بکە.

---

## ١. ⛔ مەترسیی سەرەکی — پێش هەموو شتێک

فۆڵدەری ناوخۆیی **١٦ کۆمیت لە دواوەیە** (دوایین «Auto update»ـی ناوخۆیی: `f782f38`، ٢٠٢٦-١٠-٠١ 13:13).

ئەگەر «Auto update» (`push_to_github.bat` / `GitHubDeployer`) بە فایلە کۆنەکانەوە کار بکات و
وەشانە نوێکان بسڕێتەوە:

- **هەموو ئەپەکە دەوەستێت بۆ هەموو کەسێک.** `config.js`ـی کۆن کلیلی `service_role`ـی کۆنی تێدایە،
  و ئەو کلیلە **کوژراوە** (Legacy keys disabled + JWT secret revoked) → هەموو داواکارییەک ڕەت دەکرێتەوە.
- کرداری پارە دەشکێت (هەڵەی 403) — هەمان ڕووداوی ٤–٥ی ئۆکتۆبەر (بەشی ٧).
- چوونەژوورەوەی نوێ (`staffLogin`) و چاکسازییەکانی تر لادەچن.

**یاساکان تا فۆڵدەرەکە هاوکات دەبێت:**

1. «Auto update» / `push_to_github.bat` / `GitHubDeployer` **بەکارمەهێنە**.
2. **هەرگیز** `git push --force` (یان `-f`) مەکە.
3. فۆڵدەرەکە **مەسڕەوە و دووبارە clone مەکە** — فایلی وای تێدایە کە لە GitHub نین
   (`vendor/`، `order-details.html`، `tools/`، `.claude/skills/run-my-order/`، `GitHubDeployer.*`،
   `push_to_github.bat`، `github_config.txt`). `.gitignore` هەموو شتێک دەشارێتەوە جگە لە لیستێکی دیاریکراو.
4. پێش هەر گۆڕانکارییەک لە فایلێک کە بەکارهێنەر دەستکاریی کردبێت، **لێی بپرسە**.

---

## ٢. نوێکردنەوەی فۆڵدەری ناوخۆیی — هەنگاو بە هەنگاو

### هەنگاوی ١ — باکئەپ

هەموو فۆڵدەرەکە کۆپی بکە بۆ شوێنێکی تر (بۆ نموونە `my-order-backup-2026-10-05`)، بە فایلە
شاردراوەکانیشەوە (`.git`). ئەمە ڕێگەی گەڕانەوەیە ئەگەر هەر شتێک هەڵە بچێت.

### هەنگاوی ٢ — دۆخەکە بزانە (هیچ شتێک ناگۆڕێت)

```bash
git status
git branch --show-current          # دەبێت main بێت
git fetch origin
git log --oneline -1 HEAD
git rev-list --left-right --count HEAD...origin/main   # «ژمارەی‌خۆم  ژمارەی‌GitHub»
git log --oneline origin/main..HEAD                    # کۆمیتی ناوخۆیی کە نەنێردراون
git status --porcelain                                 # گۆڕانکاریی کۆمیت‌نەکراو
```

ئەگەر فۆڵدەرەکە git نەبێت، یان ڕیمۆتەکە `hussenmuhamad5-bit/my-order` نەبێت → بوەستە و بە
بەکارهێنەر بڵێ.

### هەنگاوی ٣ — دەستکاریی ناوخۆیی هەیە؟

ئەگەر `git status --porcelain` و `git log origin/main..HEAD` هەردووکیان **بەتاڵ** بوون:

```bash
git merge --ff-only origin/main
```

ئەگەر **گۆڕانکاریی کۆمیت‌نەکراو** هەبوو (`app.html`، `style.css` …) — زۆرجار بەکارهێنەر لە
نێوان دوو Auto updateـدا دەستکاری دەکات:

```bash
git diff --stat                     # پیشانی بەکارهێنەری بدە
git stash push -m "local-before-cloud-sync"
git merge --ff-only origin/main
git stash pop                       # ئەگەر conflict هەبوو → هەنگاوی ٤
```

ئەگەر **کۆمیتی ناوخۆیی نەنێردراو** هەبوو:

```bash
git merge origin/main               # merge، نەک rebase
```

### هەنگاوی ٤ — چارەسەری conflict (ئەگەر هەبوو)

هەردوو لا دەپارێزرێن: تایبەتمەندییە نوێکانی بەکارهێنەر **و** گۆڕانکارییە ئاسایشییەکان. ئەگەر
ناکرێت هەردووکی بپارێزرێت، **پێش بڕیاردان لە بەکارهێنەر بپرسە**. ئەو بەشانەی `app.html`،
`config.js`، `index.html` کە هەرگیز نابێت لابچن لە بەشی ٤دان.

### هەنگاوی ٥ — پشکنین (هەموویان دەبێت ڕاست بن)

| پشکنین | ئەنجامی چاوەڕوانکراو |
|---|---|
| `git merge-base --is-ancestor origin/main HEAD` | exit code 0 (هیچ شتێکی GitHub لە دواوە نەماوە) |
| لە `app.html`: `wallet_pay_order`، `fix_wallet_history`، `pay_salary`، `set_member_profit_rate`، `wallet_admin_apply` | هەر یەکەیان لانیکەم ١ جار |
| لە `app.html`: `rpc('wallet_apply'` یان `rpc('coins_add'` یان `from('transactions').insert` | ٠ |
| لە `config.js`: `sb_publishable_` و `staffLogin` | هەیە |
| لە `config.js`/`app.html`/`index.html`: `eyJhbGci` (کلیلی JWTـی کۆن) | ٠ |
| لە هەموو فایلەکانی سایت: تۆکنی بۆت (شێوەی `ژمارە:AA…`) | ٠ |
| `index.html` و `app.html` هەمان `config.js?v=…` بار دەکەن | یەکسانن |
| فایلەکانی `db/100…`، `db/101…`، `db/110…`، `supabase/functions/…`، `tests/security/…`، `SECURITY-ROLLOUT.md`، ئەم فایلە | هەن |

### هەنگاوی ٦ — ئامرازی «Auto update» بپشکنە

`push_to_github.bat` و `GitHubDeployer.cs` بخوێنەوە و بە بەکارهێنەر بڵێ:

- ئایا پێش push، `git pull`/`fetch` دەکات؟ ئەگەر نا → پێشنیار بکە پێش push ئەمە زیاد بکرێت:
  `git pull --ff-only origin main` و ئەگەر شکستی هێنا بوەستێت.
- ئایا `--force` بەکاردێنێت، یان فایل بە فایل بە GitHub API دەینێرێت (کە فایلی نوێتر
  دەسڕێتەوە)؟ ئەگەر بەڵێ → ئەمە **مەترسیدارە**؛ پێشنیار بکە بگۆڕدرێت. بەبێ ڕەزامەندیی بەکارهێنەر دەستکاریی مەکە.
- `github_config.txt` تۆکنی GitHubـی تێدایە — هەرگیز پیشانی مەدە و کۆمیتی مەکە.

### هەنگاوی ٧ — تەواو

تەنها دوای ئەوەی هەنگاوی ٥ هەمووی ڕاست بوو، بەکارهێنەر دەتوانێت Auto update بەکاربهێنێتەوە.
یەکەم Auto update دەبێت تەنها گۆڕانکارییە تازەکانی خۆی بنێرێت.

---

## ٣. ئەوەی لە GitHub گۆڕا

هەموو کارەکە لە branchـی `claude/practical-fermi-xyzvwj` کرا و بە PR چووە ناو `main`:

| PR | چی |
|---|---|
| #1 | چوونەژوورەوەی ڕاستەقینەی کارمەندان لەجیاتی کلیلی گشتیی `service_role` |
| #2 | دوو پەڕە کە هاوکات دەچنە ناو یەک ئەکاونت ئیتر یەکتر دەرناکەن |
| #3 | تۆکنی بۆتی سەرەکی لە کۆدی پەڕەی باکئەپ لابرا |
| #4 | قۆناغی ٢، پارە: یاساکانی پارە لەسەر سێرڤەر جێبەجێ دەکرێن |
| (ئەم فایلە) | گواستنەوە بۆ دانیشتنی ناوخۆیی |

هەروەها `daa73ae`: ناردنەوەی RPCـی خوێندن کە iOS لەسەر هەندێک تۆڕ دەیانخات.

| فایل | چی |
|---|---|
| `config.js` | تەنها کلیلی `sb_publishable_…`؛ `staffLogin()`؛ sessionـی کارمەند |
| `index.html` | چوونەژوورەوە بە `staffLogin`؛ ئەکاونتی ڕاگیراو؛ `config.js?v=…` |
| `app.html` | `ensureStaffSession`؛ ٥ کرداری پارە بە RPCـی نوێ؛ تۆکنی بۆت لابرا؛ … |
| `db/100_staff_auth.sql` (+ rollback) | `staff_gate`، `current_emp_code()`، داخستنی `anon`، RLS |
| `db/101_staff_gate_headers.sql` | `staff_gate` 403ـی دروست دەداتەوە (نەک 500) |
| `db/110_money_guard.sql` (+ rollback) | پاراستنی پارە: فەنکشنە `p2_*`، ٥ wrapper، داخستنی ستوونە پارەییەکان |
| `supabase/functions/staff-login/` | Edge Function: پاسوۆرد، واژووی تلیگرام، سنووری هەوڵ |
| `supabase/functions/gdrive-sync/`، `gdrive-test/` | تەنها پاشا؛ کلیلی گووگڵ لە Vault |
| `tests/security/` | ٢٢٣ پشکنین (PGlite + Chromium) |
| `SECURITY-ROLLOUT.md` | ڕێنمایی تەواوی جێبەجێکردن (کوردی) |
| `.gitignore` | ڕێگەدان بەم فایلە نوێیانە |

---

## ٤. یاساکان کە هەرگیز نابێت بشکێن

1. **فایلەکانی سایت گشتین** (GitHub Pages + repoـی گشتی). هەرگیز کلیلی `sb_secret_…`،
   `service_role`، تۆکنی بۆت، یان هەر نهێنییەک لە `app.html`/`config.js`/`index.html`/`style.css`
   مەنووسە. تەنها `sb_publishable_…` ڕێگەپێدراوە.
2. **چوونەژوورەوە:** `index.html` → `staffLogin()` (`config.js`) → Edge Functionـی `staff-login` →
   sessionـی Supabase. هەرگیز پاسوۆرد لە براوزەردا بەراورد مەکەرەوە و `employees.password` بۆ
   چوونەژوورەوە مەخوێنەوە. چوونەژوورەوەی تلیگرام واژووەکەی لەسەر سێرڤەر دەپشکنرێت.
3. **ناسنامە:** `current_emp_code()` ناسنامەی ڕاستەقینەیە (لە `auth.uid()`ـەوە). هەرگیز متمانە بە
   کۆدێک مەکە کە براوزەر دەینێرێت بۆ بڕیاری دەسەڵات.
4. **`anon`** (چوونەژوورەوەنەکردوو) هیچ دەسەڵاتێکی نییە جگە لە `login_code_status`. خشتە و فەنکشنی
   نوێ خۆکارانە بۆ `anon` ناکرێنەوە — بەڵام بۆ `authenticated` دەکرێنەوە، بۆیە خشتەی نوێ پێویستی
   بە RLS هەیە.
5. **پارە تەنها بەم فەنکشنانە:**
   `wallet_pay_order`، `pay_salary`، `wallet_admin_apply`، `fix_wallet_history`،
   `set_member_profit_rate`، `distribute_order_profit`، `return_order_profit`، `coins_grant`،
   `cosmetic_buy`، `claim_reward`.
   - هەرگیز لە براوزەرەوە: `insert/update/delete` لە `transactions`، `coin_ledger`، `user_cosmetics`؛
     گۆڕینی `employees.balance/savings/profit_rate/coins`؛ بانگکردنی `wallet_apply` یان `coins_add`
     (هەموویان 403 دەدەن).
   - پارامەتەری «کێ کردی» (`p_created_by`، `p_viewer` …) لەسەر سێرڤەر **پشتگوێ دەخرێت** — تەنها بۆ
     گونجان ماوەتەوە.
   - تایبەتمەندیی پارەیی نوێ ← فەنکشنی `SECURITY DEFINER`ـی نوێ لە فایلێکی نوێی `db/1xx`، بە
     پشکنینی `p2_*`، لەگەڵ rollback و پشکنین لە `tests/security/db_money_test.mjs`.
6. **`config.js` گۆڕا؟** ← `?v=` لە `index.html` **و** `app.html` بەرز بکەرەوە.
7. **گۆڕانکاریی داتابەیس کە دەسەڵات دادەخات = دوو هەنگاو:** (١) ڕێگە نوێیەکە زیاد بکە بەبێ
   داخستنی کۆنەکە → (٢) سایت بڵاو بکەرەوە و چاوەڕێ بکە → (٣) لە migrationـێکی جیادا کۆنەکە دابخە.
   (وانەی ڕووداوی بەشی ٧.)
8. **داتابەیس production ـە.** فایلەکانی `db/` بە دەست جێبەجێ دەکرێن (SQL Editor). هەمیشە
   rollback بنووسە و سەرەتا لە `tests/security` تاقی بکەرەوە. `db/100`، `db/101`، `db/110`
   **پێشتر جێبەجێ کراون — دووبارە Runـیان مەکە.**
9. **Edge Functions:** «Verify JWT» کوژاوەیە (خۆیان پشکنین دەکەن). نهێنییەکان لە Supabase
   Secrets / Vaultـەوە دێن، هەرگیز لە کۆددا نا.
10. **ئەپی Dart و بۆتی Python** کلیلی `sb_secret_…` بەکاردێنن (تەنها لە هێدەری `apikey`، بەبێ
    `Authorization: Bearer`). هەرگیز ئەو کلیلانە کۆمیت مەکە یان مەیخەرە سایتەوە.

---

## ٥. ئەوەی ڕاستەوخۆ لە Supabase کرا (production — `kxztaywhqpekjmjoynin`)

| چی | کەی | دۆخ |
|---|---|---|
| `db/100` — staff auth، `staff_gate`، داخستنی `anon` | ٣ی ئۆکتۆبەر | ✅ |
| `db/101` — migrationـی `staff_gate_headers` | ٣ی ئۆکتۆبەر | ✅ |
| `db/110` — migrationـی `money_guard_phase2` | ٤ی ئۆکتۆبەر 00:23 UTC | ✅ |
| Edge Functions: `staff-login`، `gdrive-sync`، `gdrive-test` (verify_jwt: off) | ٣ی ئۆکتۆبەر | ✅ |
| Vault: `telegram_bot_token` (تۆکنی نوێ)، `google_sa_private_key` | ٣ی ئۆکتۆبەر | ✅ |
| Legacy API keys (`anon`، `service_role`) | — | ⛔ Disabled |
| Legacy JWT secret | — | ⛔ Rotated + Revoked |

هەر کۆدێک کە کلیلێکی `eyJ…`ـی کۆنی تێدا بێت **ئیتر کار ناکات**.

## ٦. ئەوەی بەکارهێنەر خۆی کردی (دەرەوەی GitHub)

- تۆکنی بۆتی سەرەکی (@my_orders_narea_bot) لە BotFather Revoke کرا؛ تۆکنە نوێکە لە Vault و بۆتی Python دانرا.
- ئەپی Dart (`AppConfig`) و بۆتی Python (`app.py`) بۆ کلیلی نوێی `sb_secret_…` گۆڕدران — هەردووکیان کار دەکەن.
- Legacy keys کوژێنرانەوە و JWT secretـی کۆن Revoke کرا.

## ٧. ڕووداوی ٤–٥ی ئۆکتۆبەر (وانە)

`db/110` جێبەجێ کرا، بەڵام دانیشتنی هەوری پێش بڵاوکردنەوەی سایتە نوێکە وەستا. بۆ ~٤١ کاتژمێر
سایتە کۆنەکە کە ڕاستەوخۆ دەینووسی، ~٣٧ کرداری پارە (مووچە، جزدان، پارەدانی ئۆردەر) هەڵەی 403ـی
وەرگرت. **هیچ داتایەک تێک نەچوو** — کردارەکان ڕەت کرانەوە، هیچ شتێکی هەڵە نەنووسرا. PR #4
(٥ی ئۆکتۆبەر ~17:28 UTC) چاکی کرد. وانە: یاسای ٧ لە بەشی ٤.

## ٨. دۆخ لە ٥ی ئۆکتۆبەر (پشکنراو)

- ٣٦٥ کارمەند؛ ١٢٤ هەژماری Authـیان هەیە (لە یەکەم چوونەژوورەوەدا دروست دەبێت)؛ ١٢٣ لە ٧ ڕۆژدا چوونە ژوورەوە.
- گرانتەکانی پارە لە production هەمان شتن کە تاقیکراونەتەوە؛ قازانجی ئۆردەر بە سەرکەوتوویی دەنووسرێت.
- سایتی سەر `main` هەر ٥ RPCـی نوێ بەکاردێنێت؛ هیچ نووسینێکی ڕاستەوخۆی پارە نەماوە.

## ٩. کارەکانی داهاتوو

بەشەکانی داهاتووی قۆناغی ٢ لە `SECURITY-ROLLOUT.md` («بەشەکانی داهاتوو»)دان: دەسەڵاتی ئۆردەر،
پاراستنی پاسوۆرد و تۆکنەکان، `role`/`permissions`، هاشی پاسوۆرد، workerـی وێنە،
`syncTelegramIdentity`. هەر یەکەیان بە یاسای ٧ (دوو هەنگاو).

کاری بچووکی بەکارهێنەر:
- نهێنییەکی کۆنی Vault کە **ناوەکەی** تۆکنی بۆتی کۆنە بسڕدرێتەوە.
- تۆکنی GitHub و تۆکنی بۆتی باکئەپ لە `backup_settings` بگۆڕدرێن.
- Supabase ئاگاداریی «over quota»ی دا (سنووردارکردن لە ١٤ی ئۆکتۆبەر) — Usage بپشکنە.
- تێبینی: `.gitignore` ڕێگە بە `vendor/` دەدات بەڵام `vendor/` هەرگیز نەگەیشتۆتە GitHub
  (`vendor/emoji/*.png` لەسەر سایت نییە). بپشکنە ئایا دەبێت بنێردرێت.

## ١٠. پشکنینەکان

پێویستی بە Node ٢٢.٦+ هەیە (`--experimental-strip-types`):

```bash
cd tests/security && npm install && npm test
```

هیچ پشکنینێک دەست لە داتابەیسی ڕاستەقینە نادات.

---

## ١١. بۆ `CLAUDE.md`ـی ناوخۆیی

`.gitignore` هەموو شتێک دەشارێتەوە، بۆیە `CLAUDE.md` لە فۆڵدەری ناوخۆییدا دەمێنێتەوە. ئەگەر بەکارهێنەر
ڕازی بوو، ئەمە زیاد بکە (ئەگەر `CLAUDE.md` هەبوو، تێکەڵی بکە، مەیسڕەوە):

```markdown
## ئاسایش (لە ٥ی ئۆکتۆبەری ٢٠٢٦ەوە) — بڕوانە CLOUD-SESSION-HANDOFF.md و SECURITY-ROLLOUT.md
- سایت گشتییە: تەنها `sb_publishable_…`. هەرگیز نهێنی لە app.html/config.js/index.html.
- چوونەژوورەوە: staffLogin() → Edge Function `staff-login`. پاسوۆرد لە براوزەر بەراورد ناکرێت.
- ناسنامە لە سێرڤەر: current_emp_code(). متمانە بە کۆدی براوزەر مەکە.
- پارە تەنها بە RPC: wallet_pay_order, pay_salary, wallet_admin_apply, fix_wallet_history,
  set_member_profit_rate, distribute_order_profit, return_order_profit, coins_grant, cosmetic_buy,
  claim_reward. نووسینی ڕاستەوخۆی transactions/balance/savings/profit_rate/coins = 403.
- config.js گۆڕا ← ?v= لە index.html و app.html بەرز بکەرەوە.
- داخستنی دەسەڵات لە DB = دوو هەنگاو (ڕێگەی نوێ → سایت → داخستنی کۆن).
- db/100، db/101، db/110 جێبەجێ کراون؛ دووبارە Runـیان مەکە.
- پێش Auto update: `git fetch` و دڵنیابە لە دواوە نیت. هەرگیز push --force.
```
