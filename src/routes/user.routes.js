// src/routes/user.routes.js
import express from 'express';
import {
  authenticate,
  requireCompanyAdmin,
} from '../middleware/auth.middleware.js';
import { validate } from '../validations/index.js';
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  statusSchema,
  roleAssignmentSchema,
  passwordResetSchema,
  welcomeEmailSchema,
} from '../validations/user.validations.js';
import {
  createEmployee,
  getAllEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
  updateEmployeeRole,
  resetEmployeePassword,
  toggleEmployeeStatus,
  sendWelcomeToEmployee, // Updated import
  getEmployeeDashboard,
  getEmployeeProjects,
} from '../controllers/user.controller.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Employee management routes (Company Admin only)
router.post(
  '/',
  requireCompanyAdmin,
  validate(createEmployeeSchema),
  createEmployee
);
router.get('/', getAllEmployees);
router.get('/:id', getEmployeeById);
router.put('/:id', validate(updateEmployeeSchema), updateEmployee);
router.delete('/:id', requireCompanyAdmin, deleteEmployee);

// Employee status management
router.patch(
  '/:id/status',
  requireCompanyAdmin,
  validate(statusSchema),
  toggleEmployeeStatus
);
router.patch(
  '/:id/role',
  requireCompanyAdmin,
  validate(roleAssignmentSchema),
  updateEmployeeRole
);
router.post(
  '/:id/reset-password',
  requireCompanyAdmin,
  validate(passwordResetSchema),
  resetEmployeePassword
);
router.post(
  '/:id/send-welcome',
  requireCompanyAdmin,
  validate(welcomeEmailSchema),
  sendWelcomeToEmployee
); // Updated function name

// Employee self-management
router.get('/dashboard/me', getEmployeeDashboard);

// In your user routes file
router.get('/:id/projects', getEmployeeProjects);

export default router;
