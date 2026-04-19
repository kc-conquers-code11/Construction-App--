// src/routes/permission.routes.js
import express from 'express';
import {
  authenticate,
  requireCompanyAdmin,
} from '../middleware/auth.middleware.js';
import {
  getAllPermissions,
  getGroupedPermissions,
  getAvailablePermissions,
} from '../controllers/permission.controller.js';

const router = express.Router();

router.use(authenticate);

router.get('/', getAllPermissions);
router.get('/grouped', getGroupedPermissions);
router.get('/available', getAvailablePermissions);

export default router;
