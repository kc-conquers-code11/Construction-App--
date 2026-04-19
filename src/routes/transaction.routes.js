import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../validations/index.js';
import {
  approveTransactionSchema,
  createTransactionSchema,
  listTransactionsQuerySchema,
  projectIdParamSchema,
  rejectTransactionSchema,
  summaryQuerySchema,
  transactionIdParamSchema,
  updateTransactionSchema,
  voidTransactionSchema,
} from '../validations/transaction.validations.js';
import {
  approveTransactionEntry,
  createTransactionEntry,
  getProjectCashboxBalance,
  getProjectCashboxStatement,
  getProjectTransactionSummary,
  getTransactionById,
  getTransactions,
  rejectTransactionEntry,
  updateTransactionEntry,
  voidTransactionEntry,
} from '../controllers/transaction.controller.js';

const router = express.Router();

router.use(authenticate);

router.post('/', validate(createTransactionSchema), createTransactionEntry);
router.get('/', validate(listTransactionsQuerySchema, 'query'), getTransactions);

router.get(
  '/summary/project/:projectId',
  validate(projectIdParamSchema, 'params'),
  validate(summaryQuerySchema, 'query'),
  getProjectTransactionSummary
);
router.get(
  '/cashbox/project/:projectId',
  validate(projectIdParamSchema, 'params'),
  getProjectCashboxBalance
);
router.get(
  '/cashbox/project/:projectId/statement',
  validate(projectIdParamSchema, 'params'),
  validate(summaryQuerySchema, 'query'),
  getProjectCashboxStatement
);

router.get('/:id', validate(transactionIdParamSchema, 'params'), getTransactionById);
router.put(
  '/:id',
  validate(transactionIdParamSchema, 'params'),
  validate(updateTransactionSchema),
  updateTransactionEntry
);
router.patch(
  '/:id/approve',
  validate(transactionIdParamSchema, 'params'),
  validate(approveTransactionSchema),
  approveTransactionEntry
);
router.patch(
  '/:id/reject',
  validate(transactionIdParamSchema, 'params'),
  validate(rejectTransactionSchema),
  rejectTransactionEntry
);
router.patch(
  '/:id/void',
  validate(transactionIdParamSchema, 'params'),
  validate(voidTransactionSchema),
  voidTransactionEntry
);

export default router;
