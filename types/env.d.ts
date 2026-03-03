declare namespace NodeJS {
  interface ProcessEnv {
    OPENAI_API_KEY: string;
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    INTEGRATION_KEY: string;
    GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
    GOOGLE_PRIVATE_KEY?: string;
    GOOGLE_SHEETS_SPREADSHEET_ID?: string;
  }
}
