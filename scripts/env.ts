import { loadEnvConfig } from "@next/env";

/**
 * Load env files the same way Next does. Locally this picks up
 * .env.development.local (DATABASE_URL=file:…) before .env.local.
 * Variables already in process.env (Vercel build) always win.
 */
const dev = process.env.NODE_ENV !== "production" && !process.env.VERCEL;
loadEnvConfig(process.cwd(), dev, { info: () => {}, error: console.error });
