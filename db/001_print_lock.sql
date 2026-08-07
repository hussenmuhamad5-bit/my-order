-- ============================================================
--  قوفڵی پرێنت — ستوونە نوێیەکانی خشتەی orders
-- ------------------------------------------------------------
--  پرێنت لە دەرەوەی ئەپەکە دەکرێت (سیستەمی گەیاندن). ئەپەکە
--  تەنها نیشانەی دەکات، بۆیە دۆخەکە لە Supabase دەمێنێتەوە نەک
--  لە مۆبایلی هەر کەسێک. لەو ساتەوە ئۆردەرەکە قوفڵ دەبێت تا
--  بارکۆدەکەی سکان بکرێت.
--
--  ئۆردەر قوفڵە کاتێک:  printed_at IS NOT NULL AND print_scanned_at IS NULL
--
--  چۆن جێبەجێی بکەیت:
--    Supabase → SQL Editor → New query → ئەمە لکێنە → Run
-- ============================================================

alter table public.orders add column if not exists printed_at       timestamptz;
alter table public.orders add column if not exists printed_by       text;
alter table public.orders add column if not exists print_scanned_at timestamptz;
alter table public.orders add column if not exists print_scanned_by text;

-- ڕوونکردنەوە بۆ ئەوانەی دواتر خشتەکە دەخوێننەوە
comment on column public.orders.printed_at       is 'کاتی نیشانەکردنی وەسڵ وەک پرێنتکراو — لەم ساتەوە ئۆردەرەکە قوفڵە';
comment on column public.orders.printed_by       is 'ناوی ئەو کەسەی نیشانەی کرد وەک پرێنتکراو';
comment on column public.orders.print_scanned_at is 'کاتی سکانی بارکۆد — قوفڵەکە لادەبات';
comment on column public.orders.print_scanned_by is 'ناوی ئەو کەسەی سکانی کرد و قوفڵەکەی لابرد';

-- ئۆردەرە قوفڵکراوەکان بە خێرایی دەدۆزرێنەوە (لیستی «پرێنتکراو، چاوەڕوانی سکان»)
create index if not exists orders_print_lock_idx
    on public.orders (printed_at)
    where printed_at is not null and print_scanned_at is null;
