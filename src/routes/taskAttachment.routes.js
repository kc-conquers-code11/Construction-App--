import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { upload } from '../services/fileStorage.service.js';
import {
  uploadTaskAttachment,
  getTaskAttachments,
  getAttachmentById,
  deleteAttachment,
  downloadAttachment,
  getAttachmentStatistics,
} from '../controllers/taskAttachment.controller.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Upload task attachment (with file upload middleware)
router.post(
  '/upload',
  upload.single('file'), // 'file' is the field name in form-data
  uploadTaskAttachment
);

// Get task attachments
router.get('/task/:taskId', getTaskAttachments);

// Get attachment by ID
router.get('/:id', getAttachmentById);

// Delete attachment
router.delete('/:id', deleteAttachment);

// Download attachment
router.get('/:id/download', downloadAttachment);

// Get attachment statistics for a task
router.get('/statistics/task/:taskId', getAttachmentStatistics);

export default router;
