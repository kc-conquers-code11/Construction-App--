import { z } from 'zod';

// Enums from schema
const PurchaseOrderStatus = z.enum([
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'ORDERED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'INVOICED',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED',
  'CLOSED',
  'ON_HOLD',
]);

const PurchaseOrderType = z.enum([
  'MATERIAL',
  'EQUIPMENT',
  'SERVICE',
  'SUBCONTRACT',
  'TOOL',
  'CONSUMABLE',
  'STATIONERY',
  'FUEL',
  'OTHER',
]);

const PaymentTerm = z.enum([
  'ADVANCE_FULL',
  'ADVANCE_PARTIAL',
  'ON_DELIVERY',
  'NET_7',
  'NET_15',
  'NET_30',
  'NET_45',
  'NET_60',
  'NET_90',
  'LETTER_OF_CREDIT',
  'CASH_ON_DELIVERY',
  'CHEQUE_ON_DELIVERY',
  'OTHER',
]);

const PaymentMethod = z.enum([
  'CASH',
  'BANK_TRANSFER',
  'CHEQUE',
  'ONLINE',
  'UPI',
]);
const PaymentStatus = z.enum([
  'PENDING',
  'PARTIAL',
  'PAID',
  'OVERDUE',
  'DISPUTED',
]);
const InspectionStatus = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'PASSED',
  'FAILED',
  'CONDITIONAL_PASS',
  'REINSPECTION_REQUIRED',
]);
const QualityRating = z.enum([
  'EXCELLENT',
  'GOOD',
  'AVERAGE',
  'POOR',
  'REJECT',
]);
const PODocumentType = z.enum([
  'PURCHASE_ORDER',
  'QUOTATION',
  'INVOICE',
  'DELIVERY_CHALLAN',
  'GOODS_RECEIPT_NOTE',
  'PAYMENT_RECEIPT',
  'CONTRACT',
  'AGREEMENT',
  'TECHNICAL_SPECIFICATION',
  'QUALITY_CERTIFICATE',
  'WARRANTY_CARD',
  'INSURANCE',
  'OTHER',
]);

// ==================== PURCHASE ORDER CORE VALIDATIONS ====================

// Create purchase order validation
export const createPurchaseOrderSchema = z
  .object({
    poNumber: z.string().optional(),
    projectId: z.string().min(1, 'Project ID is required'),
    title: z.string().min(1, 'Title is required'),
    description: z.string().optional(),
    type: PurchaseOrderType.optional().default('MATERIAL'),
    status: PurchaseOrderStatus.optional().default('DRAFT'),

    // Supplier/Vendor - Dynamic Selection
    supplierId: z.string().nullable().optional(),
    supplierName: z.string().optional(),
    supplierAddress: z.string().optional(),
    supplierGST: z.string().optional(),
    supplierPAN: z.string().optional(),
    supplierContact: z.string().optional(),
    supplierEmail: z
      .string()
      .email('Invalid email format')
      .or(z.literal(''))
      .optional(),
    supplierPhone: z.string().optional(),

    // Financial Details
    subtotal: z.coerce.number().min(0).optional().default(0),
    taxAmount: z.coerce.number().min(0).optional().default(0),
    taxRate: z.coerce.number().min(0).max(100).optional().default(18),
    discount: z.coerce.number().min(0).optional().default(0),
    discountType: z.enum(['PERCENTAGE', 'FIXED']).optional(),
    shippingCost: z.coerce.number().min(0).optional().default(0),
    otherCharges: z.coerce.number().min(0).optional().default(0),
    totalAmount: z.coerce.number().min(0).optional(), // Can be omitted; backend calculates
    currency: z.string().optional().default('INR'),

    // Payment Terms
    paymentTerm: PaymentTerm.optional().default('NET_30'),
    advancePercentage: z.coerce.number().min(0).max(100).optional().default(0),
    advanceAmount: z.coerce.number().min(0).optional().default(0),

    // Dates
    orderDate: z.coerce.date().optional(),
    expectedDelivery: z.coerce.date().optional(),
    validUntil: z.coerce.date().optional(),

    // Delivery Details
    deliveryAddress: z.string().optional(),
    deliveryInstructions: z.string().optional(),
    shippingMethod: z.string().optional(),
    shippingTerms: z.string().optional(),

    // Budget Links
    budgetId: z.string().optional(),
    budgetCategoryId: z.string().optional(),

    // Metadata
    notes: z.string().optional(),
    internalNotes: z.string().optional(),
    terms: z.string().optional(),

    // Items array
    items: z
      .array(
        z.object({
          lineNo: z.coerce.number().int().optional(),
          description: z.string().min(1, 'Item description is required'),
          materialId: z.string().nullable().optional(),
          materialRequestId: z.string().nullable().optional(), // Linked Material Request
          specification: z.string().optional(),
          make: z.string().optional(),
          model: z.string().optional(),
          size: z.string().optional(),
          color: z.string().optional(),
          quantity: z.coerce.number().positive('Quantity must be positive'),
          unit: z.string().min(1, 'Unit is required'),
          unitPrice: z.coerce.number().min(0),
          discountPercent: z.coerce
            .number()
            .min(0)
            .max(100)
            .optional()
            .default(0),
          taxPercent: z.coerce.number().min(0).max(100).optional().default(18),
          expectedDelivery: z.coerce.date().optional(),
          budgetCategoryId: z.string().optional(),
          qualityStandard: z.string().optional(),
          inspectionRequired: z.boolean().optional().default(false),
          warrantyPeriod: z.coerce.number().int().optional(),
          notes: z.string().optional(),
        })
      )
      .optional(),
  })
  .superRefine((data, ctx) => {
    // Enforce either an existing Supplier ID or a manually entered Supplier Name
    if (!data.supplierId && !data.supplierName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Supplier Name is required when an existing Supplier is not selected',
        path: ['supplierName'],
      });
    }
  });

// Update purchase order validation
export const updatePurchaseOrderSchema = z.object({
  title: z.string().min(1, 'Title is required').optional(),
  description: z.string().optional(),
  expectedDelivery: z.coerce.date().optional(),
  actualDelivery: z.coerce.date().optional(), // Added missing date field

  deliveryAddress: z.string().optional(),
  deliveryInstructions: z.string().optional(),
  notes: z.string().optional(),
  terms: z.string().optional(),

  // Added missing financial fields
  shippingCost: z
    .number()
    .min(0, 'Shipping cost cannot be negative')
    .optional(),
  otherCharges: z
    .number()
    .min(0, 'Other charges cannot be negative')
    .optional(),
});

// ==================== PURCHASE ORDER WORKFLOW VALIDATIONS ====================

// For routes where we don't expect any specific body properties
export const submitPOForApprovalSchema = z.object({});

export const approveRejectPOSchema = z.object({
  action: z.enum(['approve', 'reject']).optional(),
  approved: z.boolean().optional(),
  approvalNotes: z.string().optional(),
  rejectionReason: z.string().optional(),
});

export const approvePOSchema = z.object({
  approvalNotes: z.string().optional(),
});

export const rejectPOSchema = z.object({
  rejectionReason: z.string().min(1, 'Rejection reason is required'),
});

export const markAsOrderedSchema = z.object({
  orderDate: z.coerce.date().optional(),
  notes: z.string().optional().nullable(),
});

export const markAsReceivedSchema = z.object({
  actualDelivery: z.coerce.date().optional(),
  notes: z.string().optional().nullable(),
});

export const cancelPOSchema = z.object({
  cancellationReason: z.string().min(1, 'Cancellation reason is required'),
});

export const closePOSchema = z.object({
  closureNotes: z.string().optional(),
});

// ==================== PURCHASE ORDER ITEM VALIDATIONS ====================

export const addPOItemSchema = z.object({
  description: z.string().min(1, 'Item description is required'),
  materialId: z.string().optional(),
  materialRequestId: z.string().optional(), // Material Request Linked
  specification: z.string().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  quantity: z.coerce.number().positive('Quantity must be positive'),
  unit: z.string().min(1, 'Unit is required'),
  unitPrice: z.coerce.number().positive('Unit price must be positive'),
  discountPercent: z.coerce.number().min(0).max(100).optional().default(0),
  taxPercent: z.coerce.number().min(0).max(100).optional().default(18),
  expectedDelivery: z.coerce.date().optional(),
  budgetCategoryId: z.string().optional(),
  qualityStandard: z.string().optional(),
  inspectionRequired: z.boolean().optional().default(false),
  notes: z.string().optional(),
});

export const updatePOItemSchema = z.object({
  description: z.string().min(1, 'Item description is required').optional(),
  specification: z.string().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  quantity: z.coerce.number().positive('Quantity must be positive').optional(),
  unit: z.string().optional(),
  unitPrice: z.coerce
    .number()
    .positive('Unit price must be positive')
    .optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  taxPercent: z.coerce.number().min(0).max(100).optional(),
  expectedDelivery: z.coerce.date().optional(),
  qualityStandard: z.string().optional(),
  inspectionRequired: z.boolean().optional(),
  notes: z.string().optional(),
});

export const updateReceivedQuantitySchema = z.object({
  receivedQuantity: z.coerce
    .number()
    .min(0, 'Received quantity must be non-negative'),
  notes: z.string().optional(),
});

export const closePOItemSchema = z.object({
  notes: z.string().optional(),
});

export const removePOItemSchema = z.object({});

// ==================== GOODS RECEIPT VALIDATIONS ====================

export const createGoodsReceiptSchema = z.object({
  purchaseOrderId: z.string().min(1, 'Purchase Order ID is required'),
  receiptDate: z.coerce.date().optional(),
  deliveryChallanNo: z.string().optional(),
  vehicleNo: z.string().optional(),
  transporter: z.string().optional(),
  receivedAt: z.string().optional(),
  receivedFrom: z.string().optional(),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        poItemId: z.string().min(1, 'PO Item ID is required'),
        receivedQuantity: z.coerce
          .number()
          .positive('Received quantity must be positive'),
        acceptedQuantity: z.coerce.number().min(0).optional(),
        rejectedQuantity: z.coerce.number().min(0).optional(),
        condition: z.string().optional(),
        qualityRating: QualityRating.optional(),
        inspectionStatus: InspectionStatus.optional().default('PENDING'),
        inspectionNotes: z.string().optional(),
        batchNo: z.string().optional(),
        serialNo: z.string().optional(),
        manufacturingDate: z.coerce.date().optional(),
        expiryDate: z.coerce.date().optional(),
        storedLocation: z.string().optional(),
        binLocation: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .min(1, 'At least one item is required'),
});

export const quickReceivePOSchema = z.object({
  receiptDate: z.coerce.date().optional(),
  deliveryChallanNo: z.string().optional(),
  notes: z.string().optional(),
});

export const acceptAllItemsSchema = z.object({
  // Accept null, default to GOOD if missing or null
  qualityRating: QualityRating.nullable().optional().default('GOOD'),
  notes: z.string().nullable().optional(),
});

export const rejectAllItemsSchema = z.object({
  rejectionReason: z
    .string()
    .min(1, 'Rejection reason is required')
    .nullable()
    .optional(),
  returnVoucherNo: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const updateStockFromReceiptSchema = z.object({});

// ==================== GOODS RECEIPT ITEM VALIDATIONS ====================

export const addReceiptItemSchema = z.object({
  poItemId: z.string().min(1, 'PO Item ID is required'),
  receivedQuantity: z.coerce
    .number()
    .positive('Received quantity must be positive'),
  acceptedQuantity: z.coerce.number().min(0).optional(),
  rejectedQuantity: z.coerce.number().min(0).optional(),
  condition: z.string().optional(),
  qualityRating: QualityRating.optional(),
  inspectionStatus: InspectionStatus.optional().default('PENDING'),
  inspectionNotes: z.string().optional(),
  batchNo: z.string().optional(),
  serialNo: z.string().optional(),
  manufacturingDate: z.coerce.date().optional(),
  expiryDate: z.coerce.date().optional(),
  storedLocation: z.string().optional(),
  binLocation: z.string().optional(),
  notes: z.string().optional(),
});

export const updateReceiptItemSchema = z.object({
  condition: z.string().optional(),
  qualityRating: QualityRating.optional(),
  inspectionStatus: InspectionStatus.optional(),
  inspectionNotes: z.string().optional(),
  batchNo: z.string().optional(),
  serialNo: z.string().optional(),
  manufacturingDate: z.coerce.date().optional(),
  expiryDate: z.coerce.date().optional(),
  storedLocation: z.string().optional(),
  binLocation: z.string().optional(),
  notes: z.string().optional(),
});

export const acceptReceiptItemSchema = z.object({
  qualityRating: QualityRating.optional().default('GOOD'),
  notes: z.string().optional(),
});

export const rejectReceiptItemSchema = z.object({
  rejectionReason: z.string().min(1, 'Rejection reason is required'),
  returnVoucherNo: z.string().optional(),
});

export const returnReceiptItemSchema = z.object({
  returnQuantity: z.coerce
    .number()
    .positive('Return quantity must be positive'),
  returnReason: z.string().min(1, 'Return reason is required'),
  returnVoucherNo: z.string().optional(),
});

// ==================== PURCHASE ORDER PAYMENT VALIDATIONS ====================

export const createPOPaymentSchema = z.object({
  purchaseOrderId: z.string().min(1, 'Purchase Order ID is required'),
  amount: z.coerce.number().positive('Amount must be positive'),
  paymentDate: z.coerce.date().optional(),
  paymentMethod: PaymentMethod,
  transactionId: z.string().optional(),
  referenceNo: z.string().optional(),
  paymentType: z.enum(['ADVANCE', 'PARTIAL', 'FINAL', 'MILESTONE']).optional(),
  paymentOrder: z.coerce.number().int().positive().optional(),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  bankIfsc: z.string().optional(),
  notes: z.string().optional(),
});

export const recordAdvancePaymentSchema = z.object({
  amount: z.coerce.number().positive('Advance amount must be positive'),
  paymentDate: z.coerce.date().optional(),
  paymentMethod: PaymentMethod,
  transactionId: z.string().optional(),
  referenceNo: z.string().optional(),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  bankIfsc: z.string().optional(),
  notes: z.string().optional(),
});

export const recordFinalPaymentSchema = z.object({
  amount: z.coerce.number().positive('Final amount must be positive'),
  paymentDate: z.coerce.date().optional(),
  paymentMethod: PaymentMethod,
  transactionId: z.string().optional(),
  referenceNo: z.string().optional(),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  bankIfsc: z.string().optional(),
  notes: z.string().optional(),
});

export const approvePOPaymentSchema = z.object({
  approvalNotes: z.string().optional(),
});

// ==================== PURCHASE ORDER DOCUMENT VALIDATIONS ====================

export const uploadPODocumentSchema = z.object({
  title: z.string().min(1, 'Document title is required'),
  description: z.string().optional(),
  documentType: PODocumentType,
  fileUrl: z.string().url('Invalid file URL').optional(),
  fileType: z.string().optional(),
  fileSize: z.coerce.number().int().positive().optional(),
});

export const deletePODocumentSchema = z.object({});

// ==================== PURCHASE ORDER COMMENT VALIDATIONS ====================

export const addPOCommentSchema = z.object({
  content: z.string().min(1, 'Comment content is required'),
  isInternal: z.boolean().optional().default(false),
});

export const updatePOCommentSchema = z.object({
  content: z.string().min(1, 'Comment content is required'),
  isInternal: z.boolean().optional(),
});

export const deletePOCommentSchema = z.object({});

// ==================== SEARCH / GET ALL VALIDATIONS ====================

export const getAllPurchaseOrdersSchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  search: z.string().optional(), // Used in `getAllPurchaseOrders`
  projectId: z.string().optional(),
  supplierId: z.string().optional(),
  status: PurchaseOrderStatus.optional(),
  type: PurchaseOrderType.optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

export const searchPurchaseOrdersSchema = z.object({
  q: z.string().optional(), // Used in `searchPurchaseOrders`
  projectId: z.string().optional(),
  supplierId: z.string().optional(),
  status: PurchaseOrderStatus.optional(),
  type: PurchaseOrderType.optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  minAmount: z.coerce.number().min(0).optional(),
  maxAmount: z.coerce.number().min(0).optional(),
  limit: z.coerce.number().int().positive().optional().default(10),
  page: z.coerce.number().int().positive().optional().default(1),
});

export const getPendingPOApprovalsSchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  projectId: z.string().optional(),
});

// ==================== ID PARAM VALIDATIONS ====================

export const poIdParamSchema = z.object({
  id: z.string().min(1, 'Purchase Order ID is required'),
});

export const purchaseOrderIdParamSchema = z.object({
  poId: z.string().min(1, 'Purchase Order ID is required'),
});

export const projectIdParamSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
});

export const supplierIdParamSchema = z.object({
  supplierId: z.string().min(1, 'Supplier ID is required'),
});

export const itemIdParamSchema = z.object({
  itemId: z.string().min(1, 'Item ID is required'),
});

export const paymentIdParamSchema = z.object({
  paymentId: z.string().min(1, 'Payment ID is required'),
});

export const documentIdParamSchema = z.object({
  documentId: z.string().min(1, 'Document ID is required'),
});

export const commentIdParamSchema = z.object({
  commentId: z.string().min(1, 'Comment ID is required'),
});

export const receiptItemIdParamSchema = z.object({
  itemId: z.string().min(1, 'Receipt Item ID is required'),
});

export const receiptIdParamSchema = z.object({
  receiptId: z.string().min(1, 'Receipt ID is required'),
});

export const downloadMultiplePOsPDFSchema = z.object({
  poIds: z
    .array(z.string().min(1, 'Invalid PO ID'))
    .min(1, 'At least one PO ID is required'),
});
