// src/validations/worker.validations.js
import { z } from 'zod';

// Site Staff validation
export const createSiteStaffSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  phone: z.string().optional(),
  alternatePhone: z.string().optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  aadharNumber: z
    .string()
    .min(12, 'Aadhar number must be 12 digits')
    .max(12)
    .optional()
    .or(z.literal('')),
  panNumber: z
    .string()
    .min(10, 'PAN number must be 10 characters')
    .max(10)
    .optional()
    .or(z.literal('')),
  address: z.string().optional(),
  designation: z.string().optional(),
  skillSet: z.union([z.string(), z.array(z.string())]).optional(),
  experience: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val) : null)),
  dailyWageRate: z.string().or(z.number()).default(500),
  overtimeRate: z.string().or(z.number()).default(1.5),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  bankIfsc: z.string().optional(),
  dateOfJoining: z.string().optional(),
  dateOfBirth: z.string().optional(),
  emergencyContact: z.string().optional(),
  emergencyPhone: z.string().optional(),
  notes: z.string().max(500).optional(),
});

export const updateSiteStaffSchema = createSiteStaffSchema.partial();

// Worker Attendance validation - UPDATED with shiftTypeId
export const workerPunchInSchema = z.object({
  workerType: z.enum(['SITE_STAFF', 'SUBCONTRACTOR']),
  workerId: z.string().min(1, 'Worker ID is required'),
  projectId: z.string().min(1, 'Project ID is required'),
  shiftTypeId: z.string().uuid('Invalid shift type ID').optional(),
  latitude: z.string().or(z.number()).optional(),
  longitude: z.string().or(z.number()).optional(),
  notes: z.string().max(500).optional(),
  subtaskAssignmentId: z.string().optional(),
});

export const workerPunchOutSchema = z.object({
  attendanceId: z.string().min(1, 'Attendance ID is required'),
  latitude: z.string().or(z.number()).optional(),
  longitude: z.string().or(z.number()).optional(),
  notes: z.string().max(500).optional(),
});

// Bulk Worker Attendance validation 
export const bulkWorkerAttendanceSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  projectId: z.string().min(1, 'Project ID is required'),
  attendanceData: z
    .array(
      z.object({
        workerType: z.enum(['SITE_STAFF', 'SUBCONTRACTOR']),
        workerId: z.string().min(1),
        shiftTypeId: z.string().uuid('Invalid shift type ID').optional(), // NEW: Add shift type
        status: z
          .enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY'])
          .default('PRESENT'),
        checkInTime: z.string().optional(),
        checkOutTime: z.string().optional(),
        notes: z.string().max(500).optional(),
      })
    )
    .min(1, 'At least one attendance record is required'),
});

// Subtask Assignment validation
export const assignSubtaskToWorkerSchema = z.object({
  workerType: z.enum(['SITE_STAFF', 'SUBCONTRACTOR']),
  workerId: z.string().min(1, 'Worker ID is required'),
  subtaskId: z.string().min(1, 'Subtask ID is required'),
  taskId: z.string().min(1, 'Task ID is required'),
  projectId: z.string().min(1, 'Project ID is required'),
  startDate: z.string().optional(),
  dueDate: z.string().optional(),
  estimatedHours: z.string().or(z.number()).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  notes: z.string().max(500).optional(),
});

export const updateSubtaskAssignmentSchema = z.object({
  status: z.enum([
    'PENDING',
    'ACCEPTED',
    'IN_PROGRESS',
    'COMPLETED',
    'VERIFIED',
    'REJECTED',
  ]),
  actualHours: z.string().or(z.number()).optional(),
  completionNotes: z.string().max(500).optional(),
  qualityRating: z.number().min(1).max(5).optional(),
  feedback: z.string().max(500).optional(),
});

export const verifySubtaskCompletionSchema = z.object({
  isVerified: z.boolean(),
  verificationNotes: z.string().max(500).optional(),
  qualityRating: z.number().min(1).max(5).optional(),
});

// Worker Assignment validation
export const assignSiteStaffToProjectSchema = z.object({
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().optional(),
  designation: z.string().optional(),
  dailyWageRate: z.string().or(z.number()).optional(),
  overtimeRate: z.string().or(z.number()).optional(),
  notes: z.string().max(500).optional(),
});
