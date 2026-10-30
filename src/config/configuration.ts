export default () => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3000),
  },

  database: {
    url: process.env.DATABASE_URL,
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '7d',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },

  passwordReset: {
    expiresInMinutes: Number(
      process.env.PASSWORD_RESET_EXPIRES_IN_MINUTES ?? 30,
    ),
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    ttl: {
      default: Number(process.env.CACHE_TTL_DEFAULT ?? 300),
      dashboard: Number(process.env.CACHE_TTL_DASHBOARD ?? 300),
      reports: Number(process.env.CACHE_TTL_REPORTS ?? 600),
    },
    rateLimit: {
      windowSeconds: Number(process.env.RATE_LIMIT_WINDOW ?? 60),
      authMaxAttempts: Number(process.env.RATE_LIMIT_AUTH_MAX ?? 5),
      reportsMaxAttempts: Number(process.env.RATE_LIMIT_REPORTS_MAX ?? 30),
    },
  },
});
