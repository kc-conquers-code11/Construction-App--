import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../validations/index.js';
import {
  createMaterialRequestSchema,
  updateRequestStatusSchema,
  getMaterialRequestsByProjectSchema,
  getMaterialRequestStatisticsSchema,
} from '../validations/material.validations.js';
import {
  createMaterialRequest,
  getAllMaterialRequests,
  getMaterialRequestById,
  updateMaterialRequestStatus,
  deleteMaterialRequest,
  getMaterialRequestStatistics,
  getMaterialRequestsByProject,
  checkMaterialStock,
  consumeMaterialFromDPR,
  fulfillRequestFromStock,
} from '../controllers/materialRequest.controller.js';

const router = express.Router();

router.use(authenticate);

// 1. Checks & Calculations
router.post('/check-stock', checkMaterialStock); // Check availability before ordering

// 2. Core CRUD
// router.post('/', validate(createMaterialRequestSchema), createMaterialRequest);
router.post('/', createMaterialRequest);
router.get('/', getAllMaterialRequests);
router.get('/:id', getMaterialRequestById);
router.patch(
  '/:id/status',
  validate(updateRequestStatusSchema),
  updateMaterialRequestStatus
);
router.delete('/:id', deleteMaterialRequest);

// 3. Project Specific
router.get(
  '/project/:projectId',
  validate(getMaterialRequestsByProjectSchema),
  getMaterialRequestsByProject
);

// 4. Statistics
router.get(
  '/stats/general', // Changed path to avoid conflict with /:id
  validate(getMaterialRequestStatisticsSchema),
  getMaterialRequestStatistics
);

// 5. Consumption & Fulfillment (New)
router.post('/consume', consumeMaterialFromDPR); // Used by DPR module
router.post('/fulfill-transfer', fulfillRequestFromStock); // Create Transfer from Request

export default router;
