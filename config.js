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

// Function to load Supabase script dynamically
function loadSupabaseScript() {
    return new Promise((resolve, reject) => {
        if (window.supabase) {
            resolve();
            return;
        }
        
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
        script.onload = () => {
            console.log('Supabase script loaded');
            resolve();
        };
        script.onerror = () => {
            console.error('Failed to load Supabase script');
            reject(new Error('Failed to load Supabase script'));
        };
        document.head.appendChild(script);
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