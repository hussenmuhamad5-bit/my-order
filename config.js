// لینکی گۆگڵ سکرێپت بۆ بەشی ئۆردەرەکان (لینکی خۆت دابنێ)
var APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwtKMGXHm2XEA499c8HT9GDaSsMPQsMpTiZT56ju4LlfWw2_cOgZ-vvSOvvpXYc4nlcZQ/exec";
var SUPABASE_URL = "https://kxztaywhqpekjmjoynin.supabase.co";
var SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4enRheXdocXBla2ptam95bmluIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzE0MzkxMCwiZXhwIjoyMDkyNzE5OTEwfQ.-C3Z_nPQEK0KuDD8UehCJjp3Jp5u-wpxcNXM62EErvs";

// Initialize Supabase client
var supabase = null;

// Function to initialize Supabase
function initializeSupabase() {
    try {
        if (window.supabase && window.supabase.createClient) {
            supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
            
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

var currentUser = null;
try {
    var savedUserStr = localStorage.getItem('myAppUser');
    if (savedUserStr && savedUserStr !== "undefined") {
        currentUser = JSON.parse(savedUserStr);
    }
} catch (e) {
    localStorage.removeItem('myAppUser');
}