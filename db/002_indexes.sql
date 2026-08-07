-- ============================================================
--  ٠٠٢ — ئیندێکسەکانی خێرایی
-- ------------------------------------------------------------
--  چۆن جێبەجێی بکەیت:
--    Supabase → SQL Editor → **هەر فەرمانێک بە جیا** Run بکە.
--    `CREATE INDEX CONCURRENTLY` ناتوانرێت لەناو transaction ـدا بێت،
--    بۆیە هەموویان پێکەوە جێبەجێ ناکرێن.
--
--  بۆچی پێویستن:
--    پێش ئەمانە خشتەی `orders` تەنها ئیندێکسی کلیلی سەرەکی (`id`)ـی هەبوو.
--    هەموو گەڕان و فلتەرێک بەپێی `seller_code`/`status`/`date` دەبوو
--    هەموو خشتەکە بخوێنێتەوە. نموونەی ڕاستەقینە پێش ئیندێکس:
--
--      Seq Scan on orders … Rows Removed by Filter: 1001
--
--    واتا ١٠٠١ ڕیز خوێندرایەوە و فڕێدرا بۆ ئەوەی ١١١ ڕیز بگەڕێنێتەوە.
--    ئەم ڕێژەیە جێگیرە: لە ١٢٠ هەزار ڕیزدا دەبێتە دەیان هەزار ڕیز.
--
--  گەڕانەوە (ئەگەر پێویست بوو): `drop index concurrently <ناو>;`
--  تێچوو: لە ١٢٠ هەزار ڕیزدا ~٤٠-٦٠ MB بە کۆی گشتی — هیچ گرنگ نییە.
-- ============================================================

-- ١) لیستی سەرەکی — ئۆردەری کەسێک/تیمێک بە ڕیزی نوێترین.
--    گرنگترینیان: هەموو `fetchOrders` و `loadManagementOrders` ئەمە بەکاردێنن.
create index concurrently if not exists orders_seller_id_idx
    on public.orders (seller_code, id desc);

-- ٢) فلتەری حاڵەت (ئامادە دەکرێت / لە ڕێگایە / گەیشتووە / گەڕاوەتەوە)
create index concurrently if not exists orders_seller_status_id_idx
    on public.orders (seller_code, status, id desc);

create index concurrently if not exists orders_status_id_idx
    on public.orders (status, id desc);

-- ٣) فلتەری بەروار.
--    `date` سترینگە بەڵام فۆرماتەکەی 'YYYY-MM-DD hh:mm:ss AM|PM'ـە و
--    ١٠٠٪ یەکگرتووە، بۆیە بەراوردی سترینگی بۆ مەودای ڕۆژ تەواو دروستە.
create index concurrently if not exists orders_date_id_idx
    on public.orders (date desc, id desc);

create index concurrently if not exists orders_seller_date_id_idx
    on public.orders (seller_code, date desc, id desc);

-- ٤) گەڕان بە کۆدی ئۆردەر — سکانی بارکۆد/QR.
--    تێبینی: پشکنین کرا و هیچ `order_code`ـێکی دووبارە نییە، بۆیە دەکرێت
--    `unique` بکرێت. بەڵام ئەپەکە هیچ لۆجیکێکی نییە بۆ مامەڵەکردن لەگەڵ
--    شکستی ئینسێرت، بۆیە ئێستا ئاسایی دەهێڵدرێتەوە.
create index concurrently if not exists orders_order_code_idx
    on public.orders (order_code);

-- ٥) جووڵەکانی جزدان — پێشتر جگە لە کلیلی سەرەکی هیچی نەبوو، بۆیە
--    `fetchAllUserTx` هەموو خشتەکەی دەخوێندەوە.
create index concurrently if not exists transactions_user_created_idx
    on public.transactions (user_code, created_at desc);

create index concurrently if not exists transactions_order_idx
    on public.transactions (order_id);

-- ٦) نوێکردنەوەی ئامارەکانی پلاندانەر
analyze public.orders;
analyze public.transactions;
