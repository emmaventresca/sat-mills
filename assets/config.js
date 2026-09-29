// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------
window.CONFIG = {
  // Supabase: Project Settings -> Data API.
  // The anon key is public by design - it ships to every browser. Row-level
  // security in supabase/schema.sql is what protects the data, not this key.
  // NEVER put the service_role key here.
  SUPABASE_URL:      "https://eulmcznaolcaydyygxrt.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1bG1jem5hb2xjYXlkeXlneHJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NDM4ODIsImV4cCI6MjEwNjIxOTg4Mn0.jV9Ra58h_Yo__KmKpiG_eUwukWJzQxmI1d6zr_tC0EY",

  // Passwords are stored as SHA-256 hashes so the plain text is not sitting in
  // a public repo. This is obfuscation, not real security: the check still
  // happens in the browser and anyone determined can bypass it. See README.
  // Regenerate with:  python3 tools/hash_password.py "new password"
  STUDENT_NAME:            "Mills",
  STUDENT_PASSWORD_SHA256: "2a41acacaddf03832450c109644dcb47679a5ce9fe9932ba0186f27896025752", // Mills
  TEACHER_PASSWORD_SHA256: "29b22914af8e9cdadf78fafa8223fd1e021d1602a56def2dbc5b893676f214f5",

  // Cards per practice round
  ROUND_SIZE: 20
};
