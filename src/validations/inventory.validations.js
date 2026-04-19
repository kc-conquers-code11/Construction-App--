import { z } from 'zod';

// ==========================================
// Material Master Validations
// ==========================================

export const createMaterialSchema = z.object({
  name: z.string().min(1, 'Material name is required'),
  unit: z
    .string()
    .min(1, 'Unit of measurement is required (e.g., kg, liters, nos)'),
  materialCode: z.string().optional(),

  // Default Global Settings
  minimumStock: z.number().nonnegative().optional().default(0),
  unitPrice: z.number().nonnegative().optional(), // Standard/Market rate

  // Supplier Info
  supplier: z.string().optional(),
  supplierContact: z.string().optional(),
});

export const updateMaterialSchema = createMaterialSchema.partial();

// ==========================================
// Global / Retention Inventory Validations
// ==========================================

export const addStockSchema = z.object({
  materialId: z.string().min(1, 'Material ID is required'),
  quantity: z.number().positive('Quantity must be greater than 0'),
  unitPrice: z.number().nonnegative('Unit price cannot be negative'),

  // Optional details for the batch
  batchNumber: z.string().optional(),
  supplier: z.string().optional(),
  billNumber: z.string().optional(),
  purchaseDate: z.string().datetime({ offset: true }).optional().or(z.string()), // Accept ISO string
  expiryDate: z.string().datetime({ offset: true }).optional().or(z.string()),
  notes: z.string().max(500).optional(),
});

// NEW: Bulk Stock Schema
export const addBulkStockSchema = z.object({
  items: z
    .array(
      z.object({
        materialId: z.string().min(1, 'Material ID is required'),
        quantity: z.number().positive('Quantity must be greater than 0'),
        unitPrice: z.number().nonnegative('Unit price cannot be negative'),
        batchNumber: z.string().optional(),
        supplier: z.string().optional(),
        purchaseDate: z
          .string()
          .datetime({ offset: true })
          .optional()
          .or(z.string()),
        expiryDate: z
          .string()
          .datetime({ offset: true })
          .optional()
          .or(z.string()),
        notes: z.string().max(500).optional(),
      })
    )
    .min(1, 'At least one item is required'),
});

// ==========================================
// Project Inventory Validations
// ==========================================

export const addMaterialToProjectSchema = z
  .object({
    materialId: z.string().min(1, 'Material ID is required'),
    budgetCategoryId: z.string().optional(), // Link to budget line item

    // Optional Opening Stock for Project
    initialQuantity: z.number().nonnegative().optional().default(0),
    unitPrice: z.number().nonnegative().optional(), // Required if initialQuantity > 0

    // Batch details if stock is added
    batchNumber: z.string().optional(),
    purchaseDate: z
      .string()
      .datetime({ offset: true })
      .optional()
      .or(z.string()),
    expiryDate: z.string().datetime({ offset: true }).optional().or(z.string()),
    notes: z.string().max(500).optional(),
  })
  .refine(
    (data) => {
      if (data.initialQuantity > 0 && data.unitPrice === undefined) {
        return false;
      }
      return true;
    },
    {
      message: 'Unit price is required when adding initial quantity',
      path: ['unitPrice'],
    }
  );

export const addBulkMaterialsToProjectSchema = z.object({
  items: z
    .array(addMaterialToProjectSchema)
    .min(1, 'At least one item is required'),
});

// ==========================================
// Transfer Validations
// ==========================================

const transferItemSchema = z
  .object({
    itemType: z.enum(['MATERIAL', 'EQUIPMENT']),

    // If MATERIAL
    materialId: z.string().optional(),
    quantity: z.number().positive().optional(),

    // If EQUIPMENT
    equipmentId: z.string().optional(),

    // Contextual overrides (optional)
    notes: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.itemType === 'MATERIAL') {
        return !!data.materialId && !!data.quantity;
      }
      if (data.itemType === 'EQUIPMENT') {
        return !!data.equipmentId;
      }
      return false;
    },
    {
      message:
        "Material transfers require 'materialId' and 'quantity'. Equipment transfers require 'equipmentId'.",
    }
  );

export const createTransferSchema = z
  .object({
    // Locations
    fromLocation: z.enum(['GLOBAL', 'PROJECT']),
    fromProjectId: z.string().optional(), // Required if fromLocation is PROJECT

    toLocation: z.enum(['GLOBAL', 'PROJECT']),
    toProjectId: z.string().optional(), // Required if toLocation is PROJECT

    transferDate: z
      .string()
      .datetime({ offset: true })
      .optional()
      .or(z.string()),
    description: z.string().max(500).optional(),

    items: z
      .array(transferItemSchema)
      .min(1, 'At least one item is required for transfer'),
  })
  .refine(
    (data) => {
      if (data.fromLocation === 'PROJECT' && !data.fromProjectId) return false;
      if (data.toLocation === 'PROJECT' && !data.toProjectId) return false;
      return true;
    },
    {
      message: "Project ID is required when location is 'PROJECT'",
      path: ['fromProjectId', 'toProjectId'], // Attach error to fields
    }
  );

export const updateTransferStatusSchema = z.object({
  status: z.enum(['COMPLETED', 'CANCELLED', 'REJECTED']),
  notes: z.string().max(500).optional(),
  rejectionReason: z.string().optional(),
});

// ==========================================
// Equipment Validations
// ==========================================

export const createEquipmentSchema = z.object({
  // Identity
  name: z.string().min(1, 'Equipment name is required'),
  code: z.string().optional(), // Asset Tag
  type: z.string().min(1, 'Equipment type is required'), // Excavator, Crane, etc.
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  registrationNumber: z.string().optional(),

  // Financial
  ownershipType: z.enum(['OWNED', 'RENTED']),

  // Rented Logic
  rentalProvider: z.string().optional(),
  rentalRate: z.number().nonnegative().optional(),
  rentalUnit: z.enum(['HOUR', 'DAY', 'MONTH']).optional(),

  // Owned Logic
  purchaseDate: z.string().datetime({ offset: true }).optional().or(z.string()),
  purchaseCost: z.number().nonnegative().optional(),
  fuelType: z
    .enum(['DIESEL', 'PETROL', 'ELECTRIC', 'HYBRID', 'CNG', 'LPG', 'OTHER'])
    .optional(),
  fuelConsumption: z.number().nonnegative().optional(), // Liters per Hour

  // Info
  manufacturer: z.string().optional(),
  year: z
    .number()
    .int()
    .min(1900)
    .max(new Date().getFullYear() + 1)
    .optional(),
  condition: z.string().optional(),

  // Dates
  lastServiceDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .or(z.string()),
  nextServiceDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .or(z.string()),
});

export const updateEquipmentSchema = createEquipmentSchema.partial().extend({
  status: z
    .enum(['AVAILABLE', 'IN_USE', 'MAINTENANCE', 'REPAIR', 'DECOMMISSIONED'])
    .optional(),
});

export const assignEquipmentSchema = z.object({
  projectId: z.string().min(1, 'Target Project ID is required'),
  assignedDate: z.string().datetime({ offset: true }).optional().or(z.string()),

  // Cost Overrides for this specific assignment
  assignedRate: z.number().nonnegative().optional(), // Override rental rate
  assignedFuelCost: z.number().nonnegative().optional(), // Override fuel rate/cost

  notes: z.string().max(500).optional(),
});
