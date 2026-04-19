// prisma.config.ts - Prisma 7 configuration
export default {
  schema: './prisma/schema.prisma',
  datasourceUrl: process.env.DATABASE_URL,
};
