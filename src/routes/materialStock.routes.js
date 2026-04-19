import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../validations/index.js';
import {
  getMaterialStockHistorySchema,
  getStockAlertsSchema,
  resolveAlertSchema,
} from '../validations/material.validations.js';
import {
  getMaterialStockHistory,
  getStockAlerts,
  resolveStockAlert,
  getMaterialConsumptionReport,
} from '../controllers/materialStock.controller.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Material Stock routes
router.get(
  '/:materialId/history',
  validate(getMaterialStockHistorySchema),
  getMaterialStockHistory
);
router.get('/alerts', validate(getStockAlertsSchema), getStockAlerts);
router.patch(
  '/alerts/:id/resolve',
  validate(resolveAlertSchema),
  resolveStockAlert
);
router.get('/consumption-report', getMaterialConsumptionReport);

export default router;
