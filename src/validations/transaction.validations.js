import { z } from 'zod';

const TransactionType = z.enum([
  'INCOME',
  'EXPENSE',
  'PETTY_CASH_ISSUE',
  'PETTY_CASH_SETTLEMENT',
  'PETTY_CASH_REPLENISHMENT',
]);

const TransactionStatus = z.enum([
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'VOIDED',
]);

const TransactionSourceType = z.enum([
  'DIRECT',
  'INVOICE',
  'PAYMENT',
  'BUDGET',
  'PURCHASE_ORDER',
  'CONTRACTOR_PAYMENT',
  'PAYROLL',
  'PETTY_CASH',
]);

// ==================== TRANSACTION CORE VALIDATIONS ====================

export const createTransactionSchema = z
  .object({
    projectId: z.string().min(1, 'Project ID is required'),
    type: TransactionType,
    amount: z.number().positive('Amount must be positive'),
    taxAmount: z.number().min(0).optional().nullable().default(0),
    totalAmount: z.number().positive().optional().nullable(),
    currency: z.string().optional().nullable().default('INR'),
    transactionDate: z.string().or(z.date()).optional().nullable(),
    description: z.string().optional().nullable(),
    category: z.string().optional().nullable(),
    counterpartyName: z.string().optional().nullable(),
    invoiceId: z.string().optional().nullable(),
    paymentId: z.string().optional().nullable(),
    budgetId: z.string().optional().nullable(),
    budgetCategoryId: z.string().optional().nullable(),
    purchaseOrderId: z.string().optional().nullable(),
    contractorPaymentId: z.string().optional().nullable(),
    payrollId: z.string().optional().nullable(),
    cashboxId: z.string().optional().nullable(),
    sourceType: TransactionSourceType.optional().nullable().default('DIRECT'),
    sourceId: z.string().optional().nullable(),
    referenceNo: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    // Allow empty string, valid URL, or null
    attachmentUrl: z.string().url().or(z.literal('')).optional().nullable(),
  })
  .refine(
    (data) =>
      (!data.budgetId && !data.budgetCategoryId) ||
      (data.budgetId && data.budgetCategoryId),
    {
      message:
        'budgetId and budgetCategoryId must be provided together for budget synchronization',
      path: ['budgetCategoryId'],
    }
  );

export const updateTransactionSchema = z
  .object({
    amount: z.number().positive().optional().nullable(),
    taxAmount: z.number().min(0).optional().nullable(),
    totalAmount: z.number().positive().optional().nullable(),
    currency: z.string().optional().nullable(),
    transactionDate: z.string().or(z.date()).optional().nullable(),
    description: z.string().min(1).optional().nullable(),
    category: z.string().optional().nullable(),
    counterpartyName: z.string().optional().nullable(),
    invoiceId: z.string().optional().nullable(),
    paymentId: z.string().optional().nullable(),
    budgetId: z.string().optional().nullable(),
    budgetCategoryId: z.string().optional().nullable(),
    purchaseOrderId: z.string().optional().nullable(),
    contractorPaymentId: z.string().optional().nullable(),
    payrollId: z.string().optional().nullable(),
    cashboxId: z.string().optional().nullable(),
    sourceType: TransactionSourceType.optional().nullable(),
    sourceId: z.string().optional().nullable(),
    referenceNo: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    attachmentUrl: z.string().url().or(z.literal('')).optional().nullable(),
  })
  .refine(
    (data) =>
      (!data.budgetId && !data.budgetCategoryId) ||
      (data.budgetId && data.budgetCategoryId),
    {
      message: 'budgetId and budgetCategoryId must be provided together',
      path: ['budgetCategoryId'],
    }
  );

// ==================== APPROVAL VALIDATIONS ====================

export const approveTransactionSchema = z.object({
  // Added .nullable() to fix the ZodError: expected string, received null
  approvalNotes: z.string().optional().nullable(),
});

export const rejectTransactionSchema = z.object({
  // Added .nullable() to handle null inputs from mobile clients
  rejectionReason: z
    .string()
    .min(1, 'Rejection reason is required')
    .optional()
    .nullable(),
});

export const voidTransactionSchema = z.object({
  // Added .nullable() to handle null inputs from mobile clients
  voidReason: z
    .string()
    .min(1, 'Void reason is required')
    .optional()
    .nullable(),
});

// ==================== QUERY VALIDATIONS ====================

export const listTransactionsQuerySchema = z.object({
  projectId: z.string().optional().nullable(),
  type: TransactionType.optional().nullable(),
  status: TransactionStatus.optional().nullable(),
  sourceType: TransactionSourceType.optional().nullable(),
  fromDate: z.string().or(z.date()).optional().nullable(),
  toDate: z.string().or(z.date()).optional().nullable(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

export const summaryQuerySchema = z.object({
  fromDate: z.string().or(z.date()).optional().nullable(),
  toDate: z.string().or(z.date()).optional().nullable(),
});

// ==================== ID PARAM VALIDATIONS ====================

export const transactionIdParamSchema = z.object({
  id: z.string().min(1, 'Transaction ID is required'),
});

export const projectIdParamSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
});
