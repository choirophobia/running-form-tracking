// Batch 4: reads the Supabase connection details from env vars, failing
// loudly and immediately if they're missing rather than letting a client
// silently point at nothing. Points at the local Docker-based Supabase
// stack (`npx supabase start`) by default — see .env.local.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Run "npx supabase start" and copy its output into .env.local.`
    );
  }
  return value;
}

export function getSupabaseUrl(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function getSupabaseAnonKey(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}
