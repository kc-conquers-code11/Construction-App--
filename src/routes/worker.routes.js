// src/routes/worker.routes.js
import express from 'express';
import { validate } from '../validations/index.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { upload } from '../services/fileStorage.service.js';
import {
  createSiteStaff,
  getAllSiteStaff,
  getSiteStaffById,
  updateSiteStaff,
  deleteSiteStaff,
  assignSiteStaffToProject,
  // REMOVE: markWorkerPunchIn,
  // REMOVE: markWorkerPunchOut,
  bulkMarkWorkerAttendance,
  getWorkerAttendance,
  verifyWorkerAttendance,
  assignSubtaskToWorker,
  getWorkerSubtaskAssignments,
  updateSubtaskAssignmentStatus,
  verifySubtaskCompletion,
  removeSubtaskAssignment,
  getWorkerDashboardStats,
} from '../controllers/worker.controller.js';
import {
  createSiteStaffSchema,
  updateSiteStaffSchema,
  // REMOVE: workerPunchInSchema,
  // REMOVE: workerPunchOutSchema,
  bulkWorkerAttendanceSchema,
  assignSubtaskToWorkerSchema,
  updateSubtaskAssignmentSchema,
  verifySubtaskCompletionSchema,
  assignSiteStaffToProjectSchema,
} from '../validations/worker.validations.js';

const router = express.Router();

router.use(authenticate);

// ==================== Site Staff Worker Routes ====================

// Create worker with multiple file uploads
router.post(
  '/site-staff',
  upload.fields([
    { name: 'profilePicture', maxCount: 1 },
    { name: 'aadharCopy', maxCount: 1 },
    { name: 'panCopy', maxCount: 1 },
  ]),
  validate(createSiteStaffSchema),
  createSiteStaff
);

// Get all site staff workers
router.get('/site-staff', getAllSiteStaff);

// Get site staff worker by ID
router.get('/site-staff/:id', getSiteStaffById);

// Update site staff worker
router.patch(
  '/site-staff/:id',
  upload.fields([
    { name: 'profilePicture', maxCount: 1 },
    { name: 'aadharCopy', maxCount: 1 },
    { name: 'panCopy', maxCount: 1 },
  ]),
  validate(updateSiteStaffSchema),
  updateSiteStaff
);

// Delete site staff worker
router.delete('/site-staff/:id', deleteSiteStaff);

// Assign site staff to project
router.post(
  '/site-staff/:workerId/projects/:projectId/assign',
  validate(assignSiteStaffToProjectSchema),
  assignSiteStaffToProject
);

// ==================== Worker Attendance Routes ====================

// REMOVED: Punch in route
// REMOVED: Punch out route

// Bulk mark attendance (PRESENT/ABSENT only)
router.post(
  '/attendance/bulk',
  validate(bulkWorkerAttendanceSchema),
  bulkMarkWorkerAttendance
);

// Get worker attendance records (supports date filtering)
router.get('/attendance', getWorkerAttendance);

// Verify attendance
router.patch(
  '/attendance/:id/verify',
  validate(verifySubtaskCompletionSchema),
  verifyWorkerAttendance
);

// ==================== Worker Subtask Assignment Routes ====================

// Assign subtask to worker
router.post(
  '/subtask-assignments',
  validate(assignSubtaskToWorkerSchema),
  assignSubtaskToWorker
);

// Get worker subtask assignments
router.get('/subtask-assignments', getWorkerSubtaskAssignments);

// Update subtask assignment status
router.patch(
  '/subtask-assignments/:id/status',
  validate(updateSubtaskAssignmentSchema),
  updateSubtaskAssignmentStatus
);

// Verify subtask completion
router.patch(
  '/subtask-assignments/:id/verify',
  validate(verifySubtaskCompletionSchema),
  verifySubtaskCompletion
);

// Remove subtask assignment
router.delete('/subtask-assignments/:id', removeSubtaskAssignment);

// ==================== Worker Dashboard ====================

// Get worker dashboard statistics
router.get('/dashboard/:workerType/:workerId', getWorkerDashboardStats);

export default router;
