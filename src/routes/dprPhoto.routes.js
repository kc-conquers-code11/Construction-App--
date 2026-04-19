import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { upload } from '../services/fileStorage.service.js';
import { validate } from '../validations/index.js';
import {
  uploadDPRPhotoSchema,
  updateDPRPhotoDetailsSchema,
} from '../validations/dpr.validations.js';
import {
  uploadDPRPhoto,
  getDPRPhotos,
  getDPRPhotoById,
  deleteDPRPhoto,
  downloadDPRPhoto,
  updateDPRPhotoDetails,
  getDPRPhotoStatistics,
} from '../controllers/dprPhoto.controller.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Upload DPR photo (with file upload middleware)
router.post(
  '/upload',
  upload.single('file'), // 'file' is the field name in form-data
  validate(uploadDPRPhotoSchema),
  uploadDPRPhoto
);

// Get DPR photos
router.get('/dpr/:dprId', getDPRPhotos);

// Get DPR photo by ID
router.get('/:id', getDPRPhotoById);

// Update DPR photo details
router.put(
  '/:id/details',
  validate(updateDPRPhotoDetailsSchema),
  updateDPRPhotoDetails
);

// Delete DPR photo
router.delete('/:id', deleteDPRPhoto);

// Download DPR photo
router.get('/:id/download', downloadDPRPhoto);

// Get DPR photo statistics
router.get('/statistics/dpr/:dprId', getDPRPhotoStatistics);

export default router;
