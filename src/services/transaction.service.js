import prisma from '../config/database.js';
import { recalculateBudgetSummary } from './budget.service.js';

const buildTotalAmount = (amount, taxAmount = 0, explicitTotalAmount) => {
  if (typeof explicitTotalAmount === 'number') return explicitTotalAmount;
  return amount + (taxAmount || 0);
};

const getPettyCashDelta = (type, totalAmount) => {
  if (type === 'PETTY_CASH_ISSUE') return -totalAmount;
  if (type === 'PETTY_CASH_SETTLEMENT') return totalAmount;
  if (type === 'PETTY_CASH_REPLENISHMENT') return totalAmount;
  return 0;
};

const isPettyCashType = (type) =>
  type === 'PETTY_CASH_ISSUE' ||
  type === 'PETTY_CASH_SETTLEMENT' ||
  type === 'PETTY_CASH_REPLENISHMENT';

// Privatized summary helper is now replaced by the shared budget service

const ensureProject = async (projectId, companyId) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId },
    select: { id: true, companyId: true },
  });

  if (!project) {
    throw new Error('Project not found');
  }

  return project;
};

const ensureOrCreateCashbox = async (tx, transaction, userId) => {
  if (!isPettyCashType(transaction.type)) return null;

  if (transaction.cashboxId) {
    const existing = await tx.projectCashbox.findFirst({
      where: {
        id: transaction.cashboxId,
        projectId: transaction.projectId,
        companyId: transaction.companyId,
        isActive: true,
      },
    });
    if (!existing) throw new Error('Project cashbox not found');
    return existing;
  }

  return tx.projectCashbox.upsert({
    where: { projectId: transaction.projectId },
    create: {
      projectId: transaction.projectId,
      companyId: transaction.companyId,
      createdById: userId,
    },
    update: {},
  });
};

const applyCashboxDelta = async (tx, cashboxId, delta) => {
  const cashbox = await tx.projectCashbox.findUnique({ where: { id: cashboxId } });
  if (!cashbox) throw new Error('Project cashbox not found');

  const updatedBalance = cashbox.currentBalance + delta;
  if (updatedBalance < 0) {
    throw new Error('Insufficient petty cash balance');
  }

  return tx.projectCashbox.update({
    where: { id: cashboxId },
    data: { currentBalance: updatedBalance },
  });
};

const syncBudgetOnApprove = async (tx, transaction, userId) => {
  if (transaction.type !== 'EXPENSE') return null;
  if (!transaction.budgetId || !transaction.budgetCategoryId) return null;

  const budget = await tx.budget.findFirst({
    where: {
      id: transaction.budgetId,
      projectId: transaction.projectId,
      companyId: transaction.companyId,
      status: 'ACTIVE',
    },
  });

  if (!budget) {
    throw new Error('Active budget not found for expense sync');
  }

  const category = await tx.budgetCategoryAllocation.findFirst({
    where: {
      id: transaction.budgetCategoryId,
      budgetId: transaction.budgetId,
    },
  });

  if (!category) {
    throw new Error('Budget category not found for expense sync');
  }

  if (category.remainingAmount < transaction.totalAmount) {
    throw new Error(
      `Insufficient budget remaining amount: ${category.remainingAmount}`
    );
  }

  await tx.budgetCategoryAllocation.update({
    where: { id: category.id },
    data: {
      spentAmount: { increment: transaction.totalAmount },
      remainingAmount: { decrement: transaction.totalAmount },
    },
  });

  const budgetTransaction = await tx.budgetTransaction.create({
    data: {
      transactionNo: `EXP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      budgetId: transaction.budgetId,
      categoryId: category.id,
      transactionType: 'EXPENSE',
      status: 'DISBURSED',
      description: transaction.description,
      amount: transaction.amount,
      taxAmount: transaction.taxAmount,
      totalAmount: transaction.totalAmount,
      referenceType: 'TRANSACTION',
      referenceId: transaction.id,
      referenceNo: transaction.transactionNo,
      transactionDate: new Date(),
      disbursedDate: new Date(),
      createdById: userId,
    },
  });

  await recalculateBudgetSummary(transaction.budgetId, tx);
  return budgetTransaction;
};

const reverseBudgetOnVoid = async (tx, transaction) => {
  if (transaction.type !== 'EXPENSE') return null;
  if (!transaction.budgetId || !transaction.budgetCategoryId) return null;

  const budgetTransaction = await tx.budgetTransaction.findFirst({
    where: {
      referenceType: 'TRANSACTION',
      referenceId: transaction.id,
      transactionType: 'EXPENSE',
      status: { not: 'CANCELLED' },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!budgetTransaction) return null;

  await tx.budgetCategoryAllocation.update({
    where: { id: budgetTransaction.categoryId },
    data: {
      spentAmount: { decrement: budgetTransaction.totalAmount },
      remainingAmount: { increment: budgetTransaction.totalAmount },
    },
  });

  const updatedBudgetTxn = await tx.budgetTransaction.update({
    where: { id: budgetTransaction.id },
    data: { status: 'CANCELLED' },
  });

  await recalculateBudgetSummary(budgetTransaction.budgetId, tx);
  return updatedBudgetTxn;
};

export const checkTransactionPermission = async (
  userId,
  companyId,
  permissionCode
) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      role: {
        include: {
          rolePermissions: {
            include: { permission: true },
          },
        },
      },
    },
  });

  if (!user) return false;
  if (user.userType === 'SUPER_ADMIN') return true;
  if (user.companyId !== companyId) return false;

  return user.role?.rolePermissions.some(
    (rp) =>
      rp.permission.code === permissionCode ||
      rp.permission.code === 'ALL_ACCESS' ||
      rp.permission.code === 'FULL_COMPANY_ACCESS'
  );
};

export const generateTransactionNo = async (companyId) => {
  const year = new Date().getFullYear();
  const count = await prisma.transaction.count({
    where: {
      companyId,
      createdAt: {
        gte: new Date(year, 0, 1),
        lt: new Date(year + 1, 0, 1),
      },
    },
  });

  return `TRX-${year}-${String(count + 1).padStart(4, '0')}`;
};

export const createTransaction = async (payload, user) => {
  const project = await ensureProject(payload.projectId, user.companyId);
  const transactionNo = await generateTransactionNo(user.companyId);
  const taxAmount = payload.taxAmount || 0;
  const totalAmount = buildTotalAmount(
    payload.amount,
    taxAmount,
    payload.totalAmount
  );

  return prisma.transaction.create({
    data: {
      transactionNo,
      projectId: project.id,
      companyId: user.companyId,
      type: payload.type,
      amount: payload.amount,
      taxAmount,
      totalAmount,
      currency: payload.currency || 'INR',
      transactionDate: payload.transactionDate
        ? new Date(payload.transactionDate)
        : new Date(),
      description: payload.description,
      category: payload.category,
      counterpartyName: payload.counterpartyName,
      invoiceId: payload.invoiceId,
      paymentId: payload.paymentId,
      budgetId: payload.budgetId,
      budgetCategoryId: payload.budgetCategoryId,
      purchaseOrderId: payload.purchaseOrderId,
      contractorPaymentId: payload.contractorPaymentId,
      payrollId: payload.payrollId,
      cashboxId: payload.cashboxId,
      sourceType: payload.sourceType || 'DIRECT',
      sourceId: payload.sourceId,
      referenceNo: payload.referenceNo,
      notes: payload.notes,
      attachmentUrl: payload.attachmentUrl,
      requestedById: user.userId,
    },
  });
};

export const updatePendingTransaction = async (transaction, payload) => {
  if (transaction.status !== 'PENDING_APPROVAL') {
    throw new Error('Only pending transactions can be updated');
  }

  const taxAmount =
    typeof payload.taxAmount === 'number' ? payload.taxAmount : transaction.taxAmount;
  const amount = typeof payload.amount === 'number' ? payload.amount : transaction.amount;
  const totalAmount = buildTotalAmount(amount, taxAmount, payload.totalAmount);

  return prisma.transaction.update({
    where: { id: transaction.id },
    data: {
      ...payload,
      taxAmount,
      totalAmount,
      transactionDate: payload.transactionDate
        ? new Date(payload.transactionDate)
        : undefined,
    },
  });
};

export const approveTransaction = async (transaction, user, approvalNotes) => {
  if (transaction.status !== 'PENDING_APPROVAL') {
    throw new Error('Only pending transactions can be approved');
  }

  return prisma.$transaction(async (tx) => {
    let cashbox = null;
    let budgetTransaction = null;

    if (isPettyCashType(transaction.type)) {
      cashbox = await ensureOrCreateCashbox(tx, transaction, transaction.requestedById);
      const delta = getPettyCashDelta(transaction.type, transaction.totalAmount);
      cashbox = await applyCashboxDelta(tx, cashbox.id, delta);
    }

    budgetTransaction = await syncBudgetOnApprove(tx, transaction, user.userId);

    const updated = await tx.transaction.update({
      where: { id: transaction.id },
      data: {
        status: 'APPROVED',
        approvedById: user.userId,
        approvedAt: new Date(),
        notes: approvalNotes
          ? transaction.notes
            ? `${transaction.notes}\n${approvalNotes}`
            : approvalNotes
          : transaction.notes,
      },
    });

    return { transaction: updated, cashbox, budgetTransaction };
  });
};

export const rejectTransaction = async (transaction, user, reason) => {
  if (transaction.status !== 'PENDING_APPROVAL') {
    throw new Error('Only pending transactions can be rejected');
  }

  return prisma.transaction.update({
    where: { id: transaction.id },
    data: {
      status: 'REJECTED',
      rejectedById: user.userId,
      rejectedAt: new Date(),
      rejectionReason: reason,
    },
  });
};

export const voidApprovedTransaction = async (transaction, user, voidReason) => {
  if (transaction.status !== 'APPROVED') {
    throw new Error('Only approved transactions can be voided');
  }

  return prisma.$transaction(async (tx) => {
    let cashbox = null;
    let budgetTransaction = null;

    if (isPettyCashType(transaction.type)) {
      const cashboxRecord = await ensureOrCreateCashbox(
        tx,
        transaction,
        transaction.requestedById
      );
      const reverseDelta = -getPettyCashDelta(transaction.type, transaction.totalAmount);
      cashbox = await applyCashboxDelta(tx, cashboxRecord.id, reverseDelta);
    }

    budgetTransaction = await reverseBudgetOnVoid(tx, transaction);

    const updated = await tx.transaction.update({
      where: { id: transaction.id },
      data: {
        status: 'VOIDED',
        voidedById: user.userId,
        voidedAt: new Date(),
        voidReason,
      },
    });

    return { transaction: updated, cashbox, budgetTransaction };
  });
};
