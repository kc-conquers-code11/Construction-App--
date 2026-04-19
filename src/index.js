// src/index.js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.routes.js';
import companyRoutes from './routes/company.routes.js';
import verificationRoutes from './routes/verification.routes.js';
import userRoutes from './routes/user.routes.js';
import roleRoutes from './routes/role.routes.js';
import permissionRoutes from './routes/permission.routes.js';
import projectRoutes from './routes/project.routes.js';
import clientRoutes from './routes/client.routes.js';
import taskRoutes from './routes/task.routes.js';
import taskAttachmentRoutes from './routes/taskAttachment.routes.js';
import dprRoutes from './routes/dpr.routes.js';
import dprPhotoRoutes from './routes/dprPhoto.routes.js';
import superAdminRoutes from './routes/superAdmin.routes.js';
import materialRoutes from './routes/material.routes.js';
import materialRequestRoutes from './routes/materialRequest.routes.js';
import subcontractorRoutes from './routes/subcontractor.routes.js';
import materialStockRoutes from './routes/materialStock.routes.js';
import timelineRoutes from './routes/timeline.routes.js';
import timelineAnalysisRoutes from './routes/timelineAnalysis.routes.js';
import attendanceRoutes from './routes/attendance.routes.js';
import subcontractorDocumentRoutes from './routes/subcontractorDocument.routes.js';
import workerRoutes from './routes/worker.routes.js';
import inventoryRoutes from './routes/inventory.routes.js';
import payrollRoutes from './routes/payroll.routes.js';
import budgetRoutes from './routes/budget.routes.js';
import purchaseOrderRoutes from './routes/purchase-order.routes.js';
import supplierRoutes from './routes/supplier.routes.js';
import wprRoutes from './routes/wpr.routes.js';
import transactionRoutes from './routes/transaction.routes.js';
import {
  testDatabaseConnection,
  disconnectDatabase,
} from './config/database.js';
import dashboardRoutes from './routes/dashboard.routes.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Company-ID'],
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files in development
// if (process.env.NODE_ENV !== 'production') {
//   const uploadsPath = path.join(__dirname, '../uploads');
//   app.use('/uploads', express.static(uploadsPath));
//   console.log('📁 Serving static files from:', uploadsPath);

//   // Create uploads directory if it doesn't exist
//   const fs = await import('fs');
//   if (!fs.existsSync(uploadsPath)) {
//     fs.mkdirSync(uploadsPath, { recursive: true });
//     console.log('✅ Created uploads directory');
//   }
// }

const uploadsPath = path.join(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsPath));
console.log('📁 Serving static files from:', uploadsPath);

// Create uploads directory if it doesn't exist
const fs = await import('fs');
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
  console.log('✅ Created uploads directory');
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// API routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/super-admin', superAdminRoutes);
app.use('/api/v1/companies', companyRoutes);
app.use('/api/v1/verification', verificationRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/roles', roleRoutes);
app.use('/api/v1/permissions', permissionRoutes);
app.use('/api/v1/projects', projectRoutes);
app.use('/api/v1/clients', clientRoutes);
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1/task-attachments', taskAttachmentRoutes);
app.use('/api/v1/dpr', dprRoutes);
app.use('/api/v1/dpr-photos', dprPhotoRoutes);
app.use('/api/v1/subcontractors', subcontractorRoutes);
app.use('/api/v1/timelines', timelineRoutes);
app.use('/api/v1/timelines-analysis', timelineAnalysisRoutes);
app.use('/api/v1/subcontractor-documents', subcontractorDocumentRoutes);
app.use('/api/v1/attendance', attendanceRoutes);
app.use('/api/v1/workers', workerRoutes);
// redundant routes
// app.use('/api/v1/materials', materialRoutes);
// app.use('/api/v1/material-stock', materialStockRoutes);
app.use('/api/v1/inventory', inventoryRoutes);
app.use('/api/v1/material-requests', materialRequestRoutes);
app.use('/api/v1/payroll', payrollRoutes);
app.use('/api/v1/purchase-orders', purchaseOrderRoutes);
app.use('/api/v1/suppliers', supplierRoutes);
app.use('/api/v1/wpr', wprRoutes);
app.use('/api/v1/budgets', budgetRoutes);
app.use('/api/v1/transactions', transactionRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// Global Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  // Handle Prisma P2002 (Unique constraint violation)
  if (err.code === 'P2002') {
    return res.status(409).json({
      success: false,
      message: 'Duplicate entry detected.',
    });
  }

  // Handle Prisma P2025 (Record not found)
  if (err.code === 'P2025') {
    return res.status(404).json({
      success: false,
      message: 'Record not found.',
    });
  }

  // Handle multer errors
  if (err.name === 'MulterError') {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  res.status(err.status || 500).json({
    success: false,
    message: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// Start server
const startServer = async () => {
  try {
    const dbConnected = await testDatabaseConnection();
    if (!dbConnected) {
      process.exit(1);
    }

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📁 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`📁 Base URL: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('Shutting down...');
  await disconnectDatabase();
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

startServer();

export default app;
