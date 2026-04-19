import { defineConfig } from 'prisma';

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasourceUrl: process.env.DATABASE_URL,
});
