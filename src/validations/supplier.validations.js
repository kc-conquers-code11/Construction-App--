// src/validations/supplier.validations.js
import { z } from 'zod';

// ==================== COMMON SCHEMAS ====================

export const supplierIdParamSchema = z.object({
    supplierId: z.string().uuid('Invalid supplier ID format'),
    id: z.string().uuid('Invalid supplier ID format').optional(),
}).strict();

export const poIdParamSchema = z.object({
    poId: z.string().uuid('Invalid PO ID format'),
}).strict();

export const documentIdParamSchema = z.object({
    docId: z.string().uuid('Invalid document ID format'),
    documentId: z.string().uuid('Invalid document ID format').optional(),
}).strict();

export const emailIdParamSchema = z.object({
    emailId: z.string().uuid('Invalid email ID format'),
}).strict();

export const paginationQuerySchema = z.object({
    page: z.string().optional().transform(val => val ? parseInt(val) : 1),
    limit: z.string().optional().transform(val => val ? parseInt(val) : 10),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
}).strict();

export const dateRangeSchema = z.object({
    fromDate: z.string().optional().transform(val => val ? new Date(val) : undefined),
    toDate: z.string().optional().transform(val => val ? new Date(val) : undefined),
    format: z.enum(['json', 'csv']).optional().default('json'),
}).strict();

// ==================== SUPPLIER CORE SCHEMAS ====================

export const createSupplierSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters').max(100),
    type: z.enum(['MANUFACTURER', 'DISTRIBUTOR', 'WHOLESALER', 'RETAILER', 'SERVICE_PROVIDER', 'CONSULTANT', 'CONTRACTOR', 'IMPORTER', 'OTHER']),
    subtypes: z.array(z.string()).optional(),
    contactPerson: z.string().min(2).max(100),
    email: z.string().email('Invalid email format').optional().nullable(),
    phone: z.string().regex(/^[0-9+\-\s()]{10,15}$/, 'Invalid phone number format'),
    alternatePhone: z.string().regex(/^[0-9+\-\s()]{10,15}$/, 'Invalid phone number format').optional().nullable(),
    whatsapp: z.string().regex(/^[0-9+\-\s()]{10,15}$/, 'Invalid phone number format').optional().nullable(),
    website: z.string().url('Invalid URL format').optional().nullable(),
    address: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    country: z.string().default('India'),
    pincode: z.string().regex(/^\d{6}$/, 'Invalid pincode format').optional().nullable(),
    gstNumber: z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GST number format').optional().nullable(),
    panNumber: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN number format').optional().nullable(),
    tanNumber: z.string().regex(/^[A-Z]{4}[0-9]{5}[A-Z]{1}$/, 'Invalid TAN number format').optional().nullable(),
    cinNumber: z.string().regex(/^[L|U][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/, 'Invalid CIN number format').optional().nullable(),
    msmeNumber: z.string().optional().nullable(),
    businessType: z.string().optional().nullable(),
    yearEstablished: z.number().min(1900).max(new Date().getFullYear()).optional().nullable(),
    bankName: z.string().optional().nullable(),
    bankAccount: z.string().regex(/^\d{9,18}$/, 'Invalid bank account number').optional().nullable(),
    bankIfsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code').optional().nullable(),
    bankBranch: z.string().optional().nullable(),
    upiId: z.string().regex(/^[\w\.\-]+@[\w\.\-]+$/, 'Invalid UPI ID').optional().nullable(),
    defaultPaymentTerm: z.enum(['ADVANCE_FULL', 'ADVANCE_PARTIAL', 'ON_DELIVERY', 'NET_7', 'NET_15', 'NET_30', 'NET_45', 'NET_60', 'NET_90', 'LETTER_OF_CREDIT', 'CASH_ON_DELIVERY', 'CHEQUE_ON_DELIVERY', 'OTHER']).default('NET_30'),
    creditLimit: z.number().positive().optional().nullable(),
    creditDays: z.number().int().positive().optional().nullable(),
    notes: z.string().optional().nullable(),
    tags: z.array(z.string()).optional(),
}).strict();

export const updateSupplierSchema = createSupplierSchema.partial();

export const updateSupplierStatusSchema = z.object({
    status: z.enum(['ACTIVE', 'INACTIVE', 'BLACKLISTED', 'UNDER_REVIEW']),
    reason: z.string().optional(),
}).strict();

export const verifySupplierSchema = z.object({
    verificationStatus: z.enum(['VERIFIED', 'PENDING', 'REJECTED']),
    notes: z.string().optional(),
}).strict();

export const blacklistSupplierSchema = z.object({
    reason: z.string().min(5, 'Blacklist reason must be at least 5 characters'),
}).strict();

export const searchSuppliersSchema = z.object({
    q: z.string().optional(),
    page: z.string().optional().transform(val => val ? parseInt(val) : 1),
    limit: z.string().optional().transform(val => val ? parseInt(val) : 10),
    status: z.enum(['ACTIVE', 'INACTIVE', 'BLACKLISTED', 'UNDER_REVIEW']).optional(),
    type: z.enum(['MANUFACTURER', 'DISTRIBUTOR', 'WHOLESALER', 'RETAILER', 'SERVICE_PROVIDER', 'CONSULTANT', 'CONTRACTOR', 'IMPORTER', 'OTHER']).optional(),
    verificationStatus: z.enum(['VERIFIED', 'PENDING', 'REJECTED']).optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    minRating: z.string().optional().transform(val => val ? parseFloat(val) : undefined),
    tags: z.string().optional(),
}).strict();

// ==================== PURCHASE ORDER SCHEMAS ====================

export const bulkEmailSchema = z.object({
    poIds: z.array(z.string().uuid('Invalid PO ID format')).min(1, 'At least one PO ID required'),
    emailSubject: z.string().min(1).max(200),
    emailBody: z.string().min(1),
}).strict();

// ==================== DOCUMENT SCHEMAS ====================

export const documentUploadSchema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().optional().nullable(),
    documentType: z.enum(['CONTRACT', 'PERMIT', 'DRAWING', 'REPORT', 'INVOICE', 'CERTIFICATE', 'PHOTO', 'AGREEMENT', 'REGISTRATION', 'GST_PROOF', 'PAN_PROOF', 'AADHAR_PROOF', 'BANK_PROOF', 'INSURANCE', 'LICENSE', 'OTHER']),
    documentNo: z.string().optional().nullable(),
    expiryDate: z.string().optional().transform(val => val ? new Date(val) : undefined),
}).strict();

export const documentVerifySchema = z.object({
    isVerified: z.boolean(),
    verificationNotes: z.string().optional(),
}).strict();

export const documentQuerySchema = z.object({
    page: z.string().optional().transform(val => val ? parseInt(val) : 1),
    limit: z.string().optional().transform(val => val ? parseInt(val) : 10),
    documentType: z.enum(['CONTRACT', 'PERMIT', 'DRAWING', 'REPORT', 'INVOICE', 'CERTIFICATE', 'PHOTO', 'AGREEMENT', 'REGISTRATION', 'GST_PROOF', 'PAN_PROOF', 'AADHAR_PROOF', 'BANK_PROOF', 'INSURANCE', 'LICENSE', 'OTHER']).optional(),
    isVerified: z.enum(['true', 'false']).optional(),
    isExpiring: z.enum(['true', 'false']).optional(),
    search: z.string().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
    days: z.string().optional().transform(val => val ? parseInt(val) : 30),
}).strict();

// ==================== COMMUNICATION SCHEMAS ====================

export const emailSendSchema = z.object({
    subject: z.string().min(1).max(200),
    content: z.string().min(1),
    templateId: z.string().optional(),
    templateVariables: z.record(z.string()).optional(),
    attachments: z.array(z.object({
        filename: z.string(),
        path: z.string(),
        contentType: z.string(),
    })).optional(),
    cc: z.array(z.string().email()).optional(),
    bcc: z.array(z.string().email()).optional(),
}).strict();

export const emailTemplateSchema = z.object({
    name: z.string().min(1).max(100),
    subject: z.string().min(1).max(200),
    body: z.string().min(1),
    variables: z.array(z.string()),
}).strict();

// ==================== PERFORMANCE SCHEMAS ====================

export const ratingUpdateSchema = z.object({
    rating: z.number().min(0).max(5),
    review: z.string().optional(),
}).strict();

export const feedbackSchema = z.object({
    poId: z.string().uuid('Invalid PO ID format'),
    feedback: z.string().min(1),
    rating: z.number().min(0).max(5),
    issues: z.array(z.string()).optional(),
    resolved: z.boolean().optional(),
}).strict();

export const comparisonSchema = z.object({
    supplierIds: z.string().optional(),
    criteria: z.enum(['rating', 'volume', 'onTime', 'quality']).optional().default('rating'),
    category: z.string().optional(),
    limit: z.string().optional().transform(val => val ? parseInt(val) : 5),
}).strict();

// Combined schema for validation
export default {
    supplierIdParamSchema,
    poIdParamSchema,
    documentIdParamSchema,
    emailIdParamSchema,
    paginationQuerySchema,
    dateRangeSchema,
    createSupplierSchema,
    updateSupplierSchema,
    updateSupplierStatusSchema,
    verifySupplierSchema,
    blacklistSupplierSchema,
    searchSuppliersSchema,
    bulkEmailSchema,
    documentUploadSchema,
    documentVerifySchema,
    documentQuerySchema,
    emailSendSchema,
    emailTemplateSchema,
    ratingUpdateSchema,
    feedbackSchema,
    comparisonSchema,
};