// src/validations/payroll.validations.js
import { z } from 'zod';

// Shift Type Validation
export const createShiftTypeSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50),
  multiplier: z.number().positive('Multiplier must be positive'),
  description: z.string().max(200).optional(),
});

export const updateShiftTypeSchema = createShiftTypeSchema.partial();

// Labour Rate Validation
export const createLabourRateSchema = z.object({
  workerType: z.enum(['SITE_STAFF', 'SUBCONTRACTOR']),
  workerId: z.string().min(1, 'Worker ID is required'),
  rate: z.number().positive('Rate must be positive'),
  effectiveFrom: z.string().min(1, 'Effective from date is required'),
  reason: z.string().max(200).optional(),
});

export const updateLabourRateSchema = z.object({
  rate: z.number().positive().optional(),
  effectiveFrom: z.string().optional(),
  reason: z.string().max(200).optional(),
  isApproved: z.boolean().optional(),
  approvalNotes: z.string().max(200).optional(),
});

// Payroll Validation
export const calculatePayrollSchema = z.object({
  periodFrom: z.string().min(1, 'Period from date is required'),
  periodTo: z.string().min(1, 'Period to date is required'),
  projectId: z.string().optional(),
  workerType: z.enum(['SITE_STAFF', 'SUBCONTRACTOR']).optional(),
});

export const createPayrollSchema = z.object({
  periodFrom: z.string().min(1, 'Period from date is required'),
  periodTo: z.string().min(1, 'Period to date is required'),
  periodType: z
    .enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'CUSTOM'])
    .default('CUSTOM'),
  workers: z.array(
    z.object({
      workerType: z.enum(['SITE_STAFF', 'SUBCONTRACTOR']),
      workerId: z.string(),
      workerName: z.string(),
      workerCode: z.string(),
      designation: z.string().optional(),
      attendances: z.array(z.any()),
      totalDays: z.number(),
      actualDays: z.number(),
      overtimeDays: z.number(),
      baseRate: z.number(),
      grossAmount: z.number(),
      deductions: z.number().optional(),
      bonus: z.number().optional(),
      deductionDetails: z.any().optional(),
      bonusDetails: z.any().optional(),
      notes: z.string().optional(),
    })
  ),
  notes: z.string().max(500).optional(),
});

export const updatePayrollStatusSchema = z.object({
  status: z.enum(['PENDING', 'PROCESSED', 'PAID', 'APPROVED', 'CANCELLED']),
  notes: z.string().max(500).optional(),
  paymentMethod: z.string().optional(),
  paymentReference: z.string().optional(),
});
