import { z } from 'zod';

// Punch in validation
export const punchInSchema = z.object({
  projectId: z.string().optional(),
  locationType: z.enum(['OFFICE', 'SITE', 'REMOTE']).default('OFFICE'),
  latitude: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => (val ? parseFloat(val) : null)),
  longitude: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => (val ? parseFloat(val) : null)),
  notes: z.string().max(500, 'Notes cannot exceed 500 characters').optional(),
  deviceInfo: z.string().optional(),
});

// Punch out validation
export const punchOutSchema = z.object({
  latitude: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => (val ? parseFloat(val) : null)),
  longitude: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => (val ? parseFloat(val) : null)),
  notes: z.string().max(500, 'Notes cannot exceed 500 characters').optional(),
});

// Mark attendance for others validation
export const markAttendanceForOthersSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  date: z.string().min(1, 'Date is required'),
  status: z
    .enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'ON_LEAVE'])
    .default('PRESENT'),
  projectId: z.string().optional(),
  checkInTime: z.string().optional(),
  checkOutTime: z.string().optional(),
  leaveType: z
    .enum([
      'SICK_LEAVE',
      'CASUAL_LEAVE',
      'EARNED_LEAVE',
      'MATERNITY_LEAVE',
      'PATERNITY_LEAVE',
    ])
    .optional(),
  leaveReason: z
    .string()
    .max(500, 'Leave reason cannot exceed 500 characters')
    .optional(),
  notes: z.string().max(500, 'Notes cannot exceed 500 characters').optional(),
});

// Update attendance validation
export const updateAttendanceSchema = z.object({
  date: z.string().optional(),
  status: z
    .enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'ON_LEAVE'])
    .optional(),
  projectId: z.string().optional(),
  checkInTime: z.string().optional(),
  checkOutTime: z.string().optional(),
  workingHours: z.number().min(0).max(24).optional(),
  overtimeHours: z.number().min(0).max(24).optional(),
  leaveType: z
    .enum([
      'SICK_LEAVE',
      'CASUAL_LEAVE',
      'EARNED_LEAVE',
      'MATERNITY_LEAVE',
      'PATERNITY_LEAVE',
    ])
    .optional(),
  leaveReason: z
    .string()
    .max(500, 'Leave reason cannot exceed 500 characters')
    .optional(),
  notes: z.string().max(500, 'Notes cannot exceed 500 characters').optional(),
  isVerified: z.boolean().optional(),
  verificationNotes: z
    .string()
    .max(500, 'Verification notes cannot exceed 500 characters')
    .optional(),
});

// Verify attendance validation
export const verifyAttendanceSchema = z.object({
  isVerified: z.boolean(),
  verificationNotes: z
    .string()
    .max(500, 'Verification notes cannot exceed 500 characters')
    .optional(),
});

// Apply for leave validation
export const applyLeaveSchema = z.object({
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  leaveType: z.enum([
    'SICK_LEAVE',
    'CASUAL_LEAVE',
    'EARNED_LEAVE',
    'MATERNITY_LEAVE',
    'PATERNITY_LEAVE',
  ]),
  reason: z
    .string()
    .min(10, 'Reason must be at least 10 characters')
    .max(500, 'Reason cannot exceed 500 characters'),
  attachmentUrl: z.string().url('Invalid URL').optional().or(z.literal('')),
});

// Attendance report validation
export const attendanceReportSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  department: z.string().optional(),
  projectId: z.string().optional(),
  reportType: z
    .enum(['summary', 'detailed', 'department', 'overtime'])
    .default('summary'),
  page: z.number().int().positive().optional().default(1),
  limit: z.number().int().positive().max(100).optional().default(20),
});

// Get attendance validation
export const getAttendanceSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.number().int().positive().optional().default(1),
  limit: z.number().int().positive().max(100).optional().default(30),
});

// File upload validation for images
export const attendanceImageSchema = z.object({
  fieldname: z.literal('image'),
  originalname: z.string(),
  encoding: z.string(),
  mimetype: z.enum(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']),
  size: z.number().max(5 * 1024 * 1024, 'Image size must be less than 5MB'), // 5MB max
});
