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
  /** Trust X-Forwarded-For for the client IP (rate limits). On by default on Vercel, whose edge sets the header itself.
   *  Set TRUST_PROXY=true (or a hop count / proxy IPs) behind your own reverse proxy; leave unset when the API faces the internet directly. */
  trustProxy: (() => {
    const v = env.TRUST_PROXY;
    if (v === undefined || v === '') return !!env.VERCEL || env.SERVERLESS === 'true';
    if (v === 'true' || v === 'false') return v === 'true';
    return /^\d+$/.test(v) ? Number(v) : v;
  })() as boolean | number | string,
  /** Private uploads (driver documents, proof-of-delivery photos) are served only with a signed link this long-lived (seconds). */
  uploadLinkTtlS: Number(env.UPLOAD_LINK_TTL_S ?? 3600),
  /** Share-trip tracking links stop working this many hours after the trip ends (completed, cancelled or no drivers). */
  shareLinkHours: Number(env.SHARE_LINK_HOURS ?? 24),
  /** Rate limits (per hour unless noted). Shared through the database so they hold across serverless instances. */
  rateLimits: {
    otpRequestPerIp: Number(env.RATE_OTP_REQUEST_PER_IP ?? 30),
    otpVerifyFailPerIp: Number(env.RATE_OTP_VERIFY_FAIL_PER_IP ?? 30),
    publicFormPerIp: Number(env.RATE_PUBLIC_FORM_PER_IP ?? 10),
    /** Per 10 minutes: each estimate may use a routing-provider call (free quota). */
    estimatePerIp10Min: Number(env.RATE_ESTIMATE_PER_IP_10MIN ?? 60),
    uploadsPerUser: Number(env.RATE_UPLOADS_PER_USER ?? 30),
    partnerCodeFailsPerUser: Number(env.RATE_PARTNER_CODE_FAILS ?? 20),
  },
  publicWebUrl: env.PUBLIC_WEB_URL ?? 'http://localhost:5173',
  /** Round 21: Android App Links. SHA-256 certificate fingerprints of the rider app's signing keys (Google Play's app signing key,
   *  and the upload key for internal testing), comma separated. Unset = no app claims the website's links (they open in the browser). */
  android: {
    appLinkCerts: env.ANDROID_APP_LINK_CERTS ?? '',
    riderPackage: env.ANDROID_RIDER_PACKAGE ?? 'au.com.dingogo.rider',
  },
  /** Card payments. Empty secret key = built-in mock provider (no network). */
  stripe: {
    secretKey: env.STRIPE_SECRET_KEY ?? '',                 // sk_test_… / sk_live_… (server only)
    publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? '',       // pk_… for Stripe Elements in the rider app (sent by GET /payment-methods)
    webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',         // whsec_… for POST /payments/stripe/webhook; empty = webhook refuses (503)
    apiBase: env.STRIPE_API_BASE ?? 'https://api.stripe.com',
    /** Pinned so a Stripe account upgrade can't change response shapes under us. */
    apiVersion: env.STRIPE_API_VERSION ?? '2024-06-20',
    timeoutMs: Number(env.STRIPE_TIMEOUT_MS ?? 15000),
    /** Webhook signatures older than this (seconds) are refused (replayed captures). */
    webhookToleranceS: Number(env.STRIPE_WEBHOOK_TOLERANCE_S ?? 300),
  },
  /** Without Stripe, who may "pay" by card with the mock provider: all (development), test (seeded demo numbers and admin-made test
   *  accounts; everyone else sees "card payments coming soon") or off. Default: all in dev mode, test otherwise. */
  mockCards: ((env.MOCK_CARDS ?? '') || ((env.OTP_DEV_MODE ?? (env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true' ? 'all' : 'test')) as 'all' | 'test' | 'off',
  /** SMS, masked calls and texts (Twilio). Without a SID and token, texts are written to the log instead (development). */
  twilio: {
    sid: env.TWILIO_ACCOUNT_SID ?? '',
    token: env.TWILIO_AUTH_TOKEN ?? '',
    /** Sender: an Australian number (+61…, takes replies) or an alphanumeric sender ID such as "DingoGo" (one-way only). */
    from: env.TWILIO_FROM ?? '',
    /** Optional Messaging Service (MG…) used instead of TWILIO_FROM: number pool, opt-out handling, sender ID by country. */
    messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID ?? '',
    /** Number that takes replies, for marketing texts (Spam Act: "Reply STOP" must work). Default: TWILIO_FROM when it is a number. */
    marketingFrom: env.TWILIO_MARKETING_FROM ?? '',
    /** Masked calls and texts between rider and driver go through this Twilio number (its Voice and SMS webhooks point at the API). Empty = in-app chat only. */
    relayNumber: env.TWILIO_RELAY_NUMBER ?? '',
    /** Public base URL of the API as Twilio calls it, for webhook signatures, e.g. https://dingogo.com.au/api. Default: from the request. */
    webhookBaseUrl: (env.TWILIO_WEBHOOK_BASE_URL ?? '').replace(/\/$/, ''),
    apiBase: env.TWILIO_API_BASE ?? 'https://api.twilio.com',
    timeoutMs: Number(env.TWILIO_TIMEOUT_MS ?? 8000),
  },
  /** Push notifications. Each provider is off until configured; in-app inbox and realtime always work. */
  push: {
    /** Firebase service account JSON (or base64 of it) for FCM HTTP v1: Android apps (Capacitor push). */
    fcmServiceAccount: env.FCM_SERVICE_ACCOUNT ?? '',
    fcmApiBase: env.FCM_API_BASE ?? 'https://fcm.googleapis.com',
    /** Web Push (installed web app / PWA). Generate with `npm run vapid -w services/api`. */
    vapidPublicKey: env.WEB_PUSH_VAPID_PUBLIC_KEY ?? '',
    vapidPrivateKey: env.WEB_PUSH_VAPID_PRIVATE_KEY ?? '',
    vapidSubject: env.WEB_PUSH_SUBJECT ?? 'mailto:support@dingogo.com.au',
    timeoutMs: Number(env.PUSH_TIMEOUT_MS ?? 8000),
  },
  /** Round 27: email (owner weekly summary) through Resend's HTTP API. Without a key, emails are written to the log and not sent. */
  email: {
    resendApiKey: env.RESEND_API_KEY ?? '',
    /** Sender on a domain verified in Resend, e.g. "DingoGo <reports@dingogo.com.au>". */
    from: env.EMAIL_FROM ?? '',
    apiBase: env.EMAIL_API_BASE ?? 'https://api.resend.com',
    timeoutMs: Number(env.EMAIL_TIMEOUT_MS ?? 10000),
  },
  /** Legacy: Expo push service, used only for Expo tokens (ExponentPushToken[…]). */
  expoPushEnabled: env.EXPO_PUSH_ENABLED === 'true',
  orsKey: env.ORS_API_KEY ?? '',                             // openrouteservice.org free key (2,000 routes/day)
  osrmUrl: env.OSRM_URL ?? '',
  /** Paid plate lookup (regcheck.org.uk "CheckAustralia"). Empty = off; admin lookup returns 501 lookup_not_configured. */
  regcheckUsername: env.REGCHECK_USERNAME ?? '',
  regcheckUrl: env.REGCHECK_URL ?? 'https://www.regcheck.org.uk/api/reg.asmx/CheckAustralia',                               // e.g. https://router.project-osrm.org (self-host for prod)
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
    /** Green cars (electric, plug-in hybrid, hybrid) get trips first: ranked as if this many metres closer to the pickup. */
    greenBonusM: Number(env.DISPATCH_GREEN_BONUS_M ?? 1500),
    /** Accept taps that reach the server up to this many seconds after the offer ran out (while it is still the latest offer). */
    offerGraceS: Number(env.OFFER_GRACE_S ?? 3),
    /** A trip whose driver cancels before pickup (car trouble etc.) goes back to the search at most this many times. */
    maxReoffers: Number(env.DISPATCH_MAX_REOFFERS ?? 2),
    /** Cancellations after accepting (driver's own reasons) within 7 days that raise a compliance flag. */
    driverCancelFlagCount: Number(env.DRIVER_CANCEL_FLAG_COUNT ?? 3),
    /** No location from the driver of a live trip for this long: ops are alerted. */
    driverSilentAlertMin: Number(env.DRIVER_SILENT_ALERT_MIN ?? 4),
    /** No location for this long on an accepted trip (not yet at pickup): give it to another driver. 0 = off (default):
     *  phones pause the app while the driver navigates in Google/Apple Maps, so silence alone isn't proof they've gone. */
    driverSilentReassignMin: Number(env.DRIVER_SILENT_REASSIGN_MIN ?? 0),
    /** Online drivers with no signal for this long (and no live trip) are set offline. */
    driverStaleOfflineMin: Number(env.DRIVER_STALE_OFFLINE_MIN ?? 30),
    /** A scheduled booking released this late (nobody was using the apps to run the dispatcher) is not sent to drivers. */
    scheduledMissedMin: Number(env.SCHEDULED_MISSED_MIN ?? 30),
  },
  /** Round 14: safety and trust. Rules (fatigue, check-ins, photo checks) are admin settings (`safety_policy`); these are integrations. */
  safety: {
    /** Face-match provider for driver photo checks (POST JSON { selfie, reference } as base64, answers { score } 0–1). Empty = DingoGo reviews every photo. */
    faceMatchUrl: env.FACE_MATCH_URL ?? '',
    faceMatchKey: env.FACE_MATCH_KEY ?? '',
    faceMatchTimeoutMs: Number(env.FACE_MATCH_TIMEOUT_MS ?? 5000),
    /** Street address for the emergency card: a Pelias / openrouteservice-style reverse geocoder (`?point.lat=&point.lon=&size=1`,
     *  ORS_API_KEY sent as Authorization). Empty = nearest landmark and GPS only. */
    reverseGeocodeUrl: env.REVERSE_GEOCODE_URL ?? '',
    /** How often the dispatcher runs the safety checks (long stops, unanswered check-ins, fatigue), in seconds. */
    tickS: Number(env.SAFETY_TICK_S ?? 20),
  },
  loyalty: {
    pointsPerDollar: 10,         // 10 pts per $1 spent
    referralBonusPoints: 500,    // both sides, after referee's first completed trip
    redemptionValidDays: 30,
  },
  timezone: 'Australia/Darwin',
  /** Round 18: performance on serverless. */
  perf: {
    /** Fare rules, zones, holidays and hot settings are kept in memory this long (ms) per instance; 0 = always read the database. */
    cacheTtlMs: Number(env.CONFIG_CACHE_TTL_MS ?? 15000),
    /** Database connections per instance. Serverless: each instance is one function, and the Supabase pooler shares server connections. */
    dbPoolMax: Number(env.DB_POOL_MAX ?? (env.VERCEL || env.SERVERLESS === 'true' ? 3 : 10)),
    /** Close a connection that has been idle this long (ms). */
    dbIdleMs: Number(env.DB_IDLE_TIMEOUT_MS ?? (env.VERCEL || env.SERVERLESS === 'true' ? 5000 : 10000)),
    /** Give up waiting for any one query after this long (ms, measured by the API; 0 = no limit). Above the migration limit. */
    dbQueryTimeoutMs: Number(env.DB_QUERY_TIMEOUT_MS ?? 25000),
    /** Postgres cancels a statement inside a transaction after this long (ms; SET LOCAL, so it works through the transaction pooler). 0 = off. */
    dbStatementTimeoutMs: Number(env.DB_STATEMENT_TIMEOUT_MS ?? 15000),
    /** Serverless: one instance at a time runs the dispatcher on requests, at most once per this many ms (claimed in the database). */
    tickEveryMs: Number(env.DISPATCH_TICK_EVERY_MS ?? 3000),
  },
  /** Operations (Round 10): migrations at cold start, health checks, database roles. */
  ops: {
    /** Apply pending migrations when the API starts (advisory lock; safe with many instances). A fresh empty database also gets the base data. */
    autoMigrate: env.AUTO_MIGRATE === 'true',
    /** Owner connection for migrations when DATABASE_URL is a least-privilege role. Default: DATABASE_URL. */
    migrationDatabaseUrl: env.MIGRATION_DATABASE_URL ?? '',
    /** At cold start, wait this long for another instance that is already migrating, then serve on. */
    autoMigrateWaitMs: Number(env.AUTO_MIGRATE_WAIT_MS ?? 10000),
    /** Per-statement limit for migrations run at cold start (serverless functions stop at 30 s). */
    autoMigrateStatementTimeoutMs: Number(env.AUTO_MIGRATE_STATEMENT_TIMEOUT_MS ?? 20000),
    /** A migration that can't get its table locks this fast gives up (instead of queueing every request behind it). */
    migrateLockTimeoutMs: Number(env.MIGRATE_LOCK_TIMEOUT_MS ?? 5000),
    /** Lets a monitor read the full /health/deep report without an admin sign-in (send as X-Health-Token). */
    healthToken: env.HEALTH_TOKEN ?? '',
    /** Optional least-privilege role for the API (rows only, no schema changes), created by db:bootstrap. */
    apiRole: env.DB_API_ROLE ?? '',
    apiRolePassword: env.DB_API_ROLE_PASSWORD ?? '',
    /** Row Level Security on every public table (Supabase REST API locked out). Default on. */
    rls: env.DB_RLS !== 'off',
    /** First admin for a fresh database (db:bootstrap, or AUTO_MIGRATE on an empty database). */
    adminPhone: env.BOOTSTRAP_ADMIN_PHONE ?? '',
    adminName: env.BOOTSTRAP_ADMIN_NAME ?? '',
    adminEmail: env.BOOTSTRAP_ADMIN_EMAIL ?? '',
  },
};
