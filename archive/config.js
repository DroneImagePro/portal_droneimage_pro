// Public values only. NEVER put a service role key, a Stripe secret key or a database
// password in this file: it is downloaded by every visitor's browser.
//
// Find both values in Supabase: Project Settings > API.
//   SUPABASE_URL              the project URL (https://xxxx.supabase.co)
//   SUPABASE_PUBLISHABLE_KEY  the "publishable" key (older projects call it the "anon" key)
window.PORTAL_CONFIG = {
  SUPABASE_URL: "PASTE_PROJECT_URL_HERE",
  SUPABASE_PUBLISHABLE_KEY: "PASTE_PUBLISHABLE_KEY_HERE"
};
