// src/config/database.js
import pkg from '../../generated/prisma/index.js';
const { PrismaClient } = pkg;
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not defined in environment variables');
}

// Create connection pool
const pool = new pg.Pool({
  connectionString,
  max: 30,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,

  error: (err, client) => {
    console.error('PostgreSQL Pool Error:', err);
  },
});

const adapter = new PrismaPg(pool);

// Create Prisma client with logging
const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

// Connection test function
export const testDatabaseConnection = async () => {
  try {
    await prisma.$connect();
    // Simple query to verify connection
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Database connection successful');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
};

// Graceful shutdown
export const disconnectDatabase = async () => {
  try {
    await prisma.$disconnect();
    await pool.end();
    console.log('Database connections closed');
  } catch (error) {
    console.error('Error closing database connections:', error);
  }
};

export default prisma;
