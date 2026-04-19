import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../validations/index.js';
import {
  createMaterialSchema,
  updateMaterialSchema,
  adjustMaterialStockSchema,
  checkMaterialStockSchema,
  getMaterialStatisticsSchema,
  getMaterialConsumptionReportSchema,
} from '../validations/material.validations.js';
import {
  createMaterial,
  getAllMaterials,
  getMaterialById,
  updateMaterial,
  deleteMaterial,
  adjustMaterialStock,
  checkMaterialStock,
  getMaterialStatistics,
  getMaterialConsumptionReport,
} from '../controllers/material.controller.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Material routes
router.post('/', validate(createMaterialSchema), createMaterial);
router.get('/', getAllMaterials);
router.get(
  '/statistics',
  validate(getMaterialStatisticsSchema),
  getMaterialStatistics
);
router.get(
  '/consumption-report',
  validate(getMaterialConsumptionReportSchema),
  getMaterialConsumptionReport
);
router.post(
  '/check-stock',
  validate(checkMaterialStockSchema),
  checkMaterialStock
);
router.post(
  '/:id/adjust-stock',
  validate(adjustMaterialStockSchema),
  adjustMaterialStock
);
router.get('/:id', getMaterialById);
router.put('/:id', validate(updateMaterialSchema), updateMaterial);
router.delete('/:id', deleteMaterial);

export default router;
