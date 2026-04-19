import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import {
    getCriticalPath,
    getTimelineGanttData,
    getProjectTimelineSummary,
    getDelayedTimelines,
    getUpcomingMilestones,
} from '../controllers/timelineAnalysis.controller.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Analysis Routes
router.get('/:id/critical-path', getCriticalPath);
router.get('/:id/gantt', getTimelineGanttData);
router.get('/project/:projectId/summary', getProjectTimelineSummary);
router.get('/delayed', getDelayedTimelines);
router.get('/upcoming-milestones', getUpcomingMilestones);

export default router;