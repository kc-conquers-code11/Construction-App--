import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../validations/index.js';
import {
  createDPRSchema,
  updateDPRSchema,
  approveDPRSchema,
  addMaterialConsumptionSchema,
  getDPRStatisticsSchema,
  getDPRsByProjectSchema,
  consumeMaterialFromDPRSchema,
} from '../validations/dpr.validations.js';
import {
  createDPR,
  getAllDPRs,
  getDPRById,
  updateDPR,
  deleteDPR,
  approveDPR,
  getDPRStatistics,
  getDPRsByProject,
  addMaterialConsumption,
  getDPRMaterialConsumptions,
  getMaterialConsumptionByDPR,
  consumeMaterialFromDPR,
} from '../controllers/dpr.controller.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// DPR routes
router.post('/', validate(createDPRSchema), createDPR);
router.get('/', getAllDPRs);
router.get('/statistics', validate(getDPRStatisticsSchema), getDPRStatistics);
router.get(
  '/project/:projectId',
  validate(getDPRsByProjectSchema),
  getDPRsByProject
);
router.get('/:id', getDPRById);
router.put('/:id', validate(updateDPRSchema), updateDPR);
router.delete('/:id', deleteDPR);
router.patch('/:id/approve', validate(approveDPRSchema), approveDPR);

// Material consumption in DPR
router.post(
  '/:dprId/consume-material',
  validate(addMaterialConsumptionSchema),
  addMaterialConsumption
);
router.get('/:dprId/material-consumptions', getDPRMaterialConsumptions);
router.get('/:dprId/material-consumption-report', getMaterialConsumptionByDPR);

// Direct material consumption endpoint
router.post(
  '/consume/material',
  validate(consumeMaterialFromDPRSchema),
  consumeMaterialFromDPR
);

export default router;
