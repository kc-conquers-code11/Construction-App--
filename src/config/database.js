// src/config/database.js
import pkg from '../../generated/prisma/index.js';
const { PrismaClient } = pkg;
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not defined in environment variables');
}

// Log masked URL for debugging on Vercel
const maskedUrl = connectionString.replace(/:([^:@]+)@/, ':****@');
console.log(`🔌 Connecting to database with: ${maskedUrl}`);

// Create Prisma client with native driver
const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

// Connection test function
export const testDatabaseConnection = async () => {
  try {
    await prisma.$connect();
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
    console.log('Database connections closed');
  } catch (error) {
    console.error('Error closing database connections:', error);
  }
};

export default prisma;

