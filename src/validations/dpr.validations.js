// src/validations/dpr.validations.js
import { z } from 'zod';

// Site visitor schema
const siteVisitorSchema = z.object({
  name: z.string().min(1, 'Visitor name is required'),
  company: z.string().optional().nullable(),
  purpose: z.string().optional().nullable(),
  timeIn: z.string().optional().nullable(),
  timeOut: z.string().optional().nullable(),
  contact: z.string().optional().nullable(),
});

// Equipment usage schema
const equipmentUsageSchema = z.object({
  equipmentId: z.string().uuid().optional().nullable(),
  name: z.string().min(1, 'Equipment name is required'),
  hours: z.number().min(0, 'Hours must be positive'),
  rate: z.number().min(0, 'Rate must be positive').optional().default(0),
  cost: z.number().min(0).optional(),
  operator: z.string().optional().nullable(),
});

// Subcontractor details schema
const subcontractorDetailsSchema = z
  .object({
    name: z.string().optional(),
    workDone: z.string().optional(),
    workers: z.number().int().min(0).optional(),
    amount: z.number().min(0).optional(),
  })
  .default({});

// Next day planning schema
const nextDayPlanningSchema = z
  .object({
    description: z.string().optional(),
    workers: z.number().int().min(0).optional(),
    materials: z
      .array(
        z.object({
          name: z.string(),
          quantity: z.number().min(0),
          unit: z.string().optional(),
        })
      )
      .optional()
      .default([]),
    equipment: z
      .array(
        z.object({
          name: z.string(),
          quantity: z.number().min(0),
          hours: z.number().min(0).optional(),
        })
      )
      .optional()
      .default([]),
  })
  .default({});

// Material consumption schema
const materialConsumptionSchema = z.object({
  materialId: z.string().uuid('Invalid material ID'),
  quantity: z.number().min(0.01, 'Quantity must be greater than 0'),
  unit: z.string().optional(),
  remarks: z.string().optional().nullable(),
});

// Create DPR validation (REMOVED OUTER 'body' WRAPPER)
export const createDPRSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  date: z.string().min(1, 'Date is required'),
  weather: z.string().optional().nullable(),
  temperature: z.string().optional().nullable(),
  humidity: z.string().optional().nullable(),
  workDescription: z.string().min(1, 'Work description is required'),
  completedWork: z.string().min(1, 'Completed work description is required'),
  pendingWork: z.string().optional().nullable(),
  challenges: z.string().optional().nullable(),
  totalWorkers: z
    .union([z.string(), z.number()])
    .transform((val) => (val ? parseInt(val.toString()) : 0))
    .optional(),
  supervisorPresent: z
    .union([z.string(), z.boolean()])
    .transform((val) => val === 'true' || val === true)
    .optional(),
  equipmentUsed: z.string().optional().nullable(),
  materialsUsed: z.string().optional().nullable(),
  materialsReceived: z.string().optional().nullable(),
  materialsRequired: z.string().optional().nullable(),
  safetyObservations: z.string().optional().nullable(),
  incidents: z.string().optional().nullable(),
  qualityChecks: z.string().optional().nullable(),
  issuesFound: z.string().optional().nullable(),
  nextDayPlan: z.string().optional().nullable(),

  // NEW FIELDS
  siteVisitors: z.array(siteVisitorSchema).optional().default([]),
  equipmentUsage: z.array(equipmentUsageSchema).optional().default([]),
  subcontractorDetails: subcontractorDetailsSchema,
  nextDayPlanning: nextDayPlanningSchema,
  materialsConsumed: z
    .array(materialConsumptionSchema)
    .optional()
    .default([]),
  photos: z.array(z.string()).optional().default([]),
  documents: z.array(z.string()).optional().default([]),
});

// Update DPR validation (REMOVED OUTER BODY WRAPPER)
export const updateDPRSchema = z.object({
  // We usually don't validate params in the body schema, check your validation middleware
  // If your middleware expects an object with body/params/query, you might need a different approach.
  // Assuming your middleware validates req.body against this schema:
  date: z.string().optional(),
  weather: z.string().optional().nullable(),
  temperature: z.string().optional().nullable(),
  humidity: z.string().optional().nullable(),
  workDescription: z.string().optional(),
  completedWork: z.string().optional(),
  pendingWork: z.string().optional().nullable(),
  challenges: z.string().optional().nullable(),
  totalWorkers: z
    .union([z.string(), z.number()])
    .transform((val) => (val ? parseInt(val.toString()) : undefined))
    .optional(),
  supervisorPresent: z
    .union([z.string(), z.boolean()])
    .transform((val) => val === 'true' || val === true)
    .optional(),
  equipmentUsed: z.string().optional().nullable(),
  materialsUsed: z.string().optional().nullable(),
  materialsReceived: z.string().optional().nullable(),
  materialsRequired: z.string().optional().nullable(),
  safetyObservations: z.string().optional().nullable(),
  incidents: z.string().optional().nullable(),
  qualityChecks: z.string().optional().nullable(),
  issuesFound: z.string().optional().nullable(),
  nextDayPlan: z.string().optional().nullable(),

  // NEW FIELDS
  siteVisitors: z.array(siteVisitorSchema).optional(),
  equipmentUsage: z.array(equipmentUsageSchema).optional(),
  subcontractorDetails: subcontractorDetailsSchema.optional(),
  nextDayPlanning: nextDayPlanningSchema.optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'COMPLETED']).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update',
});

// Approve DPR validation
export const approveDPRSchema = z.object({
  status: z.enum(['COMPLETED', 'REVIEW', 'TODO', 'IN_PROGRESS']),
  comments: z.string().optional().nullable(),
});

// Add material consumption validation (UPDATED)
export const addMaterialConsumptionSchema = z.object({
  materialId: z.string().min(1, 'Material ID is required'),
  quantity: z
    .union([z.string(), z.number()])
    .transform((val) => parseFloat(val.toString())),
  unit: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
});

// Get DPR statistics validation (Leaves Query intact if your middleware supports it, but usually you just validate the query object directly)
// Assuming your middleware handles query validation separately
export const getDPRStatisticsSchema = z.object({
  projectId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

// Get DPRs by project validation
export const getDPRsByProjectSchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

// Consume material from DPR validation
export const consumeMaterialFromDPRSchema = z.object({
  dprId: z.string().min(1, 'DPR ID is required'),
  materialId: z.string().min(1, 'Material ID is required'),
  quantity: z
    .union([z.string(), z.number()])
    .transform((val) => parseFloat(val.toString())),
  unit: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
});

// Upload DPR photo validation
export const uploadDPRPhotoSchema = z.object({
  dprId: z.string().min(1, 'DPR ID is required'),
  title: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

// Update DPR photo details validation
export const updateDPRPhotoDetailsSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});