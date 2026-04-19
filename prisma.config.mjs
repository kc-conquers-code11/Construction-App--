// prisma.config.mjs - Prisma 7 configuration (ESM variant)
export default {
  schema: './prisma/schema.prisma',
  datasourceUrl: process.env.DATABASE_URL,
};
