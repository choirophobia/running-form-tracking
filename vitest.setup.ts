import { existsSync } from "node:fs";
import path from "node:path";

// Next.js loads .env.local automatically; Vitest doesn't, so the
// Supabase-dependent integration tests (route.supabase.test.ts) need this
// to pick up NEXT_PUBLIC_SUPABASE_URL etc. Uses Node's built-in loader
// (no dotenv dependency needed).
const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (existsSync(envLocalPath)) {
  process.loadEnvFile(envLocalPath);
}
