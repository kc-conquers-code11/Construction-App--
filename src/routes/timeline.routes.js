import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import {
  createTimeline,
  getAllTimelines,
  getTimelineById,
  updateTimeline,
  deleteTimeline,
  submitTimelineForApproval,
  approveRejectTimeline,
  lockUnlockTimeline,
  archiveRestoreTimeline,
  getTimelineProgress,
  getTimelineHistory,
  getTimelineApprovals,
  createTaskAndAddToTimeline,
} from '../controllers/timeline.controller.js';

import {
  createTimelineVersion,
  getTimelineVersions,
  getTimelineVersionById,
  updateTimelineVersion,
  deleteTimelineVersion,
  setVersionAsBaseline,
  submitVersionForApproval,
  approveRejectVersion,
  compareVersions,
} from '../controllers/timelineVersion.controller.js';

import {
  addTaskToTimeline,
  bulkAddTasksToTimeline,
  getTimelineTasks,
  updateTimelineTask,
  bulkUpdateTimelineTasks,
  removeTaskFromTimeline,
  updateTaskTimelineStatus,
  getTimelineCalendar,
} from '../controllers/timelineTask.controller.js';

import {
  getCriticalPath,
  getTimelineGanttData,
  getProjectTimelineSummary,
  getDelayedTimelines,
  getUpcomingMilestones,
} from '../controllers/timelineAnalysis.controller.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// ==================== TIMELINE ROUTES ====================

// 1. Create & Manage Timelines
router.post('/', createTimeline);
router.get('/', getAllTimelines);
router.get('/:id', getTimelineById);
router.put('/:id', updateTimeline);
router.delete('/:id', deleteTimeline);

// 2. Timeline Workflow
router.post('/:id/submit', submitTimelineForApproval);
router.post('/:id/approve-reject', approveRejectTimeline);
router.post('/:id/lock-unlock', lockUnlockTimeline);
router.post('/:id/archive-restore', archiveRestoreTimeline);

// 3. Timeline Progress & Analysis
router.get('/:id/progress', getTimelineProgress);
router.get('/:id/history', getTimelineHistory);
router.get('/:id/approvals', getTimelineApprovals);

// ==================== VERSION ROUTES ====================

// 4. Version Management
router.post('/:id/versions', createTimelineVersion);
router.get('/:id/versions', getTimelineVersions);
router.get('/:id/versions/:version', getTimelineVersionById);
router.put('/:id/versions/:version', updateTimelineVersion);
router.delete('/:id/versions/:version', deleteTimelineVersion);

// 5. Version Workflow
router.post('/:id/versions/:version/set-baseline', setVersionAsBaseline);
router.post('/:id/versions/:version/submit', submitVersionForApproval);
router.post('/:id/versions/:version/approve-reject', approveRejectVersion);

// 6. Version Comparison
router.get('/:id/compare/:version1/:version2', compareVersions);

// ==================== TASK ROUTES ====================

// 7. Task Management
router.post('/:id/tasks', addTaskToTimeline);
router.post('/:id/tasks/new', createTaskAndAddToTimeline);
router.post('/:id/tasks/bulk', bulkAddTasksToTimeline);
router.get('/:id/tasks', getTimelineTasks);
router.put('/:id/tasks/bulk', bulkUpdateTimelineTasks);
router.put('/:id/tasks/:taskId', updateTimelineTask);
router.delete('/:id/tasks/:taskId', removeTaskFromTimeline);

// 8. Task Status Updates (less restrictive - task assignees can update)
router.patch('/:id/tasks/:taskId/status', updateTaskTimelineStatus);

// 9. Calendar View
router.get('/:id/calendar', getTimelineCalendar);

// ==================== ANALYSIS ROUTES ====================

// 10. Analysis & Reports
router.get('/:id/critical-path', getCriticalPath);
router.get('/:id/gantt', getTimelineGanttData);
router.get('/project/:projectId/summary', getProjectTimelineSummary);
router.get('/delayed', getDelayedTimelines);
router.get('/upcoming-milestones', getUpcomingMilestones);

export default router;
