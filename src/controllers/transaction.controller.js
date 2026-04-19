import prisma from '../config/database.js';
import {
  approveTransaction,
  checkTransactionPermission,
  createTransaction,
  rejectTransaction,
  updatePendingTransaction,
  voidApprovedTransaction,
} from '../services/transaction.service.js';

const findTransactionById = async (id, companyId) =>
  prisma.transaction.findFirst({
    where: { id, companyId },
    include: {
      project: { select: { id: true, name: true, projectId: true } },
      requestedBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      rejectedBy: { select: { id: true, name: true } },
      voidedBy: { select: { id: true, name: true } },
      cashbox: { select: { id: true, currentBalance: true, currency: true } },
    },
  });

const createAuditLog = async (req, action, entityId, newData = null, oldData = null) => {
  await prisma.auditLog.create({
    data: {
      userId: req.user.userId,
      companyId: req.user.companyId,
      action,
      entityType: 'TRANSACTION',
      entityId,
      newData,
      oldData,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    },
  });
};

export const createTransactionEntry = async (req, res) => {
  try {
    const hasPermission = await checkTransactionPermission(
      req.user.userId,
      req.user.companyId,
      'TRANSACTION_CREATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create transactions',
      });
    }

    const transaction = await createTransaction(req.body, req.user);
    await createAuditLog(req, 'TRANSACTION_CREATED', transaction.id, {
      transactionNo: transaction.transactionNo,
      type: transaction.type,
      totalAmount: transaction.totalAmount,
      status: transaction.status,
    });

    res.status(201).json({
      success: true,
      message: 'Transaction created successfully',
      data: transaction,
    });
  } catch (error) {
    console.error('Create transaction error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Unable to create transaction',
    });
  }
};

export const getTransactions = async (req, res) => {
  try {
    const hasPermission = await checkTransactionPermission(
      req.user.userId,
      req.user.companyId,
      'TRANSACTION_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view transactions',
      });
    }

    const {
      projectId,
      type,
      status,
      sourceType,
      fromDate,
      toDate,
      page = 1,
      limit = 20,
    } = req.query;

    const where = { companyId: req.user.companyId };
    if (projectId) where.projectId = projectId;
    if (type) where.type = type;
    if (status) where.status = status;
    if (sourceType) where.sourceType = sourceType;
    if (fromDate || toDate) {
      where.transactionDate = {};
      if (fromDate) where.transactionDate.gte = new Date(fromDate);
      if (toDate) where.transactionDate.lte = new Date(toDate);
    }

    const pageNo = parseInt(page, 10);
    const pageSize = parseInt(limit, 10);
    const skip = (pageNo - 1) * pageSize;

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: {
          project: { select: { id: true, name: true, projectId: true } },
          requestedBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
          rejectedBy: { select: { id: true, name: true } },
          voidedBy: { select: { id: true, name: true } },
          cashbox: { select: { id: true, currentBalance: true, currency: true } },
        },
        orderBy: { transactionDate: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.transaction.count({ where }),
    ]);

    res.json({
      success: true,
      data: transactions,
      pagination: {
        page: pageNo,
        limit: pageSize,
        total,
        pages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getTransactionById = async (req, res) => {
  try {
    const hasPermission = await checkTransactionPermission(
      req.user.userId,
      req.user.companyId,
      'TRANSACTION_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view transactions',
      });
    }

    const transaction = await findTransactionById(req.params.id, req.user.companyId);
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    res.json({ success: true, data: transaction });
  } catch (error) {
    console.error('Get transaction by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const updateTransactionEntry = async (req, res) => {
  try {
    const hasPermission = await checkTransactionPermission(
      req.user.userId,
      req.user.companyId,
      'TRANSACTION_CREATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update transactions',
      });
    }

    const existing = await findTransactionById(req.params.id, req.user.companyId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    const updated = await updatePendingTransaction(existing, req.body);
    await createAuditLog(
      req,
      'TRANSACTION_UPDATED',
      updated.id,
      { status: updated.status, totalAmount: updated.totalAmount },
      { status: existing.status, totalAmount: existing.totalAmount }
    );

    res.json({
      success: true,
      message: 'Transaction updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Update transaction error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Unable to update transaction',
    });
  }
};

export const approveTransactionEntry = async (req, res) => {
  try {
    const hasPermission = await checkTransactionPermission(
      req.user.userId,
      req.user.companyId,
      'TRANSACTION_APPROVE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to approve transactions',
      });
    }

    const existing = await findTransactionById(req.params.id, req.user.companyId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    const result = await approveTransaction(existing, req.user, req.body.approvalNotes);
    await createAuditLog(req, 'TRANSACTION_APPROVED', result.transaction.id, {
      status: result.transaction.status,
      cashboxId: result.cashbox?.id,
      budgetTransactionId: result.budgetTransaction?.id,
    });

    res.json({
      success: true,
      message: 'Transaction approved successfully',
      data: result.transaction,
    });
  } catch (error) {
    console.error('Approve transaction error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Unable to approve transaction',
    });
  }
};

export const rejectTransactionEntry = async (req, res) => {
  try {
    const hasPermission = await checkTransactionPermission(
      req.user.userId,
      req.user.companyId,
      'TRANSACTION_APPROVE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to reject transactions',
      });
    }

    const existing = await findTransactionById(req.params.id, req.user.companyId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    const updated = await rejectTransaction(
      existing,
      req.user,
      req.body.rejectionReason
    );
    await createAuditLog(req, 'TRANSACTION_REJECTED', updated.id, {
      status: updated.status,
      rejectionReason: updated.rejectionReason,
    });

    res.json({
      success: true,
      message: 'Transaction rejected successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Reject transaction error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Unable to reject transaction',
    });
  }
};

export const voidTransactionEntry = async (req, res) => {
  try {
    const hasPermission = await checkTransactionPermission(
      req.user.userId,
      req.user.companyId,
      'TRANSACTION_VOID'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to void transactions',
      });
    }

    const existing = await findTransactionById(req.params.id, req.user.companyId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    const result = await voidApprovedTransaction(
      existing,
      req.user,
      req.body.voidReason
    );
    await createAuditLog(req, 'TRANSACTION_VOIDED', result.transaction.id, {
      status: result.transaction.status,
      cashboxId: result.cashbox?.id,
      budgetTransactionId: result.budgetTransaction?.id,
      voidReason: result.transaction.voidReason,
    });

    res.json({
      success: true,
      message: 'Transaction voided successfully',
      data: result.transaction,
    });
  } catch (error) {
    console.error('Void transaction error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Unable to void transaction',
    });
  }
};

export const getProjectTransactionSummary = async (req, res) => {
  try {
    const hasPermission = await checkTransactionPermission(
      req.user.userId,
      req.user.companyId,
      'TRANSACTION_REPORT'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view transaction reports',
      });
    }

    const { projectId } = req.params;
    const { fromDate, toDate } = req.query;

    const project = await prisma.project.findFirst({
      where: { id: projectId, companyId: req.user.companyId },
      select: { id: true, name: true, projectId: true },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found',
      });
    }

    const where = { companyId: req.user.companyId, projectId };
    if (fromDate || toDate) {
      where.transactionDate = {};
      if (fromDate) where.transactionDate.gte = new Date(fromDate);
      if (toDate) where.transactionDate.lte = new Date(toDate);
    }

    const transactions = await prisma.transaction.findMany({
      where,
      select: { type: true, status: true, totalAmount: true },
    });

    const summary = {
      totalIncome: 0,
      totalExpense: 0,
      pettyCashNet: 0,
      byStatus: {
        PENDING_APPROVAL: 0,
        APPROVED: 0,
        REJECTED: 0,
        VOIDED: 0,
      },
      count: transactions.length,
    };

    transactions.forEach((t) => {
      summary.byStatus[t.status] += 1;
      if (t.status !== 'APPROVED') return;

      if (t.type === 'INCOME') summary.totalIncome += t.totalAmount;
      if (t.type === 'EXPENSE') summary.totalExpense += t.totalAmount;

      if (t.type === 'PETTY_CASH_ISSUE') summary.pettyCashNet -= t.totalAmount;
      if (t.type === 'PETTY_CASH_SETTLEMENT') summary.pettyCashNet += t.totalAmount;
      if (t.type === 'PETTY_CASH_REPLENISHMENT') summary.pettyCashNet += t.totalAmount;
    });

    res.json({
      success: true,
      data: {
        project,
        summary,
      },
    });
  } catch (error) {
    console.error('Get project transaction summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getProjectCashboxBalance = async (req, res) => {
  try {
    const hasPermission = await checkTransactionPermission(
      req.user.userId,
      req.user.companyId,
      'TRANSACTION_REPORT'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view cashbox',
      });
    }

    const { projectId } = req.params;
    const cashbox = await prisma.projectCashbox.findFirst({
      where: { projectId, companyId: req.user.companyId },
      include: {
        project: { select: { id: true, name: true, projectId: true } },
      },
    });

    if (!cashbox) {
      return res.status(404).json({
        success: false,
        message: 'Cashbox not found for this project',
      });
    }

    res.json({
      success: true,
      data: cashbox,
    });
  } catch (error) {
    console.error('Get project cashbox error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getProjectCashboxStatement = async (req, res) => {
  try {
    const hasPermission = await checkTransactionPermission(
      req.user.userId,
      req.user.companyId,
      'TRANSACTION_REPORT'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view cashbox statement',
      });
    }

    const { projectId } = req.params;
    const { fromDate, toDate } = req.query;

    const project = await prisma.project.findFirst({
      where: { id: projectId, companyId: req.user.companyId },
      select: { id: true, name: true, projectId: true },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found',
      });
    }

    const where = {
      companyId: req.user.companyId,
      projectId,
      status: 'APPROVED',
      type: {
        in: [
          'PETTY_CASH_ISSUE',
          'PETTY_CASH_SETTLEMENT',
          'PETTY_CASH_REPLENISHMENT',
        ],
      },
    };

    if (fromDate || toDate) {
      where.transactionDate = {};
      if (fromDate) where.transactionDate.gte = new Date(fromDate);
      if (toDate) where.transactionDate.lte = new Date(toDate);
    }

    const entries = await prisma.transaction.findMany({
      where,
      orderBy: { transactionDate: 'asc' },
      select: {
        id: true,
        transactionNo: true,
        type: true,
        totalAmount: true,
        description: true,
        transactionDate: true,
      },
    });

    let runningBalance = 0;
    const statement = entries.map((entry) => {
      let delta = 0;
      if (entry.type === 'PETTY_CASH_ISSUE') delta = -entry.totalAmount;
      if (
        entry.type === 'PETTY_CASH_SETTLEMENT' ||
        entry.type === 'PETTY_CASH_REPLENISHMENT'
      ) {
        delta = entry.totalAmount;
      }
      runningBalance += delta;

      return {
        ...entry,
        delta,
        runningBalance,
      };
    });

    const cashbox = await prisma.projectCashbox.findFirst({
      where: { projectId, companyId: req.user.companyId },
      select: { id: true, currentBalance: true, currency: true },
    });

    res.json({
      success: true,
      data: {
        project,
        cashbox,
        statement,
      },
    });
  } catch (error) {
    console.error('Get project cashbox statement error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
