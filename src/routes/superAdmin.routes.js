// src/routes/superAdmin.routes.js
import { Router } from 'express';
import {
  getSuperAdminProfile,
  updateSuperAdminProfile,
  getDashboardStats,
  getRecentActivities,
  getDashboardData,
  getAllCompanies,
  getCompanyDetails,
  updateCompanyStatus,
  deleteCompany,
  getCompanyAdmins,
  createCompanyAdmin,
  updateAdminPermissions,
  toggleAdminStatus,
  deleteAdmin
} from '../controllers/superAdmin.controller.js';

import {
  authenticate,
  requireSuperAdmin,
} from '../middleware/auth.middleware.js';

import { validate } from '../validations/index.js';
import {
  updateSuperAdminProfileSchema,
  dashboardQuerySchema,
  companyFilterSchema,
  updateCompanyStatusSchema,
  createCompanyAdminSchema,
  updateAdminPermissionsSchema,
  adminFilterSchema,
} from '../validations/superAdmin.validations.js';

const router = Router();

/**
 * ====================================
 * SUPER ADMIN DASHBOARD ROUTES
 * ====================================
 */

// Get complete dashboard data (stats + activities)
router.get(
  '/dashboard',
  authenticate,
  requireSuperAdmin,
  getDashboardData
);

// Get only dashboard statistics
router.get(
  '/dashboard/stats',
  authenticate,
  requireSuperAdmin,
  getDashboardStats
);

// Get only recent activities
router.get(
  '/dashboard/recent-activities',
  authenticate,
  requireSuperAdmin,
  getRecentActivities
);

/**
 * ====================================
 * SUPER ADMIN PROFILE ROUTES
 * ====================================
 */
router.get('/profile', authenticate, requireSuperAdmin, getSuperAdminProfile);

router.patch(
  '/profile',
  authenticate,
  requireSuperAdmin,
  validate(updateSuperAdminProfileSchema),
  updateSuperAdminProfile
);

/**
 * ====================================
 * COMPANY MANAGEMENT ROUTES
 * ====================================
 */

// Get all companies with filters
router.get(
  '/companies',
  authenticate,
  requireSuperAdmin,
  validate(companyFilterSchema),
  getAllCompanies  
);

// Get single company details
router.get(
  '/companies/:companyId',
  authenticate,
  requireSuperAdmin,
  getCompanyDetails  
);

// Update company status (activate/suspend)
router.patch(
  '/companies/:companyId/status',
  authenticate,
  requireSuperAdmin,
  validate(updateCompanyStatusSchema),
  updateCompanyStatus  
);

// Delete company
router.delete(
  '/companies/:companyId',
  authenticate,
  requireSuperAdmin,
  deleteCompany  
);

/**
 * ====================================
 * COMPANY ADMIN MANAGEMENT ROUTES
 * ====================================
 */

// Get all admins of a company
router.get(
  '/companies/:companyId/admins',
  authenticate,
  requireSuperAdmin,
  validate(adminFilterSchema),
  getCompanyAdmins  
);

// Create company admin
router.post(
  '/companies/:companyId/admins',
  authenticate,
  requireSuperAdmin,
  validate(createCompanyAdminSchema),
  createCompanyAdmin  
);

// Update admin permissions
router.patch(
  '/companies/:companyId/admins/:adminId/permissions',
  authenticate,
  requireSuperAdmin,
  validate(updateAdminPermissionsSchema),
  updateAdminPermissions  
);

// Toggle admin status (activate/deactivate)
router.patch(
  '/companies/:companyId/admins/:adminId/status',
  authenticate,
  requireSuperAdmin,
  toggleAdminStatus  
);

// Delete admin
router.delete(
  '/companies/:companyId/admins/:adminId',
  authenticate,
  requireSuperAdmin,
  deleteAdmin  
);

export default router;