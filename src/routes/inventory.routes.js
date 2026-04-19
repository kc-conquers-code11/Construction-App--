import express from 'express';
import { validate } from '../validations/index.js';
import {
  // Global / Retention Inventory Controllers
  getGlobalInventory,
  addOpeningStockToRetention,
  addBulkOpeningStockToRetention,

  // Project Inventory Controllers
  getProjectInventory,
  getProjectMaterialBatches,
  addMaterialToProject,
  removeMaterialFromProject,

  // Equipment Controllers
  createEquipment,
  updateEquipment,
  deleteEquipment,
  getAllEquipment,
  getEquipmentById,
  assignEquipmentToProject,
  releaseEquipmentFromProject,

  // Transfer Controllers
  createInventoryTransfer,
  getInventoryTransfers,
  updateTransferStatus,

  // Material Master Controllers (NEW)
  createMaterial,
  getAllMaterials,
  getMaterialById,
  updateMaterial,
  deleteMaterial,
  addBulkMaterialsToProject,
  // Report Controllers (NEW)
  getInventoryValuationReport,
  getLowStockReport,
  getStockMovementReport,
  getMaterialConsumptionReport,
} from '../controllers/inventory.controller.js';

import {
  // Validation Schemas
  addStockSchema,
  addBulkStockSchema,
  createEquipmentSchema,
  updateEquipmentSchema,
  assignEquipmentSchema,
  createTransferSchema,
  updateTransferStatusSchema,
  addMaterialToProjectSchema,

  // Material Validation Schemas (NEW)
  createMaterialSchema,
  updateMaterialSchema,
  addBulkMaterialsToProjectSchema,
} from '../validations/inventory.validations.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(authenticate);

/**
 * @route   GET /api/inventory/reports/valuation
 * @desc    Get total value of inventory across all locations
 */
router.get('/reports/valuation', getInventoryValuationReport);

/**
 * @route   GET /api/inventory/reports/low-stock
 * @desc    Get list of materials below global minimum threshold
 */
router.get('/reports/low-stock', getLowStockReport);

/**
 * @route   GET /api/inventory/reports/movement
 * @desc    Get transaction history (Opening stock, transfers, etc.)
 */
router.get('/reports/movement', getStockMovementReport);

/**
 * @route   GET /api/inventory/reports/consumption
 * @desc    Get aggregated material consumption by project
 */
router.get('/reports/consumption', getMaterialConsumptionReport);

// ==============================================================================
// 0. MATERIAL MASTER MANAGEMENT (Definitions)
//    (Define what materials exist in the system)
// ==============================================================================

router.post('/materials', validate(createMaterialSchema), createMaterial);

router.get('/materials', getAllMaterials);

router.get('/materials/:id', getMaterialById);

router.patch('/materials/:id', validate(updateMaterialSchema), updateMaterial);

router.delete('/materials/:id', deleteMaterial);

// ==============================================================================
// 1. GLOBAL / RETENTION INVENTORY
//    (Manage the company's central warehouse/stock)
// ==============================================================================

/**
 * @route   GET /api/inventory/global
 * @desc    Get all materials currently in Company Retention (Global Inventory)
 * Returns weighted average rates and total values.
 */
router.get('/global', getGlobalInventory);

/**
 * @route   POST /api/inventory/global/add-stock
 * @desc    Manually add materials to Retention (e.g., Opening Stock or Direct Purchase without PO)
 * Creates a MaterialBatch and updates Inventory record.
 */
router.post(
  '/global/add-stock',
  validate(addStockSchema),
  addOpeningStockToRetention
);

/**
 * @route   POST /api/inventory/global/add-stock/bulk
 * @desc    Manually add materials to Retention (Bulk Items)
 * Transactional: Adds multiple batches at once.
 */
router.post(
  '/global/add-stock/bulk',
  validate(addBulkStockSchema),
  addBulkOpeningStockToRetention
);

// ==============================================================================
// 2. PROJECT INVENTORY & BATCH MANAGEMENT
//    (View stock at specific sites and manage rate variations)
// ==============================================================================

/**
 * @route   GET /api/inventory/project/:projectId
 * @desc    Get aggregate inventory for a specific project.
 * Shows total quantity available and average valuation on site.
 */
router.get('/project/:projectId', getProjectInventory);

/**
 * @route   POST /api/inventory/project/:projectId/materials
 * @desc    Add a material to the project's inventory list.
 * Effectively initializes the Inventory record for this site with 0 stock
 * so it appears in reports and can be selected for transfers/requests.
 */
router.post(
  '/project/:projectId/materials',
  validate(addMaterialToProjectSchema),
  addMaterialToProject
);

/**
 * @route   POST /api/inventory/project/:projectId/materials/bulk
 * @desc    Add multiple materials to project (Optionally with Opening Stock)
 */
router.post(
  '/project/:projectId/materials/bulk',
  validate(addBulkMaterialsToProjectSchema),
  addBulkMaterialsToProject
);

/**
 * @route   DELETE /api/inventory/project/:projectId/materials/:materialId
 * @desc    Remove a material from the project list.
 * Only permitted if stock is 0 and no transaction history exists for this project.
 */
router.delete(
  '/project/:projectId/materials/:materialId',
  removeMaterialFromProject
);

/**
 * @route   GET /api/inventory/project/:projectId/material/:materialId/batches
 * @desc    View distinct batches for a material on a project.
 * This handles the "different rates on different dates" requirement.
 * Shows exactly which PO or Transfer brought which stock at what rate.
 */
router.get(
  '/project/:projectId/material/:materialId/batches',
  getProjectMaterialBatches
);

// Note: Adding materials via Purchase Order is handled via the Goods Receipt (GRN) module
// normally, but querying the result happens here.

// ==============================================================================
// 3. INVENTORY TRANSFERS
//    (Move items: Retention -> Project OR Project -> Retention)
// ==============================================================================

/**
 * @route   POST /api/inventory/transfers
 * @desc    Initiate a transfer.
 * Since Admin performs this, status defaults to 'IN_TRANSIT' (or 'COMPLETED' if immediate).
 * No separate approval step is required.
 */
router.post(
  '/transfers',
  validate(createTransferSchema),
  createInventoryTransfer
);

/**
 * @route   GET /api/inventory/transfers
 * @desc    Get transfer history with filters (fromProject, toProject, status, date range)
 */
router.get('/transfers', getInventoryTransfers);

/**
 * @route   PATCH /api/inventory/transfers/:id/status
 * @desc    Mark transfer as COMPLETED (Received at destination) or CANCELLED.
 * Used to acknowledge receipt of goods. Approval/Rejection workflow is skipped.
 */
router.patch(
  '/transfers/:id/status',
  validate(updateTransferStatusSchema),
  updateTransferStatus
);

// ==============================================================================
// 4. EQUIPMENT MANAGEMENT & ASSIGNMENT
//    (Owned vs Rented, Rate Calculations, Assignments)
// ==============================================================================

/**
 * @route   GET /api/inventory/equipment
 * @desc    Get all equipment (Global list).
 * Supports filtering by status (AVAILABLE, IN_USE) and ownership (OWNED, RENTED).
 */
router.get('/equipment', getAllEquipment);

/**
 * @route   GET /api/inventory/equipment/:id
 * @desc    Get specific equipment details and history.
 */
router.get('/equipment/:id', getEquipmentById);

/**
 * @route   POST /api/inventory/equipment
 * @desc    Add new equipment to the fleet (Retention Inventory).
 * Payload includes:
 * - ownershipType: "OWNED" | "RENTED"
 * - If RENTED: default rentalRate
 * - If OWNED: fuelType, default fuelConsumption
 */
router.post('/equipment', validate(createEquipmentSchema), createEquipment);

/**
 * @route   PATCH /api/inventory/equipment/:id
 * @desc    Update equipment basic details (Maintenance status, basic info).
 */
router.patch(
  '/equipment/:id',
  validate(updateEquipmentSchema),
  updateEquipment
);

/**
 * @route   DELETE /api/inventory/equipment/:id
 * @desc    Delete equipment record.
 * Only permitted if equipment is not currently assigned/in-use.
 */
router.delete('/equipment/:id', deleteEquipment);

/**
 * @route   POST /api/inventory/equipment/:id/assign
 * @desc    Assign equipment to a Project.
 * CRITICAL: This allows overriding costs for this specific assignment.
 * Payload:
 * - projectId: Destination
 * - assignedRate: (Optional) Override rental rate for this specific project.
 * - assignedFuelCost: (Optional) Override fuel cost for this specific project.
 * * Logic: Updates Equipment.location to PROJECT and creates an InventoryTransfer record.
 */
router.post(
  '/equipment/:id/assign',
  validate(assignEquipmentSchema),
  assignEquipmentToProject
);

/**
 * @route   POST /api/inventory/equipment/:id/release
 * @desc    Release equipment from a Project back to Retention.
 * Logic: Updates Equipment.location to GLOBAL and Equipment.status to AVAILABLE.
 */
router.post('/equipment/:id/release', releaseEquipmentFromProject);

export default router;
