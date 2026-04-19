import { z } from 'zod';

// Create material validation
export const createMaterialSchema = z.object({
  body: z.object({
    materialCode: z.string().optional(),
    name: z.string().min(1, 'Material name is required'),
    unit: z.string().min(1, 'Unit is required'),
    stockQuantity: z.coerce.number().optional(),
    minimumStock: z.coerce.number().optional(),
    unitPrice: z.coerce.number().nullable().optional(),
    supplier: z.string().optional(),
    supplierContact: z.string().optional(),
    projectId: z.string().optional(),
  }),
});

// Update material validation
export const updateMaterialSchema = z.object({
  body: z.object({
    materialCode: z.string().optional(),
    name: z.string().optional(),
    unit: z.string().optional(),
    stockQuantity: z.coerce.number().optional(),
    minimumStock: z.coerce.number().optional(),
    unitPrice: z.coerce.number().nullable().optional(),
    supplier: z.string().optional(),
    supplierContact: z.string().optional(),
    projectIds: z.array(z.string()).optional(),
  }),
  params: z.object({
    id: z.string().min(1, 'Material ID is required'),
  }),
});

// Adjust material stock validation
export const adjustMaterialStockSchema = z.object({
  body: z.object({
    adjustmentType: z.enum(['ADD', 'REMOVE'], {
      required_error: 'Adjustment type is required (ADD or REMOVE)',
    }),
    quantity: z.coerce.number().positive('Quantity must be greater than 0'),
    reason: z.string().optional(),
    projectId: z.string().optional(),
  }),
  params: z.object({
    id: z.string().min(1, 'Material ID is required'),
  }),
});

// Check material stock validation
export const checkMaterialStockSchema = z.object({
  body: z.object({
    materialId: z.string().min(1, 'Material ID is required'),
    projectId: z.string().optional(),
    quantity: z.coerce.number().positive(),
  }),
});

// Get material statistics validation
export const getMaterialStatisticsSchema = z.object({
  query: z.object({
    projectId: z.string().optional(),
  }),
});

// Get material consumption report validation
export const getMaterialConsumptionReportSchema = z.object({
  query: z.object({
    materialId: z.string().optional(),
    projectId: z.string().optional(),
    startDate: z.coerce.date().optional(), // Changed to coerce date for flexibility
    endDate: z.coerce.date().optional(),
  }),
});

// Create material request validation
export const createMaterialRequestSchema = z.object({
  body: z
    .object({
      projectId: z.string().min(1, 'Project ID is required'),
      materialId: z.string().optional(),
      materialName: z.string().min(1, 'Material name is required').optional(),
      quantity: z.coerce.number().positive('Quantity must be greater than 0'),
      unit: z.string().optional(),
      purpose: z.string().min(1, 'Purpose is required'),
      urgency: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
      expectedDelivery: z.coerce.date().optional(),
      supplier: z.string().optional(),
    })
    .superRefine((data, ctx) => {
      if (!data.materialId && !data.materialName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Either materialId or materialName must be provided',
          path: ['materialName'],
        });
      }
    }),
});

// Update request status validation
export const updateRequestStatusSchema = z.object({
  body: z.object({
    status: z.enum([
      'APPROVED',
      'REJECTED',
      'ORDERED',
      'IN_TRANSIT', // Replaced CANCELLED with IN_TRANSIT to match Prisma MaterialStatus Enum
      'DELIVERED',
      'RETURNED',
    ]),
    supplier: z.string().optional(),
    expectedDelivery: z.coerce.date().optional(),
    rejectionReason: z.string().optional(),
    notes: z.string().optional(),
  }),
  params: z.object({
    id: z.string().min(1, 'Request ID is required'),
  }),
});

// NEW: Get all material requests validation (to match your controller)
export const getAllMaterialRequestsSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    search: z.string().optional(),
    status: z.string().optional(), // Works perfectly for comma separated lists
    projectId: z.string().optional(),
    materialId: z.string().optional(),
    urgency: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    requestedById: z.string().optional(),
  }),
});

// Get material requests by project validation
export const getMaterialRequestsByProjectSchema = z.object({
  params: z.object({
    projectId: z.string().min(1, 'Project ID is required'),
  }),
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    status: z.string().optional(), // Works perfectly for comma separated lists
    materialId: z.string().optional(), // ADDED: Controller supports filtering by materialId
  }),
});

// Get material request statistics validation
export const getMaterialRequestStatisticsSchema = z.object({
  query: z.object({
    projectId: z.string().optional(),
    startDate: z.coerce.date().optional(), // Changed to coerce date
    endDate: z.coerce.date().optional(),
  }),
});

// Get material stock history validation
export const getMaterialStockHistorySchema = z.object({
  params: z.object({
    materialId: z.string().min(1, 'Material ID is required'),
  }),
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    startDate: z.coerce.date().optional(), // Changed to coerce date
    endDate: z.coerce.date().optional(),
  }),
});

// Get stock alerts validation
export const getStockAlertsSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    alertType: z.string().optional(),
    isResolved: z.string().optional(),
  }),
});

// Resolve alert validation
export const resolveAlertSchema = z.object({
  body: z.object({
    resolutionNotes: z.string().optional(),
  }),
  params: z.object({
    id: z.string().min(1, 'Alert ID is required'),
  }),
});
