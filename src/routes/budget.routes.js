// src/routes/budget.routes.js
import { validate } from '../validations/index.js';
import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import {
    // Budget Core
    createBudget,
    getAllBudgets,
    getBudgetById,
    updateBudget,
    deleteBudget,
    updateBudgetStatus,
    getProjectBudgets,
    getActiveBudget,

    // Budget Categories
    getBudgetCategories,
    getBudgetCategoryById,
    addBudgetCategory,
    updateBudgetCategory,
    deleteBudgetCategory,
    transferBudgetAmount,

    // Budget Transactions
    getBudgetTransactions,
    getBudgetCommitments,
    getBudgetExpenses,
    createCommitment,
    createExpenseTransaction,
    transferBetweenCategories,
    updateTransactionStatus,
    convertCommitmentToExpense,

    // Budget Revisions
    getBudgetRevisions,
    createRevision,
    submitRevisionForApproval,
    approveRejectRevision,
    applyRevision,

    // Budget Alerts
    getBudgetAlerts,
    resolveAlert,

    // Budget Forecasts
    getBudgetForecasts,
    createForecast,
    getVarianceAnalysis,

    // Dashboard & Reports
    getBudgetSummary,
    getProjectBudgetStatus,
    getBudgetUtilizationReport,
    getBudgetVarianceReport,
    getCategorySpendingReport,
    getCommitmentTrackingReport,

    // Material Request Integration
    checkBudgetBeforeRequest,
    commitBudgetToRequest,
    getBudgetStatusForRequest,
    createPOFromRequest,

    // Approvals
    getPendingBudgetApprovals,
    approveBudget,
    rejectBudget,

    // Audit
    getBudgetAuditTrail,

    // Search
    searchBudgets
} from '../controllers/budget.controller.js';

import {
    createBudgetSchema,
    updateBudgetSchema,
    updateBudgetStatusSchema,
    getProjectBudgetsSchema,

    addBudgetCategorySchema,
    updateBudgetCategorySchema,
    transferBudgetAmountSchema,

    createCommitmentSchema,
    createExpenseTransactionSchema,
    transferBetweenCategoriesSchema,
    updateTransactionStatusSchema,
    convertCommitmentToExpenseSchema,

    createRevisionSchema,
    submitRevisionForApprovalSchema,
    approveRejectRevisionSchema,
    applyRevisionSchema,

    getBudgetAlertsSchema,
    resolveAlertSchema,

    createForecastSchema,
    getVarianceAnalysisSchema,

    getBudgetSummarySchema,
    getProjectBudgetStatusSchema,
    budgetUtilizationReportSchema,
    budgetVarianceReportSchema,
    categorySpendingReportSchema,
    commitmentTrackingReportSchema,

    checkBudgetBeforeRequestSchema,
    commitBudgetToRequestSchema,
    getBudgetStatusForRequestSchema,
    createPOFromRequestSchema,

    getPendingBudgetApprovalsSchema,
    approveBudgetSchema,
    rejectBudgetSchema,

    getBudgetAuditTrailSchema,

    searchBudgetsSchema,

    budgetIdParamSchema,
    categoryIdParamSchema,
    transactionIdParamSchema,
    revisionIdParamSchema,
    alertIdParamSchema,
    projectIdParamSchema,
    requestIdParamSchema,
    budgetIdPathParamSchema
} from '../validations/budget.validations.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// ==================== BUDGET CORE ROUTES ====================
router.post('/', validate(createBudgetSchema), createBudget);
router.get('/', getAllBudgets);
router.get('/search', validate(searchBudgetsSchema, 'query'), searchBudgets);

// Project-specific budgets (MUST come before /:id to avoid "projects" being matched as :id)
router.get('/projects/:projectId/budgets', validate(projectIdParamSchema, 'params'), validate(getProjectBudgetsSchema, 'query'), getProjectBudgets);
router.get('/projects/:projectId/active-budget', validate(projectIdParamSchema, 'params'), getActiveBudget);

// ==================== DASHBOARD & REPORTS ====================
// (MUST come before /:id to avoid "dashboard"/"reports" being matched as :id)
router.get('/dashboard/summary', validate(getBudgetSummarySchema, 'query'), getBudgetSummary);
router.get('/dashboard/project/:projectId/status', validate(projectIdParamSchema, 'params'), validate(getProjectBudgetStatusSchema, 'query'), getProjectBudgetStatus);
router.get('/reports/utilization', validate(budgetUtilizationReportSchema, 'query'), getBudgetUtilizationReport);
router.get('/reports/variance', validate(budgetVarianceReportSchema, 'query'), getBudgetVarianceReport);
router.get('/reports/category-spending', validate(categorySpendingReportSchema, 'query'), getCategorySpendingReport);
router.get('/reports/commitment-tracking', validate(commitmentTrackingReportSchema, 'query'), getCommitmentTrackingReport);

// ==================== MATERIAL REQUEST INTEGRATION ====================
// (MUST come before /:id to avoid "material-requests" being matched as :id)
router.get('/material-requests/budget-check', validate(checkBudgetBeforeRequestSchema, 'query'), checkBudgetBeforeRequest);
router.post('/material-requests/:requestId/commit-budget', validate(requestIdParamSchema, 'params'), validate(commitBudgetToRequestSchema), commitBudgetToRequest);
router.get('/material-requests/:requestId/budget-status', validate(requestIdParamSchema, 'params'), validate(getBudgetStatusForRequestSchema, 'query'), getBudgetStatusForRequest);
router.post('/material-requests/:requestId/create-po', validate(requestIdParamSchema, 'params'), validate(createPOFromRequestSchema), createPOFromRequest);

// ==================== APPROVAL ROUTES ====================
// (MUST come before /:id to avoid "approvals" being matched as :id)
router.get('/approvals/pending', validate(getPendingBudgetApprovalsSchema, 'query'), getPendingBudgetApprovals);
router.post('/approvals/:id/approve', approveBudget);
router.post('/approvals/:id/reject', validate(budgetIdParamSchema, 'params'), validate(rejectBudgetSchema), rejectBudget);

// ==================== AUDIT ROUTES ====================
// (MUST come before /:id to avoid "audit" being matched as :id)
router.get('/audit/:budgetId', validate(budgetIdPathParamSchema, 'params'), validate(getBudgetAuditTrailSchema, 'query'), getBudgetAuditTrail);

// ==================== BUDGET TRANSACTION ROUTES (literal paths) ====================
// (MUST come before /:id to avoid "transactions" being matched as :id)
router.post('/transactions/commit', validate(createCommitmentSchema), createCommitment);
router.post('/transactions/expense', validate(createExpenseTransactionSchema), createExpenseTransaction);
router.post('/transactions/transfer', validate(transferBetweenCategoriesSchema), transferBetweenCategories);
router.patch('/transactions/:transactionId/status', validate(transactionIdParamSchema, 'params'), validate(updateTransactionStatusSchema), updateTransactionStatus);
router.patch('/transactions/:transactionId/convert', validate(transactionIdParamSchema, 'params'), validate(convertCommitmentToExpenseSchema), convertCommitmentToExpense);

// ==================== WILDCARD :id ROUTES (must be LAST) ====================
// These use /:id or /:budgetId which match ANY single path segment,
// so they must come after all literal-prefix routes above.
router.get('/:id', validate(budgetIdParamSchema, 'params'), getBudgetById);
router.put('/:id', validate(budgetIdParamSchema, 'params'), validate(updateBudgetSchema), updateBudget);
router.delete('/:id', validate(budgetIdParamSchema, 'params'), deleteBudget);
router.patch('/:id/status', updateBudgetStatus);

// ==================== BUDGET CATEGORY ROUTES ====================
router.get('/:budgetId/categories', validate(budgetIdPathParamSchema, 'params'), getBudgetCategories);
router.get('/:budgetId/categories/:categoryId', validate(categoryIdParamSchema, 'params'), getBudgetCategoryById);
router.post('/:budgetId/categories', validate(budgetIdPathParamSchema, 'params'), validate(addBudgetCategorySchema), addBudgetCategory);
router.put('/:budgetId/categories/:categoryId', validate(categoryIdParamSchema, 'params'), validate(updateBudgetCategorySchema), updateBudgetCategory);
router.delete('/:budgetId/categories/:categoryId', validate(categoryIdParamSchema, 'params'), deleteBudgetCategory);
router.post('/:budgetId/categories/:categoryId/transfer', validate(categoryIdParamSchema, 'params'), validate(transferBudgetAmountSchema), transferBudgetAmount);

// ==================== BUDGET TRANSACTION ROUTES (parameterized) ====================
router.get('/:budgetId/transactions', validate(budgetIdPathParamSchema, 'params'), getBudgetTransactions);
router.get('/:budgetId/transactions/commitments', validate(budgetIdPathParamSchema, 'params'), getBudgetCommitments);
router.get('/:budgetId/transactions/expenses', validate(budgetIdPathParamSchema, 'params'), getBudgetExpenses);

// ==================== BUDGET REVISION ROUTES ====================
router.get('/:budgetId/revisions', validate(budgetIdPathParamSchema, 'params'), getBudgetRevisions);
router.post('/:budgetId/revisions', validate(budgetIdPathParamSchema, 'params'), validate(createRevisionSchema), createRevision);
router.post('/revisions/:revisionId/submit', validate(revisionIdParamSchema, 'params'), validate(submitRevisionForApprovalSchema), submitRevisionForApproval);
router.post('/revisions/:revisionId/approve-reject', validate(revisionIdParamSchema, 'params'), validate(approveRejectRevisionSchema), approveRejectRevision);
router.post('/revisions/:revisionId/apply', validate(revisionIdParamSchema, 'params'), validate(applyRevisionSchema), applyRevision);

// ==================== BUDGET ALERT ROUTES ====================
router.get('/:budgetId/alerts', validate(budgetIdPathParamSchema, 'params'), validate(getBudgetAlertsSchema, 'query'), getBudgetAlerts);
router.post('/alerts/:alertId/resolve', validate(alertIdParamSchema, 'params'), validate(resolveAlertSchema), resolveAlert);

// ==================== BUDGET FORECAST ROUTES ====================
router.get('/:budgetId/forecasts', validate(budgetIdPathParamSchema, 'params'), getBudgetForecasts);
router.post('/:budgetId/forecasts', validate(budgetIdPathParamSchema, 'params'), validate(createForecastSchema), createForecast);
router.get('/:budgetId/variance', validate(budgetIdPathParamSchema, 'params'), validate(getVarianceAnalysisSchema, 'query'), getVarianceAnalysis);

export default router;
