import { z } from 'zod';

// Create subcontractor validation
export const createSubcontractorSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  type: z.enum([
    'LABOR',
    'EQUIPMENT',
    'MATERIAL_SUPPLY',
    'TRANSPORTATION',
    'OTHER',
  ]),
  workTypes: z
    .array(
      z.enum([
        'CONCRETE',
        'STEEL',
        'CARPENTRY',
        'ELECTRICAL',
        'PLUMBING',
        'PAINTING',
        'TILING',
        'EXCAVATION',
        'DEMOLITION',
        'RENOVATION',
        'MAINTENANCE',
        'CLEANING',
        'LANDSCAPING',
        'OTHER',
      ])
    )
    .min(1, 'At least one work type is required'),
  contactPerson: z
    .string()
    .min(2, 'Contact person name must be at least 2 characters'),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  phone: z.string().min(10, 'Phone must be at least 10 digits'),
  altPhone: z.string().optional().or(z.literal('')),
  address: z
    .string()
    .min(5, 'Address must be at least 5 characters')
    .optional(),
  registrationNumber: z.string().optional().or(z.literal('')),
  gstNumber: z.string().optional().or(z.literal('')),
  panNumber: z.string().optional().or(z.literal('')),
  aadharNumber: z.string().optional().or(z.literal('')),
  bankName: z.string().optional().or(z.literal('')),
  bankAccount: z.string().optional().or(z.literal('')),
  bankIfsc: z.string().optional().or(z.literal('')),
  bankBranch: z.string().optional().or(z.literal('')),
  maxWorkers: z.number().int().positive().optional().default(10),
  maxMachines: z.number().int().positive().optional().default(5),
  hourlyRate: z.number().positive().optional(),
  dailyRate: z.number().positive().optional(),
  isVerified: z.boolean().optional().default(false),
});

// Update subcontractor validation
export const updateSubcontractorSchema = createSubcontractorSchema.partial();

// Verify subcontractor validation
export const verifySubcontractorSchema = z.object({
  isVerified: z.boolean(),
  verificationNotes: z.string().optional(),
});

// Blacklist subcontractor validation
export const blacklistSubcontractorSchema = z.object({
  blacklistReason: z
    .string()
    .min(5, 'Blacklist reason must be at least 5 characters'),
});

// Filter subcontractors validation
export const filterSubcontractorsSchema = z.object({
  search: z.string().optional(),
  type: z
    .enum(['LABOR', 'EQUIPMENT', 'MATERIAL_SUPPLY', 'TRANSPORTATION', 'OTHER'])
    .optional(),
  status: z
    .enum(['ACTIVE', 'INACTIVE', 'BLACKLISTED', 'UNDER_REVIEW'])
    .optional(),
  workType: z
    .enum([
      'CONCRETE',
      'STEEL',
      'CARPENTRY',
      'ELECTRICAL',
      'PLUMBING',
      'PAINTING',
      'TILING',
      'EXCAVATION',
      'DEMOLITION',
      'RENOVATION',
      'MAINTENANCE',
      'CLEANING',
      'LANDSCAPING',
      'OTHER',
    ])
    .optional(),
  verified: z.boolean().optional(),
  page: z.number().int().positive().optional().default(1),
  limit: z.number().int().positive().optional().default(10),
});

// Update contractor project validation
export const updateContractorProjectSchema = z
  .object({
    title: z.string().min(2, 'Title must be at least 2 characters').optional(),
    description: z.string().optional(),
    workType: z
      .enum([
        'CONCRETE',
        'STEEL',
        'CARPENTRY',
        'ELECTRICAL',
        'PLUMBING',
        'PAINTING',
        'TILING',
        'EXCAVATION',
        'DEMOLITION',
        'RENOVATION',
        'MAINTENANCE',
        'CLEANING',
        'LANDSCAPING',
        'OTHER',
      ])
      .optional(),
    scopeOfWork: z.string().optional(),
    terms: z.string().optional(),
    startDate: z
      .string()
      .refine((val) => !isNaN(Date.parse(val)), {
        message: 'Invalid date format',
      })
      .optional(),
    endDate: z
      .string()
      .refine((val) => !isNaN(Date.parse(val)), {
        message: 'Invalid date format',
      })
      .optional(),
    estimatedDuration: z.number().int().positive().optional(),
    contractAmount: z
      .number()
      .positive('Contract amount must be positive')
      .optional(),
    advanceAmount: z
      .number()
      .min(0, 'Advance amount cannot be negative')
      .optional(),
    retentionAmount: z
      .number()
      .min(0, 'Retention amount cannot be negative')
      .optional(),
    paymentTerms: z.string().optional(),
    status: z
      .enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'BLOCKED'])
      .optional(),
    progress: z.number().int().min(0).max(100).optional(),
    qualityRating: z.number().min(0).max(5).optional(),
    safetyRating: z.number().min(0).max(5).optional(),
    completionNotes: z.string().optional(),
  })
  .refine(
    (data) => {
      // Custom validation: Ensure end date is after start date if both provided
      if (data.startDate && data.endDate) {
        return new Date(data.endDate) > new Date(data.startDate);
      }
      return true;
    },
    {
      message: 'End date must be after start date',
      path: ['endDate'],
    }
  );

export const getWorkersForAttendanceSchema = z.object({
  contractorId: z.string().optional(),
  projectId: z.string().optional(),
});

// Validation for getting worker details
export const getWorkerDetailsSchema = z.object({
  workerId: z.string().min(1, 'Worker ID is required'),
});
// Add to src/validations/index.js
export * from './subcontractor.validations.js';
