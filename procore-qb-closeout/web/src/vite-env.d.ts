/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_PROCORE_CLIENT_ID: string;
  readonly VITE_QBO_CLIENT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
