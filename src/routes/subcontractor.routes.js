import express from 'express';
import { authenticate, companyContext } from '../middleware/auth.middleware.js';
import { validate } from '../validations/index.js';
import {
  createSubcontractorSchema,
  updateSubcontractorSchema,
  verifySubcontractorSchema,
  blacklistSubcontractorSchema,
  filterSubcontractorsSchema,
  updateContractorProjectSchema,
} from '../validations/subcontractor.validations.js';
import {
  createSubcontractor,
  getAllSubcontractors,
  getSubcontractorById,
  updateSubcontractor,
  deleteSubcontractor,
  verifySubcontractor,
  blacklistSubcontractor,
  unblacklistSubcontractor,
  getSubcontractorStatistics,
  getSubcontractorsByWorkType,
  addSubcontractorWorker, // Changed from addContractorWorker
  getSubcontractorWorkers, // Changed from getContractorWorkers
  getSubcontractorWorkersByProjectId,
  createContractorProject,
  getContractorProjectsByContractorId,
  getContractorProjectsByProjectId,
  getContractorProjectById,
  createWorkAssignment,
  getContractorAssignments,
  getAssignmentById,
  verifyWorkCompletion,
  createContractorPayment,
  approveContractorPayment,
  processContractorPayment,
  getContractorPayments,
  createContractorReview,
  approveContractorReview,
  getAllProjectsWithSubcontractors,
  getSubcontractorDashboardStats,
  deleteContractorProjectById,
  updateContractorProjectById,
  getSubcontractorWorkersForAttendance,
  getSubcontractorWorkerDetails,
} from '../controllers/subcontractor.controller.js';

const router = express.Router();

// Apply authentication and company context middleware to all routes
router.use(authenticate, companyContext);

// Dashboard route
router.get('/dashboard/stats', getSubcontractorDashboardStats);

// Main subcontractor management routes
router.post('/', validate(createSubcontractorSchema), createSubcontractor);
router.get('/', getAllSubcontractors);
router.get('/statistics', getSubcontractorStatistics);
router.get('/work-type/:workType', getSubcontractorsByWorkType);
router.get('/:id', getSubcontractorById);
router.put('/:id', validate(updateSubcontractorSchema), updateSubcontractor);
router.delete('/:id', deleteSubcontractor);

// Verification and status management
router.patch(
  '/:id/verify',
  validate(verifySubcontractorSchema),
  verifySubcontractor
);
router.patch(
  '/:id/blacklist',
  validate(blacklistSubcontractorSchema),
  blacklistSubcontractor
);
router.patch('/:id/unblacklist', unblacklistSubcontractor);

// Worker management routes
router.post('/:subcontractorId/workers', addSubcontractorWorker); // Changed from :contractorId

// Get all workers for a specific subcontractor
router.get('/:subcontractorId/workers', getSubcontractorWorkers);

// Project management routes
router.post('/:contractorId/:projectId', createContractorProject);
router.get(
  '/:contractorId/contractorProjectsByContractorId',
  getContractorProjectsByContractorId
);
router.get(
  '/:projectId/contractorProjectsByProjectId',
  getContractorProjectsByProjectId
);
router.get('/projects/all', getAllProjectsWithSubcontractors);
router.get('/projects/:contractorProjectId', getContractorProjectById);

router.patch(
  '/projects/:contractorProjectId',
  validate(updateContractorProjectSchema),
  updateContractorProjectById
);
router.delete('/projects/:contractorProjectId', deleteContractorProjectById);

// Assignment management routes
router.post('/projects/:contractorProjectId/assignments', createWorkAssignment);
router.get(
  '/projects/:contractorProjectId/assignments',
  getContractorAssignments
);
router.get('/assignments/:assignmentId', getAssignmentById);
router.patch('/assignments/:assignmentId/verify', verifyWorkCompletion);

// Payment management routes
router.post('/projects/:contractorProjectId/payments', createContractorPayment);
router.patch('/payments/:paymentId/approve', approveContractorPayment);
router.patch('/payments/:paymentId/process', processContractorPayment);
router.get('/:contractorId/payments', getContractorPayments);

// Review management routes
router.post(
  '/:contractorId/projects/:projectId/reviews',
  createContractorReview
);
router.patch('/reviews/:reviewId/approve', approveContractorReview);

router.get('/workers/for-attendance', getSubcontractorWorkersForAttendance);

// Get worker details by ID
router.get('/workers/:workerId', getSubcontractorWorkerDetails);

router.get('/projects/:projectId/workers', getSubcontractorWorkersByProjectId);

export default router;
