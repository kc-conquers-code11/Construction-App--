// src/routes/role.routes.js
import express from 'express';
import {
  authenticate,
  requireCompanyAdmin,
} from '../middleware/auth.middleware.js';
import { validate } from '../validations/index.js'; // Updated import
import {
  createRoleSchema,
  updateRoleSchema,
  updatePermissionsSchema,
} from '../validations/user.validations.js';
import {
  createRole,
  getAllRoles,
  getRoleById,
  updateRole,
  deleteRole,
  updateRolePermissions,
  getRolePermissions,
} from '../controllers/role.controller.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Role management (Company Admin only)
router.post('/', requireCompanyAdmin, validate(createRoleSchema), createRole);
router.get('/', getAllRoles);
router.get('/:id', getRoleById);
router.put('/:id', requireCompanyAdmin, validate(updateRoleSchema), updateRole);
router.delete('/:id', requireCompanyAdmin, deleteRole);

// Permission management
router.get('/:id/permissions', getRolePermissions);
router.put(
  '/:id/permissions',
  requireCompanyAdmin,
  validate(updatePermissionsSchema),
  updateRolePermissions
);

export default router;
