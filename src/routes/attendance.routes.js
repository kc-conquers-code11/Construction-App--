// src/routes/attendance.routes.js
import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import {
  markAttendance,
  getAttendanceByDate,
  getAttendanceByDateRange,
  getEmployeeAttendance,
  updateAttendance,
  deleteAttendance,
  getAttendanceSummary,
} from '../controllers/attendance.controller.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Mark attendance (single or bulk)
router.post('/mark', markAttendance);

// Get attendance by date (daily view)
router.get('/by-date', getAttendanceByDate);

// Get attendance by date range (weekly/monthly view)
router.get('/by-range', getAttendanceByDateRange);

// Get attendance summary (dashboard)
router.get('/summary', getAttendanceSummary);

// Get individual employee attendance
router.get('/employee/:userId', getEmployeeAttendance);

// Update attendance record
router.put('/:id', updateAttendance);

// Delete attendance record
router.delete('/:id', deleteAttendance);

export default router;
