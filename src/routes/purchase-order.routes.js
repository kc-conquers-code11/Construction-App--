// src/routes/purchaseOrder.routes.js
import { validate } from '../validations/index.js';
import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import {
    createPurchaseOrder,
    getAllPurchaseOrders,
    getPurchaseOrderById,
    updatePurchaseOrder,
    deletePurchaseOrder,
    getProjectPurchaseOrders,
    getSupplierPurchaseOrders,
    submitPOForApproval,
    approveRejectPO,
    markAsOrdered,
    markAsReceived,
    cancelPO,
    closePO,
    getPOItems,
    getPOItemById,
    addPOItem,
    updatePOItem,
    removePOItem,
    updateReceivedQuantity,
    closePOItem,
    createGoodsReceipt,
    getGoodsReceiptById,
    getPOGoodsReceipts,
    quickReceivePO,
    acceptAllItems,
    rejectAllItems,
    updateStockFromReceipt,
    getReceiptItems,
    addReceiptItem,
    updateReceiptItem,
    removeReceiptItem,
    acceptReceiptItem,
    rejectReceiptItem,
    returnReceiptItem,
    createPOPayment,
    getPOPaymentById,
    getPOPayments,
    recordAdvancePayment,
    recordFinalPayment,
    approvePOPayment,
    getPODocuments,
    uploadPODocument,
    deletePODocument,
    getPOComments,
    addPOComment,
    updatePOComment,
    deletePOComment,
    getPOHistory,
    getPOTimeline,
    getPendingPOApprovals,
    approvePO,
    rejectPO,
    getPOAuditTrail,
    searchPurchaseOrders,
    downloadPurchaseOrderPDF,
    previewPurchaseOrderPDF,
    downloadMultiplePOsPDF,
    downloadGRNPDF,
    previewGRNPDF
} from '../controllers/purchaseOrder.controller.js';

import {
    createPurchaseOrderSchema,
    updatePurchaseOrderSchema,
    submitPOForApprovalSchema,
    approveRejectPOSchema,
    markAsOrderedSchema,
    markAsReceivedSchema,
    cancelPOSchema,
    closePOSchema,

    addPOItemSchema,
    updatePOItemSchema,
    updateReceivedQuantitySchema,
    closePOItemSchema,

    createGoodsReceiptSchema,
    quickReceivePOSchema,
    acceptAllItemsSchema,
    rejectAllItemsSchema,
    updateStockFromReceiptSchema,

    addReceiptItemSchema,
    updateReceiptItemSchema,
    acceptReceiptItemSchema,
    rejectReceiptItemSchema,
    returnReceiptItemSchema,

    createPOPaymentSchema,
    recordAdvancePaymentSchema,
    recordFinalPaymentSchema,
    approvePOPaymentSchema,

    uploadPODocumentSchema,
    deletePODocumentSchema,

    addPOCommentSchema,
    updatePOCommentSchema,
    deletePOCommentSchema,

    approvePOSchema,
    rejectPOSchema,

    searchPurchaseOrdersSchema,

    poIdParamSchema,
    purchaseOrderIdParamSchema,
    projectIdParamSchema,
    supplierIdParamSchema,
    itemIdParamSchema,
    receiptIdParamSchema,
    paymentIdParamSchema,
    documentIdParamSchema,
    commentIdParamSchema,
    receiptItemIdParamSchema,
    downloadMultiplePOsPDFSchema
} from '../validations/purchaseOrder.validations.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// ==================== PURCHASE ORDER CORE ROUTES ====================

// PO CRUD
router.post('/', validate(createPurchaseOrderSchema), createPurchaseOrder);
router.get('/', getAllPurchaseOrders);
router.get('/search', validate(searchPurchaseOrdersSchema, 'query'), searchPurchaseOrders);
router.get('/:id', validate(poIdParamSchema, 'params'), getPurchaseOrderById);
router.put('/:id', validate(poIdParamSchema, 'params'), validate(updatePurchaseOrderSchema), updatePurchaseOrder);
router.delete('/:id', validate(poIdParamSchema, 'params'), deletePurchaseOrder);

// Project & Supplier specific
router.get('/projects/:projectId', validate(projectIdParamSchema, 'params'), getProjectPurchaseOrders);
router.get('/suppliers/:supplierId', validate(supplierIdParamSchema, 'params'), getSupplierPurchaseOrders);

// PO Workflow
router.post('/:id/submit', validate(poIdParamSchema, 'params'), validate(submitPOForApprovalSchema), submitPOForApproval);
router.post('/:id/approve-reject', validate(poIdParamSchema, 'params'), validate(approveRejectPOSchema), approveRejectPO);
router.post('/:id/order', validate(poIdParamSchema, 'params'), validate(markAsOrderedSchema), markAsOrdered);
router.post('/:id/receive', validate(poIdParamSchema, 'params'), validate(markAsReceivedSchema), markAsReceived);
router.post('/:id/cancel', validate(poIdParamSchema, 'params'), validate(cancelPOSchema), cancelPO);
router.post('/:id/close', validate(poIdParamSchema, 'params'), validate(closePOSchema), closePO);

// ==================== PURCHASE ORDER ITEM ROUTES ====================

// PO Item Management
router.get('/:poId/items', validate(purchaseOrderIdParamSchema, 'params'), getPOItems);
router.get('/items/:itemId', validate(itemIdParamSchema, 'params'), getPOItemById);
router.post('/:poId/items', validate(purchaseOrderIdParamSchema, 'params'), validate(addPOItemSchema), addPOItem);
router.put('/items/:itemId', validate(itemIdParamSchema, 'params'), validate(updatePOItemSchema), updatePOItem);
router.delete('/items/:itemId', validate(itemIdParamSchema, 'params'), removePOItem);

// PO Item Workflow
router.patch('/items/:itemId/receive', validate(itemIdParamSchema, 'params'), validate(updateReceivedQuantitySchema), updateReceivedQuantity);
router.patch('/items/:itemId/close', validate(itemIdParamSchema, 'params'), validate(closePOItemSchema), closePOItem);

// ==================== GOODS RECEIPT ROUTES ====================

// Goods Receipt CRUD
router.post('/goods-receipts', validate(createGoodsReceiptSchema), createGoodsReceipt);
router.get('/goods-receipts/:receiptId', validate(receiptIdParamSchema, 'params'), getGoodsReceiptById);

// PO-specific Receipts
router.get('/:poId/goods-receipts', validate(purchaseOrderIdParamSchema, 'params'), getPOGoodsReceipts);
router.post('/:poId/quick-receive', validate(purchaseOrderIdParamSchema, 'params'), validate(quickReceivePOSchema), quickReceivePO);

// Receipt Workflow
router.post('/goods-receipts/:receiptId/accept-all', validate(receiptIdParamSchema, 'params'), validate(acceptAllItemsSchema), acceptAllItems);
router.post('/goods-receipts/:receiptId/reject-all', validate(receiptIdParamSchema, 'params'), validate(rejectAllItemsSchema), rejectAllItems);
router.post('/goods-receipts/:receiptId/update-stock', validate(receiptIdParamSchema, 'params'), validate(updateStockFromReceiptSchema), updateStockFromReceipt);

// ==================== GOODS RECEIPT ITEM ROUTES ====================

// Receipt Item Management
router.get('/goods-receipts/:receiptId/items', validate(receiptIdParamSchema, 'params'), getReceiptItems);
router.post('/goods-receipts/:receiptId/items', validate(receiptIdParamSchema, 'params'), validate(addReceiptItemSchema), addReceiptItem);
router.put('/goods-receipt-items/:itemId', validate(receiptItemIdParamSchema, 'params'), validate(updateReceiptItemSchema), updateReceiptItem);
router.delete('/goods-receipt-items/:itemId', validate(receiptItemIdParamSchema, 'params'), removeReceiptItem);

// Receipt Item Workflow
router.patch('/goods-receipt-items/:itemId/accept', validate(receiptItemIdParamSchema, 'params'), validate(acceptReceiptItemSchema), acceptReceiptItem);
router.patch('/goods-receipt-items/:itemId/reject', validate(receiptItemIdParamSchema, 'params'), validate(rejectReceiptItemSchema), rejectReceiptItem);
router.patch('/goods-receipt-items/:itemId/return', validate(receiptItemIdParamSchema, 'params'), validate(returnReceiptItemSchema), returnReceiptItem);

// ==================== PURCHASE ORDER PAYMENT ROUTES ====================

// PO Payment CRUD
router.post('/payments', validate(createPOPaymentSchema), createPOPayment);
router.get('/payments/:paymentId', validate(paymentIdParamSchema, 'params'), getPOPaymentById);

// PO-specific Payments
router.get('/:poId/payments', validate(purchaseOrderIdParamSchema, 'params'), getPOPayments);
router.post('/:poId/advance', validate(purchaseOrderIdParamSchema, 'params'), validate(recordAdvancePaymentSchema), recordAdvancePayment);
router.post('/:poId/final-payment', validate(purchaseOrderIdParamSchema, 'params'), validate(recordFinalPaymentSchema), recordFinalPayment);

// Payment Workflow
router.patch('/payments/:paymentId/approve', validate(paymentIdParamSchema, 'params'), validate(approvePOPaymentSchema), approvePOPayment);

// ==================== PURCHASE ORDER DOCUMENT ROUTES ====================

// PO Documents
router.get('/:poId/documents', validate(purchaseOrderIdParamSchema, 'params'), getPODocuments);
router.post('/:poId/documents', validate(purchaseOrderIdParamSchema, 'params'), validate(uploadPODocumentSchema), uploadPODocument);
router.delete('/documents/:documentId', validate(documentIdParamSchema, 'params'), validate(deletePODocumentSchema), deletePODocument);

// ==================== PURCHASE ORDER COMMENT ROUTES ====================

// PO Comments
router.get('/:poId/comments', validate(purchaseOrderIdParamSchema, 'params'), getPOComments);
router.post('/:poId/comments', validate(purchaseOrderIdParamSchema, 'params'), validate(addPOCommentSchema), addPOComment);
router.put('/comments/:commentId', validate(commentIdParamSchema, 'params'), validate(updatePOCommentSchema), updatePOComment);
router.delete('/comments/:commentId', validate(commentIdParamSchema, 'params'), validate(deletePOCommentSchema), deletePOComment);

// ==================== PURCHASE ORDER HISTORY ROUTES ====================

// PO History
router.get('/:poId/history', validate(purchaseOrderIdParamSchema, 'params'), getPOHistory);
router.get('/:poId/timeline', validate(purchaseOrderIdParamSchema, 'params'), getPOTimeline);

// ==================== APPROVAL ROUTES ====================
router.get('/approvals/pending', getPendingPOApprovals);
router.post('/approvals/:id/approve', validate(poIdParamSchema, 'params'), validate(approvePOSchema), approvePO);
router.post('/approvals/:id/reject', validate(poIdParamSchema, 'params'), validate(rejectPOSchema), rejectPO);

// ==================== AUDIT ROUTES ====================
router.get('/audit/:poId', validate(purchaseOrderIdParamSchema, 'params'), getPOAuditTrail);

// PDF routes
router.post('/pdf/bulk-download', validate(downloadMultiplePOsPDFSchema), downloadMultiplePOsPDF);
router.get('/:id/pdf', validate(poIdParamSchema, 'params'), downloadPurchaseOrderPDF);
router.get('/:id/pdf/preview', validate(poIdParamSchema, 'params'), previewPurchaseOrderPDF);

// GRN PDF routes
router.get('/goods-receipts/:id/pdf', validate(poIdParamSchema, 'params'), downloadGRNPDF);
router.get('/goods-receipts/:id/pdf/preview', validate(poIdParamSchema, 'params'), previewGRNPDF);

export default router;