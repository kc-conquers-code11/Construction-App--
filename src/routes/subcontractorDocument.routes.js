import express from 'express';
import { authenticate, companyContext } from '../middleware/auth.middleware.js';
import { validate } from '../validations/index.js';
import {
  uploadContractorDocument,
  getContractorDocuments,
  getContractorDocumentById,
  deleteContractorDocument,
  downloadContractorDocument,
  updateContractorDocumentDetails,
  getContractorDocumentStatistics,
  getDocumentTypes,
  previewContractorDocument,
} from '../controllers/subcontractorDocument.controller.js';
import { upload } from '../services/fileStorage.service.js';

const router = express.Router();

// Apply authentication and company context middleware to all routes
router.use(authenticate, companyContext);

// Document type routes
router.get('/document-types', getDocumentTypes);

// Update the upload route handler
router.post(
  '/:contractorId/documents',
  upload.single('file'),
  uploadContractorDocument
);

router.get('/:contractorId/documents', getContractorDocuments);
router.get(
  '/:contractorId/documents/statistics',
  getContractorDocumentStatistics
);

// Individual document routes
router.get('/documents/:id', getContractorDocumentById);
router.put('/documents/:id', updateContractorDocumentDetails);
router.delete('/documents/:id', deleteContractorDocument);
router.get('/documents/:id/download', downloadContractorDocument);
router.get('/documents/:id/preview', previewContractorDocument);

export default router;
