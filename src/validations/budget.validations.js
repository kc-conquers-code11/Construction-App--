import { z } from 'zod';

// Enums from schema
const BudgetStatus = z.enum([
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'ACTIVE',
  'LOCKED',
  'ARCHIVED',
]);
const BudgetCategory = z.enum([
  'MATERIAL',
  'LABOR',
  'SUBCONTRACTOR',
  'EQUIPMENT',
  'EQUIPMENT_RENTAL',
  'TRANSPORTATION',
  'PERMITS',
  'INSURANCE',
  'CONTINGENCY',
  'OVERHEAD',
  'TOOLS',
  'SAFETY',
  'QUALITY',
  'DESIGN',
  'CONSULTANCY',
  'UTILITIES',
  'FUEL',
  'FOOD',
  'ACCOMMODATION',
  'TRAVEL',
  'OFFICE_SUPPLIES',
  'COMMUNICATION',
  'LEGAL',
  'MARKETING',
  'TAXES',
  'OTHER',
]);
const BudgetPeriodType = z.enum([
  'MONTHLY',
  'QUARTERLY',
  'YEARLY',
  'PROJECT_PHASE',
  'CUSTOM',
]);
const BudgetTransactionType = z.enum([
  'INITIAL_ALLOCATION',
  'COMMITMENT',
  'EXPENSE',
  'REVISION',
  'TRANSFER',
  'ADJUSTMENT',
  'CONTINGENCY_RELEASE',
  'CANCELLATION',
]);
const BudgetTransactionStatus = z.enum([
  'PENDING',
  'COMMITTED',
  'DISBURSED',
  'CANCELLED',
  'REVERSED',
]);
const BudgetRevisionType = z.enum([
  'INCREASE',
  'DECREASE',
  'REALLOCATE',
  'EMERGENCY',
  'TIME_ADJUSTMENT',
  'SCOPE_CHANGE',
  'PRICE_ADJUSTMENT',
  'QUANTITY_ADJUSTMENT',
  'CONTINGENCY_RELEASE',
]);
const BudgetAlertType = z.enum([
  'THRESHOLD_WARNING',
  'CRITICAL_WARNING',
  'EXCEEDED',
  'FORECAST_WARNING',
  'REVISION_NEEDED',
  'CATEGORY_EXCEEDED',
  'TIME_EXCEEDED',
  'COMMITMENT_HIGH',
  'LOW_REMAINING',
]);
const BudgetAlertSeverity = z.enum(['INFO', 'WARNING', 'CRITICAL']);

// ==================== BUDGET CORE VALIDATIONS ====================

// Create budget validation
export const createBudgetSchema = z.object({
  budgetNo: z.string().optional(),
  projectId: z.string().min(1, 'Project ID is required'),
  name: z.string().min(1, 'Budget name is required'),
  description: z.string().optional(),
  version: z.number().int().positive().optional().default(1),
  status: BudgetStatus.optional().default('DRAFT'),
  budgetPeriod: BudgetPeriodType.optional().default('PROJECT_PHASE'),
  // Optional because the controller calculates this automatically
  totalApproved: z
    .number()
    .min(0, 'Total approved amount must be non-negative')
    .optional(),
  startDate: z.string().or(z.date()),
  endDate: z.string().or(z.date()).optional(),
  fiscalYear: z.number().int().optional(),
  contingencyPercent: z.number().min(0).max(100).optional().default(5),
  contingencyAmount: z.number().min(0).optional().default(0),
  // Optional because the controller safely injects this from req.user.userId
  requestedById: z.string().min(1, 'Requester ID is required').optional(),
  previousVersionId: z.string().optional(),

  // Optional categories array for bulk creation
  categories: z
    .array(
      z.object({
        category: BudgetCategory,
        subCategory: z.string().optional(),
        description: z.string().optional(),
        allocatedAmount: z
          .number()
          .min(0, 'Allocated amount must be non-negative'),
        isContingency: z.boolean().optional().default(false),
        parentCategoryId: z.string().optional(),
        warningThreshold: z.number().min(0).max(100).optional().default(80),
        criticalThreshold: z.number().min(0).max(100).optional().default(95),
      })
    )
    .optional(),
});

// Update budget validation
export const updateBudgetSchema = z.object({
  name: z.string().min(1, 'Budget name is required').optional(),
  description: z.string().optional(),
  status: BudgetStatus.optional(),
  budgetPeriod: BudgetPeriodType.optional(),
  totalApproved: z.number().min(0).optional(),
  startDate: z.string().or(z.date()).optional(),
  endDate: z.string().or(z.date()).optional(),
  fiscalYear: z.number().int().optional(),
  contingencyPercent: z.number().min(0).max(100).optional(),
  contingencyAmount: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
});

// Update budget status validation
export const updateBudgetStatusSchema = z.object({
  status: BudgetStatus,
  approvalNotes: z.string().optional(),
  rejectionReason: z.string().optional(),
});

// Get project budgets validation (Query parameters)
export const getProjectBudgetsSchema = z.object({
  projectId: z.string().optional(), // Handled by params middleware
  // Use z.coerce to parse "?includeInactive=true" strings from the URL safely
  includeInactive: z.coerce.boolean().optional().default(false),
});

// ==================== BUDGET CATEGORY VALIDATIONS ====================

// Add budget category validation
export const addBudgetCategorySchema = z.object({
  category: BudgetCategory,
  subCategory: z.string().optional(),
  description: z.string().optional(),
  allocatedAmount: z.number().min(0, 'Allocated amount must be non-negative'),
  isContingency: z.boolean().optional().default(false),
  parentCategoryId: z.string().optional(),
  warningThreshold: z.number().min(0).max(100).optional().default(80),
  criticalThreshold: z.number().min(0).max(100).optional().default(95),
  monthlyAllocation: z.record(z.string(), z.number()).optional(),
  quarterlyAllocation: z.record(z.string(), z.number()).optional(),
});

// Update budget category validation
export const updateBudgetCategorySchema = z.object({
  description: z.string().optional(),
  allocatedAmount: z.number().min(0).optional(),
  isContingency: z.boolean().optional(),
  warningThreshold: z.number().min(0).max(100).optional(),
  criticalThreshold: z.number().min(0).max(100).optional(),
  monthlyAllocation: z.record(z.string(), z.number()).optional(),
  quarterlyAllocation: z.record(z.string(), z.number()).optional(),
});

// Transfer budget amount validation
export const transferBudgetAmountSchema = z.object({
  toCategoryId: z.string().min(1, 'Destination category ID is required'),
  amount: z.number().positive('Transfer amount must be positive'),
  reason: z.string().optional(),
  notes: z.string().optional(),
});

// ==================== BUDGET TRANSACTION VALIDATIONS ====================

// Create commitment validation
export const createCommitmentSchema = z.object({
  budgetId: z.string().min(1, 'Budget ID is required'),
  categoryId: z.string().min(1, 'Category ID is required'),
  description: z.string().min(1, 'Description is required'),
  amount: z.number().positive('Amount must be positive'),
  referenceType: z
    .enum([
      'EXPENSE',
      'MATERIAL_REQUEST',
      'PURCHASE_ORDER',
      'CONTRACTOR_PAYMENT',
      'PAYROLL',
    ])
    .optional(),
  referenceId: z.string().optional(),
  referenceNo: z.string().optional(),
  materialRequestId: z.string().optional(),
});

// Create expense transaction validation
export const createExpenseTransactionSchema = z.object({
  budgetId: z.string().min(1, 'Budget ID is required'),
  categoryId: z.string().min(1, 'Category ID is required'),
  description: z.string().min(1, 'Description is required'),
  amount: z.number().positive('Amount must be positive'),
  taxAmount: z.number().min(0).optional().default(0),
  referenceType: z
    .enum([
      'EXPENSE',
      'MATERIAL_REQUEST',
      'PURCHASE_ORDER',
      'CONTRACTOR_PAYMENT',
      'PAYROLL',
      'GENERAL', // Added to support direct generic expenses
    ])
    .optional(),
  referenceId: z.string().optional(), // Optional for generic expenses
  referenceNo: z.string().optional(),
  expenseId: z.string().optional(),
});

// Transfer between categories validation
export const transferBetweenCategoriesSchema = z.object({
  budgetId: z.string().min(1, 'Budget ID is required'),
  fromCategoryId: z.string().min(1, 'Source category ID is required'),
  toCategoryId: z.string().min(1, 'Destination category ID is required'),
  amount: z.number().positive('Transfer amount must be positive'),
  description: z.string().optional(),
});

// Update transaction status validation
export const updateTransactionStatusSchema = z.object({
  status: BudgetTransactionStatus,
  notes: z.string().optional(),
});

// Convert commitment to expense validation
export const convertCommitmentToExpenseSchema = z.object({
  // commitmentId is handled via req.params.transactionId
  actualAmount: z
    .number()
    .positive('Actual amount must be positive')
    .optional(),
  taxAmount: z.number().min(0).optional(),
  expenseId: z.string().optional(),
});

// ==================== BUDGET REVISION VALIDATIONS ====================

// Create revision validation
export const createRevisionSchema = z.object({
  revisionType: BudgetRevisionType,
  reason: z.string().min(1, 'Reason is required'),
  description: z.string().optional(),
  previousTotal: z.number().min(0),
  newTotal: z.number().min(0),
  changeAmount: z.number(),
  categoryChanges: z.record(
    z.string(),
    z.object({
      previous: z.number(),
      new: z.number(),
      change: z.number(),
      reason: z.string().optional(),
    })
  ),
  supportingData: z.record(z.string(), z.any()).optional(),
  effectiveDate: z.string().or(z.date()),
  documents: z
    .array(
      z.object({
        title: z.string(),
        fileUrl: z.string().url(),
        documentType: z.string().optional(),
      })
    )
    .optional(),
});

// Submit revision for approval validation
export const submitRevisionForApprovalSchema = z.object({
  revisionId: z.string().optional(),
  comments: z.string().optional(),
});

// Approve/reject revision validation
export const approveRejectRevisionSchema = z
  .object({
    approved: z.boolean({
      required_error: 'Approval status (true/false) is required',
      invalid_type_error: 'Approved must be a boolean',
    }),
    approvalNotes: z.string().optional(),
    rejectionReason: z.string().optional(),
  })
  .refine(
    (data) => {
      // If not approved, rejection reason must be provided
      if (
        !data.approved &&
        (!data.rejectionReason || data.rejectionReason.trim() === '')
      ) {
        return false;
      }
      return true;
    },
    {
      message: 'Rejection reason is required when rejecting a revision',
      path: ['rejectionReason'],
    }
  );

// Apply revision validation
export const applyRevisionSchema = z.object({
  revisionId: z.string().optional(),
  appliedAt: z.string().optional(),
  notes: z.string().optional(),
});

// ==================== BUDGET ALERT VALIDATIONS ====================

// Get budget alerts validation (Query parameters)
export const getBudgetAlertsSchema = z.object({
  budgetId: z.string().optional(), // Handled by params middleware
  includeResolved: z.coerce.boolean().optional().default(false),
  severity: BudgetAlertSeverity.optional(),
  alertType: BudgetAlertType.optional(),
});

// Resolve alert validation
export const resolveAlertSchema = z.object({
  alertId: z.string().min(1, 'Alert ID is required'),
  resolutionNotes: z.string().optional(),
  resolutionAction: z.string().optional(),
  revisionCreatedId: z.string().optional(),
});

// ==================== BUDGET FORECAST VALIDATIONS ====================

// Create forecast validation
export const createForecastSchema = z.object({
  forecastMonth: z.string().or(z.date()),
  forecastAmount: z.number().positive('Forecast amount must be positive'),
  confidenceLevel: z.number().min(0).max(100).optional().default(80),
  categoryForecasts: z.record(z.string(), z.number()).optional(),
  forecastMethod: z
    .enum(['HISTORICAL_AVG', 'MANUAL', 'PROJECTION', 'AI_GENERATED'])
    .optional(),
  forecastFactors: z.record(z.string(), z.any()).optional(),
});

// Get variance analysis validation (Query parameters)
export const getVarianceAnalysisSchema = z.object({
  budgetId: z.string().optional(), // Handled by params middleware
  fromDate: z.string().or(z.date()).optional(),
  toDate: z.string().or(z.date()).optional(),
  category: BudgetCategory.optional(),
});

// ==================== MATERIAL REQUEST INTEGRATION VALIDATIONS ====================

// Check budget before request validation (Query parameters)
export const checkBudgetBeforeRequestSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  category: BudgetCategory,
  amount: z.coerce.number().positive('Amount must be positive'),
  requestId: z.string().optional(),
});

// Commit budget to request validation
export const commitBudgetToRequestSchema = z.object({
  budgetId: z.string().min(1, 'Budget ID is required'),
  categoryId: z.string().min(1, 'Category ID is required'),
  estimatedCost: z.number().positive('Estimated cost must be positive'),
  notes: z.string().optional(),
});

// Get budget status for request validation (Query parameters)
export const getBudgetStatusForRequestSchema = z.object({
  requestId: z.string().optional(), // Handled by params middleware
});

// Create PO from request validation
export const createPOFromRequestSchema = z.object({
  poData: z.object({
    supplierId: z.string().min(1, 'Supplier ID is required'),
    expectedDelivery: z.string().or(z.date()).optional(),
    deliveryAddress: z.string().optional(),
    paymentTerm: z.string().optional(),
    amount: z.number().min(0).optional(),
    taxPercent: z.number().min(0).max(100).optional(),
    taxAmount: z.number().min(0).optional(),

    // Legacy/compat fields (ignored if supplierId is provided)
    supplierName: z.string().optional(),
    supplierAddress: z.string().optional(),
    supplierGST: z.string().optional(),
    supplierContact: z.string().optional(),
    supplierEmail: z.string().optional(),
    supplierPhone: z.string().optional(),
  }),
});

// ==================== APPROVAL VALIDATIONS ====================

// Get pending budget approvals validation (Query parameters)
export const getPendingBudgetApprovalsSchema = z.object({
  projectId: z.string().optional(),
  companyId: z.string().optional(),
  fromDate: z.string().or(z.date()).optional(),
  toDate: z.string().or(z.date()).optional(),
});

// Approve budget validation
export const approveBudgetSchema = z.object({
  budgetId: z.string().optional(), // Handled by params middleware
  approvalNotes: z.string().optional(),
});

// Reject budget validation
export const rejectBudgetSchema = z.object({
  budgetId: z.string().optional(), // Handled by params middleware
  rejectionReason: z.string().min(1, 'Rejection reason is required'),
});

// ==================== REPORT QUERY VALIDATIONS ====================

// Budget summary validation
export const getBudgetSummarySchema = z.object({
  projectId: z.string().optional(),
  companyId: z.string().optional(),
  fromDate: z.string().or(z.date()).optional(),
  toDate: z.string().or(z.date()).optional(),
});

// Project budget status validation
export const getProjectBudgetStatusSchema = z.object({
  projectId: z.string().optional(), // Handled by params middleware
  includeDetails: z.coerce.boolean().optional().default(false),
});

// Budget utilization report validation
export const budgetUtilizationReportSchema = z.object({
  projectId: z.string().optional(),
  companyId: z.string().optional(),
  startDate: z.string().or(z.date()).optional(),
  endDate: z.string().or(z.date()).optional(),
  category: BudgetCategory.optional(),
  groupBy: z.enum(['category', 'month', 'quarter', 'project']).optional(),
  format: z.enum(['json', 'csv', 'pdf']).optional().default('json'),
});

// Budget variance report validation
export const budgetVarianceReportSchema = z.object({
  projectId: z.string().optional(),
  budgetId: z.string().optional(),
  period: z
    .enum(['monthly', 'quarterly', 'yearly'])
    .optional()
    .default('monthly'),
  fromDate: z.string().or(z.date()).optional(),
  toDate: z.string().or(z.date()).optional(),
  format: z.enum(['json', 'csv', 'pdf']).optional().default('json'),
});

// Category spending report validation
export const categorySpendingReportSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  fromDate: z.string().or(z.date()),
  toDate: z.string().or(z.date()),
  category: BudgetCategory.optional(),
  groupBy: z.enum(['day', 'week', 'month']).optional().default('month'),
  format: z.enum(['json', 'csv', 'pdf']).optional().default('json'),
});

// Commitment tracking report validation
export const commitmentTrackingReportSchema = z.object({
  projectId: z.string().optional(),
  budgetId: z.string().optional(),
  status: z.enum(['PENDING', 'COMMITTED', 'DISBURSED', 'CANCELLED']).optional(),
  fromDate: z.string().or(z.date()).optional(),
  toDate: z.string().or(z.date()).optional(),
  format: z.enum(['json', 'csv', 'pdf']).optional().default('json'),
});

// ==================== AUDIT VALIDATIONS ====================

// Get budget audit trail validation (Query parameters)
export const getBudgetAuditTrailSchema = z.object({
  budgetId: z.string().optional(), // Handled by params middleware
  fromDate: z.string().or(z.date()).optional(),
  toDate: z.string().or(z.date()).optional(),
  actions: z.array(z.string()).optional(),
  limit: z.coerce.number().int().positive().optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// ==================== SEARCH VALIDATIONS ====================

// Search budgets validation (Query parameters)
export const searchBudgetsSchema = z.object({
  q: z.string().optional(), // Changed to 'q' to match the controller extraction
  projectId: z.string().optional(),
  companyId: z.string().optional(),
  status: BudgetStatus.optional(),
  fromDate: z.string().or(z.date()).optional(),
  toDate: z.string().or(z.date()).optional(),
  minAmount: z.coerce.number().min(0).optional(),
  maxAmount: z.coerce.number().min(0).optional(),
  category: BudgetCategory.optional(),
  limit: z.coerce.number().int().positive().optional().default(10),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// ==================== ID PARAM VALIDATIONS ====================

// Validate budget ID param
export const budgetIdParamSchema = z.object({
  id: z.string().min(1, 'Budget ID is required'),
});

// Validate category ID param
export const categoryIdParamSchema = z.object({
  budgetId: z.string().min(1, 'Budget ID is required'),
  categoryId: z.string().min(1, 'Category ID is required'),
});

// Validate transaction ID param
export const transactionIdParamSchema = z.object({
  transactionId: z.string().min(1, 'Transaction ID is required'),
});

// Validate revision ID param
export const revisionIdParamSchema = z.object({
  revisionId: z.string().min(1, 'Revision ID is required'),
});

// Validate alert ID param
export const alertIdParamSchema = z.object({
  alertId: z.string().min(1, 'Alert ID is required'),
});

// Validate project ID param
export const projectIdParamSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
});

// Validate request ID param
export const requestIdParamSchema = z.object({
  requestId: z.string().min(1, 'Request ID is required'),
});

// Validate budget ID param (alternative name)
export const budgetIdPathParamSchema = z.object({
  budgetId: z.string().min(1, 'Budget ID is required'),
});
