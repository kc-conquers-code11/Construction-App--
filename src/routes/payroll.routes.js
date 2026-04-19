// src/routes/payroll.routes.js
import express from 'express';
import { validate } from '../validations/index.js';
import {
  createShiftType,
  getAllShiftTypes,
  getShiftTypeById,
  updateShiftType,
  deleteShiftType,
  toggleShiftTypeStatus,
} from '../controllers/shiftType.controller.js';
import {
  createLabourRate,
  getLabourRates,
  getCurrentLabourRate,
  getLabourRateHistory,
  updateLabourRate,
} from '../controllers/labourRate.controller.js';
import {
  calculatePayroll,
  createPayroll,
  getAllPayrolls,
  getPayrollById,
  updatePayrollStatus,
  // getPayrollSummary,
  deletePayroll,
  getDailyPayrollSummary, // NEW: Import the daily summary function
} from '../controllers/payroll.controller.js';
import {
  createShiftTypeSchema,
  updateShiftTypeSchema,
  createLabourRateSchema,
  updateLabourRateSchema,
  calculatePayrollSchema,
  createPayrollSchema,
  updatePayrollStatusSchema,
} from '../validations/payroll.validations.js';

const router = express.Router();

// ==================== Shift Type Routes ====================
router.post('/shift-types', validate(createShiftTypeSchema), createShiftType);
router.get('/shift-types', getAllShiftTypes);
router.get('/shift-types/:id', getShiftTypeById);
router.patch(
  '/shift-types/:id',
  validate(updateShiftTypeSchema),
  updateShiftType
);
router.delete('/shift-types/:id', deleteShiftType);
router.patch('/shift-types/:id/toggle', toggleShiftTypeStatus);

// ==================== Labour Rate Routes ====================
router.post(
  '/labour-rates',
  validate(createLabourRateSchema),
  createLabourRate
);
router.get('/labour-rates', getLabourRates);
router.get('/labour-rates/current/:workerType/:workerId', getCurrentLabourRate);
router.get('/labour-rates/history/:workerType/:workerId', getLabourRateHistory);
router.patch(
  '/labour-rates/:id',
  validate(updateLabourRateSchema),
  updateLabourRate
);

// ==================== Payroll Routes ====================
router.post('/calculate', validate(calculatePayrollSchema), calculatePayroll);
router.post('/', validate(createPayrollSchema), createPayroll);
router.get('/', getAllPayrolls);
// router.get('/summary', getPayrollSummary);
router.get('/daily-summary', getDailyPayrollSummary); // NEW: Route for daily payroll summary
router.get('/:id', getPayrollById);
router.patch(
  '/:id/status',
  validate(updatePayrollStatusSchema),
  updatePayrollStatus
);
router.delete('/:id', deletePayroll);

export default router;
