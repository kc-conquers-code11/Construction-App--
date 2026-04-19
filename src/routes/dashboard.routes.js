// src/routes/dashboard.routes.js
import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import {
  getAdminDashboard,
  getDashboardSummary,
  getTransactionStats,
  getInventoryStats,
  getApprovalsStats,
  getProjectsStats,
  getAllRecentActivities,
  getRecentTasks,
  getRecentDPRs,
  getRecentCheckIns,
  getRecentTransactions,
  getRecentMaterialRequests,
  getTransactionTrends,
  getProjectDistribution,
  getApprovalCategories,
  getMyPendingApprovals,
  getMyRecentActivities,
  getAllCompaniesDashboard,
  getCompanyPerformance,
} from '../controllers/dashboard.controller.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

router.get('/', getAdminDashboard);

router.get('/summary', getDashboardSummary);

router.get('/stats/transactions', getTransactionStats);

router.get('/stats/inventory', getInventoryStats);

router.get('/stats/approvals', getApprovalsStats);

router.get('/stats/projects', getProjectsStats);

router.get('/activities', getAllRecentActivities);

router.get('/activities/tasks', getRecentTasks);

router.get('/activities/dprs', getRecentDPRs);

router.get('/activities/checkins', getRecentCheckIns);

router.get('/activities/transactions', getRecentTransactions);

router.get('/activities/material-requests', getRecentMaterialRequests);

router.get('/charts/transactions/trends', getTransactionTrends);

router.get('/charts/projects/distribution', getProjectDistribution);

router.get('/charts/approvals/categories', getApprovalCategories);

router.get('/my-approvals', getMyPendingApprovals);

router.get('/my-activities', getMyRecentActivities);

router.get('/admin/all-companies', getAllCompaniesDashboard);

router.get('/admin/company-performance', getCompanyPerformance);

export default router;
