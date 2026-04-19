// src/routes/company.routes.js
import express from 'express';
import {
  authenticate,
  requireSuperAdmin,
} from '../middleware/auth.middleware.js';
import { validate } from '../validations/index.js';
import {
  createCompanySchema,
  updateCompanySchema,
  addAdminSchema,
  updatePermissionsSchema,
  toggleStatusSchema,
} from '../validations/company.validations.js';
import {
  createCompanyWithAdmin,
  getAllCompanies,
  getCompanyById,
  updateCompany,
  toggleCompanyStatus,
  getCompanyAdmins,
  addCompanyAdmin,
  updateAdminPermissions,
  updateCompanyAdmin,
} from '../controllers/company.controller.js';

const router = express.Router();

// All routes require super admin authentication
router.use(authenticate);
router.get('/:id', getCompanyById);
router.use(requireSuperAdmin);

// Company management routes
router.post('/create', validate(createCompanySchema), createCompanyWithAdmin);
router.get('/', getAllCompanies);
router.put('/:id', validate(updateCompanySchema), updateCompany);
router.patch('/:id/status', validate(toggleStatusSchema), toggleCompanyStatus);

// Company admin management
router.get('/:companyId/admins', getCompanyAdmins);
router.post('/:companyId/admins', validate(addAdminSchema), addCompanyAdmin);
router.put('/:companyId/admins/:adminId', updateCompanyAdmin);
router.put(
  '/:companyId/admins/:adminId/permissions',
  validate(updatePermissionsSchema),
  updateAdminPermissions
);

export default router;
