// src/routes/wpr.routes.js (temporary version without validation)
import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import {
  getWeeklyProgressReport,
  getProjectsWPRSummary,
  exportWPRAsPDF,
  compareWPR,
  createWPR,
  getSavedWPRs,
  updateWPR
} from '../controllers/wpr.controller.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get weekly progress report for a project
router.get('/', getWeeklyProgressReport);

// Create a new weekly progress report
router.post('/', createWPR);

// Route to get list of saved WPRs for a project (for preview/edit before submission)
router.get('/list', getSavedWPRs);

// Get WPR summary for multiple projects
router.get('/summary', getProjectsWPRSummary);

// Compare two weeks
router.get('/compare', compareWPR);

// Update an existing WPR (for editing a saved draft)
router.patch('/:id', updateWPR);

// Export WPR as PDF (returns data for PDF generation)
router.get('/export/pdf', exportWPRAsPDF);

export default router;