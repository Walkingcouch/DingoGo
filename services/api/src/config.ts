// Central configuration — every value can be overridden by environment variables.
const env = process.env;

export const config = {
  port: Number(env.PORT ?? 4000),
  host: env.HOST ?? '0.0.0.0',
  databaseUrl: env.DATABASE_URL ?? 'postgres://dingogo:dingogo@localhost:5432/dingogo',
  jwtSecret: env.JWT_SECRET ?? (env.NODE_ENV === 'production' ? (() => { throw new Error('JWT_SECRET must be set in production'); })() : 'dev-only-change-me'),
  /** In dev, OTP codes are returned in the API response and "000000" always works. NEVER enable in production. */
  otpDevMode: (env.OTP_DEV_MODE ?? (env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
  /** Phone-number prefixes that always accept the demo code 000000 (seeded demo accounts), even in production. */
  /** Exact demo phone numbers that accept 000000 (seeded demo accounts). OTP_DEMO_PREFIXES is kept for back-compat
   *  but is narrowed to the seeded demo list, so real numbers can never use the demo code. */
  otpDemoPrefixes: (env.OTP_DEMO_PREFIXES ?? '').split(',').filter(Boolean),
  otpDemoNumbers: (env.OTP_DEMO_NUMBERS ?? '+61400000001,+61400000002,+61400000011,+61400000012,+61400000013,+61400000014,+61400000100,+61400000200,+61400000201,+61400000300').split(',').filter(Boolean),
  /** True on Vercel/serverless: no long-running timers or WebSockets, dispatch runs on incoming requests. */
  serverless: !!env.VERCEL || env.SERVERLESS === 'true',
  corsOrigins: (env.CORS_ORIGINS ?? '*').split(','),
  publicWebUrl: env.PUBLIC_WEB_URL ?? 'http://localhost:5173',
  stripeSecretKey: env.STRIPE_SECRET_KEY ?? '',            // sk_test_… — empty = mock payments
  twilio: {
    sid: env.TWILIO_ACCOUNT_SID ?? '',
    token: env.TWILIO_AUTH_TOKEN ?? '',
    from: env.TWILIO_FROM ?? '',
  },
  expoPushEnabled: env.EXPO_PUSH_ENABLED === 'true',
  osrmUrl: env.OSRM_URL ?? '',                               // e.g. https://router.project-osrm.org (self-host for prod)
  dispatch: {
    offerTimeoutS: Number(env.OFFER_TIMEOUT_S ?? 20),
    maxAttempts: Number(env.DISPATCH_MAX_ATTEMPTS ?? 5),
    /** Keep looking for a free car this long before telling the rider none are available. */
    searchWindowMin: Number(env.DISPATCH_SEARCH_WINDOW_MIN ?? 5),
    searchRadiusKm: Number(env.DISPATCH_RADIUS_KM ?? 25),
    scheduledLeadMin: Number(env.SCHEDULED_LEAD_MIN ?? 15),
    /** EVs lose range in Central Australian heat + A/C load. Dispatch uses rated range × this factor. */
    rangeDerate: Number(env.RANGE_DERATE ?? 0.7),
    /** Minimum battery a car must still have after the trip (and getting back to town). */
    reserveKm: Number(env.RANGE_RESERVE_KM ?? 40),
    tickMs: Number(env.DISPATCH_TICK_MS ?? 2000),
  },
  loyalty: {
    pointsPerDollar: 10,         // 10 pts per $1 spent
    referralBonusPoints: 500,    // both sides, after referee's first completed trip
    redemptionValidDays: 30,
  },
  timezone: 'Australia/Darwin',
};
