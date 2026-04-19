// src/routes/supplier.routes.js
import express from 'express';
import multer from 'multer';
import path from 'path';
import { validate } from '../validations/index.js';
import { authenticate } from '../middleware/auth.middleware.js';
import {
    // ==================== SUPPLIER CORE CRUD ====================
    createSupplier,
    getAllSuppliers,
    getSupplierById,
    updateSupplier,
    deleteSupplier,
    updateSupplierStatus,
    verifySupplier,
    blacklistSupplier,
    getSupplierStats,
    searchSuppliers,

} from '../controllers/supplier.controller.js';

import {
    sendEmailToSupplier,
    sendBulkEmailToSuppliers,
    getEmailHistory,
    resendEmail,
    sendPOEmail,
    sendPaymentReminder,
    sendOrderConfirmation,
    getEmailTemplates,
    saveEmailTemplate,
    sendCustomEmail
} from '../controllers/supplier-communication.controller.js';

import {
    getSupplierPOs,
    getSupplierPOById,
    getSupplierPODetails,
    getSupplierPODashboard,
    exportSupplierPOs,
    printSupplierPO,
    bulkEmailPOs,
    getPODeliveryStatus,
    getSupplierPOAnalytics,
    generateSupplierReport
} from '../controllers/supplier-purchase-order.controller.js';

import {
    uploadSupplierDocument,
    getSupplierDocuments,
    getSupplierDocumentById,
    deleteSupplierDocument,
    verifySupplierDocument,
    downloadSupplierDocument,
    getDocumentTypes,
    getExpiringDocuments,
    getVerifiedDocuments
} from '../controllers/supplier-document.controller.js';

import {
    getSupplierRating,
    updateSupplierRating,
    getSupplierPerformanceMetrics,
    getOnTimeDeliveryRate,
    getQualityRating,
    getSupplierComparison,
    getTopSuppliers,
    generatePerformanceReport,
    recordDeliveryFeedback,
    getSupplierHistory
} from '../controllers/supplier-performance.controller.js';

import {
    // Core Supplier Validation Schemas
    createSupplierSchema,
    updateSupplierSchema,
    updateSupplierStatusSchema,
    verifySupplierSchema,
    blacklistSupplierSchema,
    searchSuppliersSchema,

    // PO Validation Schemas
    poIdParamSchema,
    paginationQuerySchema,
    dateRangeSchema,
    bulkEmailSchema,

    // Document Validation Schemas
    documentUploadSchema,
    documentVerifySchema,
    documentQuerySchema,

    // Communication Validation Schemas
    emailSendSchema,
    emailTemplateSchema,

    // Performance Validation Schemas
    ratingUpdateSchema,
    feedbackSchema,
    comparisonSchema,

    // Common Param Schemas
    supplierIdParamSchema,
    documentIdParamSchema,
    emailIdParamSchema
} from '../validations/supplier.validations.js';

const router = express.Router();

// ==================== MULTER CONFIGURATION ====================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/supplier-documents/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'application/pdf',
        'image/jpeg',
        'image/png',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only PDF, JPEG, PNG, DOC, DOCX, XLS, XLSX files are allowed.'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// All routes require authentication
router.use(authenticate);

// ============================================================================
// SECTION 1: SUPPLIER CORE CRUD ROUTES
// ============================================================================

/**
 * @route   POST /api/suppliers
 * @desc    Create a new supplier
 * @access  Private (Internal employees only)
 */
router.post('/',
    validate(createSupplierSchema),
    createSupplier
);

/**
 * @route   GET /api/suppliers
 * @desc    Get all suppliers with pagination and filtering
 * @access  Private (Internal employees only)
 */
router.get('/',
    getAllSuppliers
);

/**
 * @route   GET /api/suppliers/search
 * @desc    Search suppliers with advanced filters
 * @access  Private (Internal employees only)
 */
router.get('/search',
    validate(searchSuppliersSchema, 'query'),
    searchSuppliers
);

/**
 * @route   GET /api/suppliers/stats
 * @desc    Get supplier statistics and overview
 * @access  Private (Internal employees only)
 */
router.get('/stats',
    getSupplierStats
);

/**
 * @route   GET /api/suppliers/:id
 * @desc    Get supplier by ID with full details
 * @access  Private (Internal employees only)
 */
router.get('/:id',
    validate(supplierIdParamSchema, 'params'),
    getSupplierById
);

/**
 * @route   PUT /api/suppliers/:id
 * @desc    Update supplier information
 * @access  Private (Internal employees only)
 */
router.put('/:id',
    validate(supplierIdParamSchema, 'params'),
    validate(updateSupplierSchema),
    updateSupplier
);

/**
 * @route   DELETE /api/suppliers/:id
 * @desc    Delete supplier (soft delete)
 * @access  Private (Internal employees only)
 */
router.delete('/:id',
    validate(supplierIdParamSchema, 'params'),
    deleteSupplier
);

/**
 * @route   PATCH /api/suppliers/:id/status
 * @desc    Update supplier status (ACTIVE/INACTIVE/BLACKLISTED)
 * @access  Private (Internal employees only)
 */
router.patch('/:id/status',
    validate(supplierIdParamSchema, 'params'),
    validate(updateSupplierStatusSchema),
    updateSupplierStatus
);

/**
 * @route   POST /api/suppliers/:id/verify
 * @desc    Verify supplier (mark as verified)
 * @access  Private (Internal employees only)
 */
router.post('/:id/verify',
    validate(supplierIdParamSchema, 'params'),
    validate(verifySupplierSchema),
    verifySupplier
);

/**
 * @route   POST /api/suppliers/:id/blacklist
 * @desc    Blacklist supplier with reason
 * @access  Private (Internal employees only)
 */
router.post('/:id/blacklist',
    validate(supplierIdParamSchema, 'params'),
    validate(blacklistSupplierSchema),
    blacklistSupplier
);

// ============================================================================
// SECTION 2: SUPPLIER PURCHASE ORDER ROUTES
// ============================================================================

/**
 * @route   GET /api/suppliers/:supplierId/purchase-orders
 * @desc    Get all purchase orders for a supplier
 * @access  Private (Internal employees only)
 */
router.get('/:supplierId/purchase-orders',
    validate(supplierIdParamSchema, 'params'),
    validate(paginationQuerySchema, 'query'),
    getSupplierPOs
);

/**
 * @route   GET /api/suppliers/:supplierId/purchase-orders/:poId
 * @desc    Get specific purchase order for a supplier
 * @access  Private (Internal employees only)
 */
router.get('/:supplierId/purchase-orders/:poId',
    validate(supplierIdParamSchema, 'params'),
    validate(poIdParamSchema, 'params'),
    getSupplierPOById
);

/**
 * @route   GET /api/suppliers/:supplierId/purchase-orders/:poId/details
 * @desc    Get detailed information for a specific PO
 * @access  Private (Internal employees only)
 */
router.get('/:supplierId/purchase-orders/:poId/details',
    validate(supplierIdParamSchema, 'params'),
    validate(poIdParamSchema, 'params'),
    getSupplierPODetails
);

/**
 * @route   GET /api/suppliers/:supplierId/dashboard
 * @desc    Get supplier PO dashboard with key metrics
 * @access  Private (Internal employees only)
 */
router.get('/:supplierId/dashboard',
    validate(supplierIdParamSchema, 'params'),
    getSupplierPODashboard
);

/**
 * @route   GET /api/suppliers/:supplierId/analytics
 * @desc    Get detailed PO analytics for supplier
 * @access  Private (Internal employees only)
 */
router.get('/:supplierId/analytics',
    validate(supplierIdParamSchema, 'params'),
    validate(dateRangeSchema, 'query'),
    getSupplierPOAnalytics
);

/**
 * @route   GET /api/suppliers/:supplierId/delivery-status
 * @desc    Get delivery status for all POs
 * @access  Private (Internal employees only)
 */
router.get('/:supplierId/delivery-status',
    validate(supplierIdParamSchema, 'params'),
    getPODeliveryStatus
);

/**
 * @route   GET /api/suppliers/:supplierId/report
 * @desc    Generate comprehensive supplier report
 * @access  Private (Internal employees only)
 */
router.get('/:supplierId/report',
    validate(supplierIdParamSchema, 'params'),
    validate(dateRangeSchema, 'query'),
    generateSupplierReport
);

/**
 * @route   GET /api/suppliers/:supplierId/export-pos
 * @desc    Export supplier POs to CSV/Excel
 * @access  Private (Internal employees only)
 */
router.get('/:supplierId/export-pos',
    validate(supplierIdParamSchema, 'params'),
    validate(dateRangeSchema, 'query'),
    exportSupplierPOs
);

/**
 * @route   GET /api/suppliers/:supplierId/print/:poId
 * @desc    Generate printable version of PO
 * @access  Private (Internal employees only)
 */
router.get('/:supplierId/print/:poId',
    validate(supplierIdParamSchema, 'params'),
    validate(poIdParamSchema, 'params'),
    printSupplierPO
);

/**
 * @route   POST /api/suppliers/:supplierId/bulk-email
 * @desc    Send bulk email with multiple POs to supplier
 * @access  Private (Internal employees only)
 */
router.post('/:supplierId/bulk-email',
    validate(supplierIdParamSchema, 'params'),
    validate(bulkEmailSchema, 'body'),
    bulkEmailPOs
);

// ============================================================================
// SECTION 3: SUPPLIER DOCUMENT ROUTES
// ============================================================================

/**
 * @route   POST /api/suppliers/:supplierId/documents
 * @desc    Upload a document for a supplier
 * @access  Private (Internal employees only)
 */
router.post('/:supplierId/documents',
    validate(supplierIdParamSchema, 'params'),
    upload.single('document'),
    validate(documentUploadSchema, 'body'),
    uploadSupplierDocument
);

/**
 * @route   GET /api/suppliers/:supplierId/documents
 * @desc    Get all documents for a supplier
 * @access  Private (Internal employees only)
 */
router.get('/:supplierId/documents',
    validate(supplierIdParamSchema, 'params'),
    validate(documentQuerySchema, 'query'),
    getSupplierDocuments
);

/**
 * @route   GET /api/suppliers/:supplierId/documents/:docId
 * @desc    Get specific document by ID
 * @access  Private (Internal employees only)
 */
router.get('/:supplierId/documents/:docId',
    validate(supplierIdParamSchema, 'params'),
    validate(documentIdParamSchema, 'params'),
    getSupplierDocumentById
);

/**
 * @route   DELETE /api/suppliers/:supplierId/documents/:docId
 * @desc    Delete a supplier document
 * @access  Private (Internal employees only)
 */
router.delete('/:supplierId/documents/:docId',
    validate(supplierIdParamSchema, 'params'),
    validate(documentIdParamSchema, 'params'),
    deleteSupplierDocument
);

/**
 * @route   GET /api/suppliers/:supplierId/documents/:docId/download
 * @desc    Download a supplier document
 * @access  Private (Internal employees only)
 */
router.get('/:supplierId/documents/:docId/download',
    validate(supplierIdParamSchema, 'params'),
    validate(documentIdParamSchema, 'params'),
    downloadSupplierDocument
);

/**
 * @route   PATCH /api/suppliers/documents/:docId/verify
 * @desc    Verify a supplier document
 * @access  Private (Internal employees only)
 */
router.patch('/documents/:docId/verify',
    validate(documentIdParamSchema, 'params'),
    validate(documentVerifySchema, 'body'),
    verifySupplierDocument
);

/**
 * @route   GET /api/suppliers/documents/types
 * @desc    Get all document types with counts
 * @access  Private (Internal employees only)
 */
router.get('/documents/types',
    getDocumentTypes
);

/**
 * @route   GET /api/suppliers/documents/expiring
 * @desc    Get documents expiring soon
 * @access  Private (Internal employees only)
 */
router.get('/documents/expiring',
    validate(documentQuerySchema, 'query'),
    getExpiringDocuments
);

/**
 * @route   GET /api/suppliers/documents/verified
 * @desc    Get all verified documents
 * @access  Private (Internal employees only)
 */
router.get('/documents/verified',
    validate(documentQuerySchema, 'query'),
    getVerifiedDocuments
);

// ============================================================================
// SECTION 4: SUPPLIER COMMUNICATION ROUTES
// ============================================================================

/**
 * @route   POST /api/suppliers/:supplierId/send-email
 * @desc    Send email to supplier
 * @access  Private (Internal employees only)
 */
router.post('/:supplierId/send-email',
    validate(supplierIdParamSchema, 'params'),
    validate(emailSendSchema, 'body'),
    sendEmailToSupplier
);

/**
 * @route   POST /api/suppliers/bulk-email
 * @desc    Send bulk email to multiple suppliers
 * @access  Private (Internal employees only)
 */
router.post('/bulk-email',
    validate(bulkEmailSchema, 'body'),
    sendBulkEmailToSuppliers
);

/**
 * @route   GET /api/suppliers/:supplierId/email-history
 * @desc    Get email history for a supplier
 * @access  Private (Internal employees only)
 */
router.get('/:supplierId/email-history',
    validate(supplierIdParamSchema, 'params'),
    validate(paginationQuerySchema, 'query'),
    getEmailHistory
);

/**
 * @route   POST /api/suppliers/emails/:emailId/resend
 * @desc    Resend a previous email
 * @access  Private (Internal employees only)
 */
router.post('/emails/:emailId/resend',
    validate(emailIdParamSchema, 'params'),
    resendEmail
);

/**
 * @route   POST /api/suppliers/:supplierId/send-po/:poId
 * @desc    Send PO email to supplier
 * @access  Private (Internal employees only)
 */
router.post('/:supplierId/send-po/:poId',
    validate(supplierIdParamSchema, 'params'),
    validate(poIdParamSchema, 'params'),
    sendPOEmail
);

/**
 * @route   POST /api/suppliers/:supplierId/payment-reminder/:poId
 * @desc    Send payment reminder to supplier
 * @access  Private (Internal employees only)
 */
router.post('/:supplierId/payment-reminder/:poId',
    validate(supplierIdParamSchema, 'params'),
    validate(poIdParamSchema, 'params'),
    sendPaymentReminder
);

/**
 * @route   POST /api/suppliers/:supplierId/order-confirmation/:poId
 * @desc    Send order confirmation to supplier
 * @access  Private (Internal employees only)
 */
router.post('/:supplierId/order-confirmation/:poId',
    validate(supplierIdParamSchema, 'params'),
    validate(poIdParamSchema, 'params'),
    sendOrderConfirmation
);

/**
 * @route   GET /api/suppliers/email-templates
 * @desc    Get all email templates
 * @access  Private (Internal employees only)
 */
router.get('/email-templates',
    getEmailTemplates
);

/**
 * @route   POST /api/suppliers/email-templates
 * @desc    Save a new email template
 * @access  Private (Internal employees only)
 */
router.post('/email-templates',
    validate(emailTemplateSchema, 'body'),
    saveEmailTemplate
);

/**
 * @route   POST /api/suppliers/:supplierId/send-custom
 * @desc    Send custom email to supplier
 * @access  Private (Internal employees only)
 */
router.post('/:supplierId/send-custom',
    validate(supplierIdParamSchema, 'params'),
    validate(emailSendSchema, 'body'),
    sendCustomEmail
);

// ============================================================================
// SECTION 5: SUPPLIER PERFORMANCE ROUTES
// ============================================================================

/**
 * @route   GET /api/suppliers/:supplierId/rating
 * @desc    Get supplier rating
 * @access  Private (Internal employees only)
 */
router.get('/:supplierId/rating',
    validate(supplierIdParamSchema, 'params'),
    getSupplierRating
);

/**
 * @route   PUT /api/suppliers/:supplierId/rating
 * @desc    Update supplier rating manually
 * @access  Private (Internal employees only)
 */
router.put('/:supplierId/rating',
    validate(supplierIdParamSchema, 'params'),
    validate(ratingUpdateSchema, 'body'),
    updateSupplierRating
);

/**
 * @route   GET /api/suppliers/:supplierId/metrics
 * @desc    Get detailed performance metrics
 * @access  Private (Internal employees only)
 */
router.get('/:supplierId/metrics',
    validate(supplierIdParamSchema, 'params'),
    validate(dateRangeSchema, 'query'),
    getSupplierPerformanceMetrics
);

/**
 * @route   GET /api/suppliers/:supplierId/on-time-rate
 * @desc    Get on-time delivery rate
 * @access  Private (Internal employees only)
 */
router.get('/:supplierId/on-time-rate',
    validate(supplierIdParamSchema, 'params'),
    validate(dateRangeSchema, 'query'),
    getOnTimeDeliveryRate
);

/**
 * @route   GET /api/suppliers/:supplierId/quality-rating
 * @desc    Get quality rating and metrics
 * @access  Private (Internal employees only)
 */
router.get('/:supplierId/quality-rating',
    validate(supplierIdParamSchema, 'params'),
    validate(dateRangeSchema, 'query'),
    getQualityRating
);

/**
 * @route   GET /api/suppliers/:supplierId/history
 * @desc    Get supplier interaction history
 * @access  Private (Internal employees only)
 */
router.get('/:supplierId/history',
    validate(supplierIdParamSchema, 'params'),
    validate(paginationQuerySchema, 'query'),
    getSupplierHistory
);

/**
 * @route   POST /api/suppliers/:supplierId/feedback
 * @desc    Record delivery feedback
 * @access  Private (Internal employees only)
 */
router.post('/:supplierId/feedback',
    validate(supplierIdParamSchema, 'params'),
    validate(feedbackSchema, 'body'),
    recordDeliveryFeedback
);

/**
 * @route   GET /api/suppliers/comparison
 * @desc    Compare multiple suppliers
 * @access  Private (Internal employees only)
 */
router.get('/comparison',
    validate(comparisonSchema, 'query'),
    getSupplierComparison
);

/**
 * @route   GET /api/suppliers/top
 * @desc    Get top performing suppliers
 * @access  Private (Internal employees only)
 */
router.get('/top',
    validate(paginationQuerySchema, 'query'),
    getTopSuppliers
);

/**
 * @route   GET /api/suppliers/performance-report
 * @desc    Generate overall supplier performance report
 * @access  Private (Internal employees only)
 */
router.get('/performance-report',
    validate(dateRangeSchema, 'query'),
    generatePerformanceReport
);

export default router;