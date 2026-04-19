import prisma from '../config/database.js';
import { recalculateBudgetSummary } from '../services/budget.service.js';

// Helper function to check budget permissions
const checkBudgetPermission = async (userId, companyId, permissionCode) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      role: {
        include: {
          rolePermissions: {
            include: {
              permission: true,
            },
          },
        },
      },
    },
  });

  if (!user) return false;
  if (user.userType === 'SUPER_ADMIN') return true;
  if (user.companyId !== companyId) return false;

  const hasPermission = user.role?.rolePermissions.some(
    (rp) =>
      rp.permission.code === permissionCode ||
      rp.permission.code === 'ALL_ACCESS' ||
      rp.permission.code === 'FULL_COMPANY_ACCESS' ||
      rp.permission.code === 'BUDGET_ALL_ACCESS'
  );

  return hasPermission;
};

// Helper to calculate budget summary
// Budget summary calculation is now handled by the budget service
const calculateBudgetSummary = async (budgetId) => {
  return recalculateBudgetSummary(budgetId);
};

// Helper to check budget alerts
const checkBudgetAlerts = async (budgetId, createdById, categoryId = null) => {
  const budget = await prisma.budget.findUnique({
    where: { id: budgetId },
    include: {
      categories: true,
    },
  });

  if (!budget) return;

  const categories = categoryId
    ? budget.categories.filter((c) => c.id === categoryId)
    : budget.categories;

  for (const category of categories) {
    const utilizationRate =
      category.allocatedAmount > 0
        ? (category.spentAmount / category.allocatedAmount) * 100
        : 0;

    if (utilizationRate >= category.criticalThreshold) {
      await createBudgetAlert(
        budgetId,
        category.id,
        'CRITICAL_WARNING',
        'CRITICAL',
        `Critical budget alert: ${category.category} has exceeded ${utilizationRate.toFixed(2)}% utilization`,
        category.spentAmount,
        category.allocatedAmount,
        utilizationRate,
        createdById
      );
    } else if (utilizationRate >= category.warningThreshold) {
      await createBudgetAlert(
        budgetId,
        category.id,
        'THRESHOLD_WARNING',
        'WARNING',
        `Budget warning: ${category.category} has reached ${utilizationRate.toFixed(2)}% utilization`,
        category.spentAmount,
        category.allocatedAmount,
        utilizationRate,
        createdById
      );
    }
  }
};

// Helper to create budget alert
const createBudgetAlert = async (
  budgetId,
  categoryId,
  alertType,
  severity,
  message,
  currentAmount,
  thresholdAmount,
  thresholdPercent,
  createdById
) => {
  const alertCount = await prisma.budgetAlert.count({
    where: {
      budgetId,
      categoryId,
      alertType,
      isResolved: false,
    },
  });

  if (alertCount === 0) {
    await prisma.budgetAlert.create({
      data: {
        alertNo: `ALERT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        budgetId,
        categoryId,
        alertType,
        severity,
        title: `${alertType.replace('_', ' ')} Alert`,
        message,
        currentAmount,
        thresholdAmount,
        thresholdPercent,
        createdById,
      },
    });
  }
};

// ==================== BUDGET CORE ====================

export const createBudget = async (req, res) => {
  try {
    const {
      projectId,
      name,
      description,
      budgetPeriod,
      startDate,
      endDate,
      fiscalYear,
      contingencyPercent,
      categories,
    } = req.body;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_CREATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create budgets',
      });
    }

    // Check if project exists and belongs to company
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        companyId: req.user.companyId,
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found',
      });
    }

    // 1. DYNAMIC VERSIONING FIX:
    // Find the highest existing version for this project to avoid the unique constraint error
    const lastBudget = await prisma.budget.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: { version: true, isActive: true },
    });

    const nextVersion = (lastBudget?.version || 0) + 1;

    // Check if there is an active budget to determine if this new one should be active
    const existingActiveBudget = lastBudget?.isActive
      ? true
      : await prisma.budget.findFirst({
          where: { projectId, isActive: true },
        });

    // Generate budget number
    const year = new Date().getFullYear();
    const count = await prisma.budget.count({
      where: {
        companyId: req.user.companyId,
        createdAt: {
          gte: new Date(year, 0, 1),
          lt: new Date(year + 1, 0, 1),
        },
      },
    });
    const budgetNo = `BUD-${year}-${String(count + 1).padStart(4, '0')}`;

    // Calculate contingency amount
    let totalAllocated =
      categories?.reduce((sum, cat) => sum + (cat.allocatedAmount || 0), 0) ||
      0;
    const contingencyAmount = contingencyPercent
      ? (totalAllocated * contingencyPercent) / 100
      : 0;

    // Create budget with the incremented version
    const budget = await prisma.budget.create({
      data: {
        budgetNo,
        projectId,
        companyId: req.user.companyId,
        name,
        description,
        version: nextVersion, // Use the dynamically calculated version
        budgetPeriod: budgetPeriod || 'PROJECT_PHASE',
        status: 'DRAFT',
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        fiscalYear: fiscalYear || year,
        contingencyPercent: contingencyPercent || 5,
        contingencyAmount,
        contingencyRemaining: contingencyAmount,
        totalApproved: totalAllocated + contingencyAmount,
        requestedById: req.user.userId,
        createdById: req.user.userId,
        isActive: !existingActiveBudget, // Only active if no other active budget exists
        categories: categories?.length
          ? {
              create: categories.map((cat) => ({
                category: cat.category,
                subCategory: cat.subCategory,
                description: cat.description,
                allocatedAmount: cat.allocatedAmount || 0,
                remainingAmount: cat.allocatedAmount || 0,
                warningThreshold: cat.warningThreshold || 80,
                criticalThreshold: cat.criticalThreshold || 95,
                isContingency: cat.isContingency || false,
                parentCategoryId: cat.parentCategoryId,
                monthlyAllocation: cat.monthlyAllocation,
                quarterlyAllocation: cat.quarterlyAllocation,
                createdById: req.user.userId,
              })),
            }
          : undefined,
      },
      include: {
        categories: true,
      },
    });

    // Create initial allocation transactions
    if (categories?.length) {
      for (const cat of budget.categories) {
        await prisma.budgetTransaction.create({
          data: {
            transactionNo: `TXN-${Date.now()}-${cat.id.substring(0, 4)}`,
            budgetId: budget.id,
            categoryId: cat.id,
            transactionType: 'INITIAL_ALLOCATION',
            status: 'COMMITTED',
            description: `Initial allocation for ${cat.category}`,
            amount: cat.allocatedAmount,
            totalAmount: cat.allocatedAmount,
            transactionDate: new Date(),
            committedDate: new Date(),
            createdById: req.user.userId,
          },
        });
      }
    }

    // Log audit
    await prisma.auditLog.create({
      data: {
        action: 'BUDGET_CREATED',
        entityType: 'BUDGET',
        entityId: budget.id,
        newData: {
          name,
          projectId,
          version: nextVersion,
          totalAllocated,
          contingencyAmount,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message: 'Budget created successfully',
      data: budget,
    });
  } catch (error) {
    console.error('Create budget error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getAllBudgets = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status,
      projectId,
      fromDate,
      toDate,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view budgets',
      });
    }

    const where = {
      companyId: req.user.companyId,
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { budgetNo: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status) where.status = status;
    if (projectId) where.projectId = projectId;
    if (fromDate || toDate) {
      where.startDate = {};
      if (fromDate) where.startDate.gte = new Date(fromDate);
      if (toDate) where.startDate.lte = new Date(toDate);
    }

    const [budgets, total] = await Promise.all([
      prisma.budget.findMany({
        where,
        include: {
          project: {
            select: {
              id: true,
              name: true,
              projectId: true,
            },
          },
          categories: {
            select: {
              id: true,
              category: true,
              allocatedAmount: true,
              spentAmount: true,
              remainingAmount: true,
              utilizationRate: true,
            },
          },
          _count: {
            select: {
              transactions: true,
              revisions: true,
              alerts: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.budget.count({ where }),
    ]);

    res.json({
      success: true,
      data: budgets,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get budgets error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getBudgetById = async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`Fetching budget with ID: ${id} for user: ${req.user.userId}`);

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view budget details',
      });
    }

    const budget = await prisma.budget.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            projectId: true,
            status: true,
          },
        },
        categories: {
          include: {
            subCategories: {
              include: {
                subCategories: true,
              },
            },
            transactions: {
              take: 10,
              orderBy: { transactionDate: 'desc' },
            },
          },
          orderBy: { category: 'asc' },
        },
        revisions: {
          include: {
            requestedBy: {
              select: { id: true, name: true },
            },
          },
          orderBy: { requestedAt: 'desc' },
          take: 5,
        },
        transactions: {
          include: {
            category: {
              select: { category: true, subCategory: true },
            },
            createdBy: {
              select: { id: true, name: true },
            },
          },
          orderBy: { transactionDate: 'desc' },
          take: 20,
        },
        alerts: {
          where: { isResolved: false },
          orderBy: { createdAt: 'desc' },
        },
        requestedBy: {
          select: { id: true, name: true, email: true },
        },
        approvedBy: {
          select: { id: true, name: true, email: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: {
            transactions: true,
            revisions: true,
            alerts: true,
            documents: true,
            forecasts: true,
          },
        },
      },
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Budget not found',
      });
    }

    res.json({
      success: true,
      data: budget,
    });
  } catch (error) {
    console.error('Get budget error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const updateBudget = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, endDate, contingencyPercent } = req.body;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update budgets',
      });
    }

    const existingBudget = await prisma.budget.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!existingBudget) {
      return res.status(404).json({
        success: false,
        message: 'Budget not found',
      });
    }

    if (
      existingBudget.status === 'APPROVED' ||
      existingBudget.status === 'LOCKED'
    ) {
      return res.status(400).json({
        success: false,
        message: `Cannot update budget with status: ${existingBudget.status}`,
      });
    }

    let updateData = {
      name,
      description,
      endDate: endDate ? new Date(endDate) : undefined,
    };

    if (contingencyPercent && existingBudget.status === 'DRAFT') {
      const totalAllocated =
        existingBudget.totalApproved - existingBudget.contingencyAmount;
      const newContingencyAmount = (totalAllocated * contingencyPercent) / 100;
      updateData.contingencyPercent = contingencyPercent;
      updateData.contingencyAmount = newContingencyAmount;
      updateData.contingencyRemaining = newContingencyAmount;
      updateData.totalApproved = totalAllocated + newContingencyAmount;
    }

    const budget = await prisma.budget.update({
      where: { id },
      data: updateData,
    });

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'BUDGET_UPDATED',
        entityType: 'BUDGET',
        entityId: budget.id,
        oldData: {
          name: existingBudget.name,
          description: existingBudget.description,
        },
        newData: updateData,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Budget updated successfully',
      data: budget,
    });
  } catch (error) {
    console.error('Update budget error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const deleteBudget = async (req, res) => {
  try {
    const { id } = req.params;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_DELETE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete budgets',
      });
    }

    const budget = await prisma.budget.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Budget not found',
      });
    }

    if (budget.status !== 'DRAFT' && budget.status !== 'REJECTED') {
      return res.status(400).json({
        success: false,
        message: `Cannot delete budget with status: ${budget.status}`,
      });
    }

    // Check for transactions
    const transactions = await prisma.budgetTransaction.count({
      where: { budgetId: id },
    });

    if (transactions > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete budget with existing transactions',
      });
    }

    await prisma.budget.delete({
      where: { id },
    });

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'BUDGET_DELETED',
        entityType: 'BUDGET',
        entityId: id,
        oldData: { name: budget.name, budgetNo: budget.budgetNo },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Budget deleted successfully',
    });
  } catch (error) {
    console.error('Delete budget error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const updateBudgetStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason } = req.body || {};

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Budget status is required',
      });
    }

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_APPROVE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update budget status',
      });
    }

    const budget = await prisma.budget.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Budget not found',
      });
    }

    const updateData = {
      status,
    };

    if (status === 'APPROVED') {
      updateData.approvedById = req.user.userId;
      updateData.approvedAt = new Date();

      // Deactivate any other active budget for this project
      await prisma.budget.updateMany({
        where: {
          projectId: budget.projectId,
          id: { not: id },
          isActive: true,
        },
        data: { isActive: false, status: 'ARCHIVED' },
      });

      updateData.isActive = true;
      updateData.status = 'ACTIVE';

      // Update project's active budget
      await prisma.project.update({
        where: { id: budget.projectId },
        data: { activeBudgetId: id },
      });
    }

    if (status === 'REJECTED') {
      updateData.rejectionReason = rejectionReason;
    }

    const updatedBudget = await prisma.budget.update({
      where: { id },
      data: updateData,
    });

    // Update totals
    await calculateBudgetSummary(id);

    // Fetch the latest updated budget for and include its relations if needed 
    // Actually the return below uses updatedBudget, let me fix it to use the fresh data
    const finalBudget = await prisma.budget.findUnique({
      where: { id },
      include: {
        categories: true,
      }
    });

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'BUDGET_STATUS_UPDATED',
        entityType: 'BUDGET',
        entityId: id,
        oldData: { status: budget.status },
        newData: { status, rejectionReason },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: `Budget ${(status || '').toLowerCase()} updated successfully`,
      data: finalBudget,
    });
  } catch (error) {
    console.error('Update budget status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getProjectBudgets = async (req, res) => {
  try {
    const { projectId } = req.params;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view budgets',
      });
    }

    const budgets = await prisma.budget.findMany({
      where: {
        projectId,
        companyId: req.user.companyId,
      },
      include: {
        categories: {
          include: {
            subCategories: true, // Only include the relation here
          },
        },
      },
      orderBy: { version: 'desc' },
    });

    res.json({
      success: true,
      data: budgets,
    });
  } catch (error) {
    console.error('Get project budgets error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getActiveBudget = async (req, res) => {
  try {
    const { projectId } = req.params;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view budgets',
      });
    }

    const budget = await prisma.budget.findFirst({
      where: {
        projectId,
        companyId: req.user.companyId,
        isActive: true,
        status: 'ACTIVE',
      },
      include: {
        categories: {
          include: {
            subCategories: true,
          },
        },
      },
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'No active budget found for this project',
      });
    }

    res.json({
      success: true,
      data: budget,
    });
  } catch (error) {
    console.error('Get active budget error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// ==================== BUDGET CATEGORIES ====================

export const getBudgetCategories = async (req, res) => {
  try {
    const { budgetId } = req.params;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view budget categories',
      });
    }

    const categories = await prisma.budgetCategoryAllocation.findMany({
      where: {
        budgetId,
        budget: {
          companyId: req.user.companyId,
        },
      },
      include: {
        subCategories: {
          include: {
            subCategories: true,
          },
        },
        _count: {
          select: {
            transactions: true,
            alerts: true,
          },
        },
      },
      orderBy: [{ category: 'asc' }, { subCategory: 'asc' }],
    });

    res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    console.error('Get budget categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getBudgetCategoryById = async (req, res) => {
  try {
    const { budgetId, categoryId } = req.params;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view budget categories',
      });
    }

    const category = await prisma.budgetCategoryAllocation.findFirst({
      where: {
        id: categoryId,
        budgetId,
        budget: {
          companyId: req.user.companyId,
        },
      },
      include: {
        subCategories: {
          include: {
            subCategories: true,
          },
        },
        transactions: {
          take: 20,
          orderBy: { transactionDate: 'desc' },
        },
        alerts: {
          where: { isResolved: false },
        },
      },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Budget category not found',
      });
    }

    res.json({
      success: true,
      data: category,
    });
  } catch (error) {
    console.error('Get budget category error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const addBudgetCategory = async (req, res) => {
  try {
    const { budgetId } = req.params;
    const {
      category,
      subCategory,
      description,
      allocatedAmount,
      warningThreshold,
      criticalThreshold,
      isContingency,
      parentCategoryId,
      monthlyAllocation,
      quarterlyAllocation,
    } = req.body;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to modify budget categories',
      });
    }

    const budget = await prisma.budget.findFirst({
      where: {
        id: budgetId,
        companyId: req.user.companyId,
      },
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Budget not found',
      });
    }

    if (budget.status !== 'DRAFT' && budget.status !== 'PENDING_APPROVAL') {
      return res.status(400).json({
        success: false,
        message: `Cannot add categories to budget with status: ${budget.status}`,
      });
    }

    // Check for existing category
    const existingCategory = await prisma.budgetCategoryAllocation.findFirst({
      where: {
        budgetId,
        category,
        subCategory: subCategory || null,
        parentCategoryId: parentCategoryId || null,
      },
    });

    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: 'Category already exists in this budget',
      });
    }

    const newCategory = await prisma.budgetCategoryAllocation.create({
      data: {
        budgetId,
        category,
        subCategory,
        description,
        allocatedAmount: allocatedAmount || 0,
        remainingAmount: allocatedAmount || 0,
        warningThreshold: warningThreshold || 80,
        criticalThreshold: criticalThreshold || 95,
        isContingency: isContingency || false,
        parentCategoryId,
        monthlyAllocation,
        quarterlyAllocation,
        createdById: req.user.userId,
      },
    });

    // Update budget totals
    await calculateBudgetSummary(budgetId);

    // Create allocation transaction
    if (allocatedAmount > 0) {
      await prisma.budgetTransaction.create({
        data: {
          transactionNo: `TXN-${Date.now()}-${newCategory.id.substring(0, 4)}`,
          budgetId,
          categoryId: newCategory.id,
          transactionType: 'INITIAL_ALLOCATION',
          status: 'COMMITTED',
          description: `Initial allocation for ${category}`,
          amount: allocatedAmount,
          totalAmount: allocatedAmount,
          transactionDate: new Date(),
          committedDate: new Date(),
          createdById: req.user.userId,
        },
      });
    }

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'BUDGET_CATEGORY_ADDED',
        entityType: 'BUDGET_CATEGORY',
        entityId: newCategory.id,
        newData: { category, subCategory, allocatedAmount },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message: 'Budget category added successfully',
      data: newCategory,
    });
  } catch (error) {
    console.error('Add budget category error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const updateBudgetCategory = async (req, res) => {
  try {
    const { budgetId, categoryId } = req.params;
    const {
      description,
      allocatedAmount,
      warningThreshold,
      criticalThreshold,
      monthlyAllocation,
      quarterlyAllocation,
    } = req.body;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to modify budget categories',
      });
    }

    const category = await prisma.budgetCategoryAllocation.findFirst({
      where: {
        id: categoryId,
        budgetId,
        budget: {
          companyId: req.user.companyId,
        },
      },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Budget category not found',
      });
    }

    const budget = await prisma.budget.findUnique({
      where: { id: budgetId },
    });

    if (budget.status !== 'DRAFT' && budget.status !== 'PENDING_APPROVAL') {
      return res.status(400).json({
        success: false,
        message: `Cannot update category in budget with status: ${budget.status}`,
      });
    }

    if (category.spentAmount > 0 && allocatedAmount < category.spentAmount) {
      return res.status(400).json({
        success: false,
        message: 'Cannot reduce allocated amount below spent amount',
      });
    }

    const updatedCategory = await prisma.budgetCategoryAllocation.update({
      where: { id: categoryId },
      data: {
        description,
        allocatedAmount,
        warningThreshold,
        criticalThreshold,
        monthlyAllocation,
        quarterlyAllocation,
      },
    });

    // Update budget totals
    await calculateBudgetSummary(budgetId);

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'BUDGET_CATEGORY_UPDATED',
        entityType: 'BUDGET_CATEGORY',
        entityId: categoryId,
        oldData: {
          allocatedAmount: category.allocatedAmount,
          description: category.description,
        },
        newData: {
          allocatedAmount,
          description,
          warningThreshold,
          criticalThreshold,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Budget category updated successfully',
      data: updatedCategory,
    });
  } catch (error) {
    console.error('Update budget category error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const deleteBudgetCategory = async (req, res) => {
  try {
    const { budgetId, categoryId } = req.params;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete budget categories',
      });
    }

    const category = await prisma.budgetCategoryAllocation.findFirst({
      where: {
        id: categoryId,
        budgetId,
        budget: {
          companyId: req.user.companyId,
        },
      },
      include: {
        transactions: true,
        subCategories: true,
      },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Budget category not found',
      });
    }

    const budget = await prisma.budget.findUnique({
      where: { id: budgetId },
    });

    if (budget.status !== 'DRAFT') {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category from budget with status: ${budget.status}`,
      });
    }

    if (category.transactions.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete category with existing transactions',
      });
    }

    if (category.subCategories.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete category with sub-categories',
      });
    }

    await prisma.budgetCategoryAllocation.delete({
      where: { id: categoryId },
    });

    // Update budget totals
    await calculateBudgetSummary(budgetId);

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'BUDGET_CATEGORY_DELETED',
        entityType: 'BUDGET_CATEGORY',
        entityId: categoryId,
        oldData: {
          category: category.category,
          subCategory: category.subCategory,
          allocatedAmount: category.allocatedAmount,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Budget category deleted successfully',
    });
  } catch (error) {
    console.error('Delete budget category error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const transferBudgetAmount = async (req, res) => {
  try {
    const { budgetId, categoryId } = req.params;
    const { toCategoryId, amount, reason } = req.body;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to transfer budget amounts',
      });
    }

    const fromCategory = await prisma.budgetCategoryAllocation.findFirst({
      where: {
        id: categoryId,
        budgetId,
        budget: {
          companyId: req.user.companyId,
        },
      },
    });

    const toCategory = await prisma.budgetCategoryAllocation.findFirst({
      where: {
        id: toCategoryId,
        budgetId,
        budget: {
          companyId: req.user.companyId,
        },
      },
    });

    if (!fromCategory || !toCategory) {
      return res.status(404).json({
        success: false,
        message: 'One or both categories not found',
      });
    }

    const budget = await prisma.budget.findUnique({
      where: { id: budgetId },
    });

    if (budget.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: `Cannot transfer from budget with status: ${budget.status}`,
      });
    }

    const availableAmount = fromCategory.remainingAmount;

    if (availableAmount < amount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient funds. Available: ${availableAmount}`,
      });
    }

    // Perform transfer in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Deduct from source
      const updatedFrom = await tx.budgetCategoryAllocation.update({
        where: { id: categoryId },
        data: {
          allocatedAmount: { decrement: amount },
          remainingAmount: { decrement: amount },
        },
      });

      // Add to destination
      const updatedTo = await tx.budgetCategoryAllocation.update({
        where: { id: toCategoryId },
        data: {
          allocatedAmount: { increment: amount },
          remainingAmount: { increment: amount },
        },
      });

      // Create transfer transaction
      const transaction = await tx.budgetTransaction.create({
        data: {
          transactionNo: `TRF-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          budgetId,
          categoryId,
          transferToCategoryId: toCategoryId,
          transactionType: 'TRANSFER',
          status: 'DISBURSED',
          description: reason || `Transfer to ${toCategory.category}`,
          amount,
          totalAmount: amount,
          transactionDate: new Date(),
          committedDate: new Date(),
          createdById: req.user.userId,
        },
      });

      return { updatedFrom, updatedTo, transaction };
    });

    // Update budget totals
    await calculateBudgetSummary(budgetId);

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'BUDGET_TRANSFER',
        entityType: 'BUDGET',
        entityId: budgetId,
        newData: {
          fromCategory: fromCategory.category,
          toCategory: toCategory.category,
          amount,
          reason,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Amount transferred successfully',
      data: result,
    });
  } catch (error) {
    console.error('Transfer budget amount error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// ==================== BUDGET TRANSACTIONS ====================

export const getBudgetTransactions = async (req, res) => {
  try {
    const { budgetId } = req.params;
    const {
      page = 1,
      limit = 20,
      categoryId,
      transactionType,
      status,
      fromDate,
      toDate,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view transactions',
      });
    }

    const where = {
      budgetId,
      budget: {
        companyId: req.user.companyId,
      },
    };

    if (categoryId) where.categoryId = categoryId;
    if (transactionType) where.transactionType = transactionType;
    if (status) where.status = status;
    if (fromDate || toDate) {
      where.transactionDate = {};
      if (fromDate) where.transactionDate.gte = new Date(fromDate);
      if (toDate) where.transactionDate.lte = new Date(toDate);
    }

    const [transactions, total] = await Promise.all([
      prisma.budgetTransaction.findMany({
        where,
        include: {
          category: {
            select: {
              category: true,
              subCategory: true,
            },
          },
          transferToCategory: {
            select: {
              category: true,
              subCategory: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { transactionDate: 'desc' },
      }),
      prisma.budgetTransaction.count({ where }),
    ]);

    res.json({
      success: true,
      data: transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get budget transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getBudgetCommitments = async (req, res) => {
  try {
    const { budgetId } = req.params;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view commitments',
      });
    }

    const commitments = await prisma.budgetTransaction.findMany({
      where: {
        budgetId,
        transactionType: 'COMMITMENT',
        status: 'COMMITTED',
        budget: {
          companyId: req.user.companyId,
        },
      },
      include: {
        category: {
          select: {
            category: true,
            subCategory: true,
          },
        },
        materialRequest: {
          select: {
            id: true,
            requestNo: true,
            materialName: true,
          },
        },
      },
      orderBy: { transactionDate: 'desc' },
    });

    res.json({
      success: true,
      data: commitments,
    });
  } catch (error) {
    console.error('Get budget commitments error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getBudgetExpenses = async (req, res) => {
  try {
    const { budgetId } = req.params;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view expenses',
      });
    }

    const expenses = await prisma.budgetTransaction.findMany({
      where: {
        budgetId,
        transactionType: 'EXPENSE',
        budget: {
          companyId: req.user.companyId,
        },
      },
      include: {
        category: {
          select: {
            category: true,
            subCategory: true,
          },
        },
        expense: {
          select: {
            id: true,
            expenseNo: true,
            description: true,
          },
        },
      },
      orderBy: { transactionDate: 'desc' },
    });

    res.json({
      success: true,
      data: expenses,
    });
  } catch (error) {
    console.error('Get budget expenses error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const createCommitment = async (req, res) => {
  try {
    const {
      budgetId,
      categoryId,
      description,
      amount,
      referenceType,
      referenceId,
      referenceNo,
      materialRequestId,
    } = req.body;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create commitments',
      });
    }

    const budget = await prisma.budget.findFirst({
      where: {
        id: budgetId,
        companyId: req.user.companyId,
        status: 'ACTIVE',
      },
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Active budget not found',
      });
    }

    const category = await prisma.budgetCategoryAllocation.findFirst({
      where: {
        id: categoryId,
        budgetId,
      },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Budget category not found',
      });
    }

    if (category.remainingAmount < amount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient budget. Available: ${category.remainingAmount}`,
      });
    }

    // Create commitment in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update category
      const updatedCategory = await tx.budgetCategoryAllocation.update({
        where: { id: categoryId },
        data: {
          committedAmount: { increment: amount },
          remainingAmount: { decrement: amount },
        },
      });

      // Create transaction
      const transaction = await tx.budgetTransaction.create({
        data: {
          transactionNo: `CMT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          budgetId,
          categoryId,
          transactionType: 'COMMITMENT',
          status: 'COMMITTED',
          description,
          amount,
          totalAmount: amount,
          referenceType,
          referenceId,
          referenceNo,
          materialRequestId,
          transactionDate: new Date(),
          committedDate: new Date(),
          createdById: req.user.userId,
        },
      });

      return { updatedCategory, transaction };
    });

    // Update budget summary
    await calculateBudgetSummary(budgetId);

    // Check alerts
    await checkBudgetAlerts(budgetId, req.user.userId, categoryId);

    res.status(201).json({
      success: true,
      message: 'Commitment created successfully',
      data: result.transaction,
    });
  } catch (error) {
    console.error('Create commitment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const createExpenseTransaction = async (req, res) => {
  try {
    const {
      budgetId,
      categoryId,
      description,
      amount,
      taxAmount,
      referenceType,
      referenceId,
      referenceNo,
      expenseId,
    } = req.body;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create expenses',
      });
    }

    const budget = await prisma.budget.findFirst({
      where: {
        id: budgetId,
        companyId: req.user.companyId,
        status: 'ACTIVE',
      },
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Active budget not found',
      });
    }

    const category = await prisma.budgetCategoryAllocation.findFirst({
      where: {
        id: categoryId,
        budgetId,
      },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Budget category not found',
      });
    }

    const totalAmount = amount + (taxAmount || 0);

    if (category.remainingAmount < totalAmount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient budget. Available: ${category.remainingAmount}`,
      });
    }

    // Check if this is converting a commitment
    let commitmentToUpdate = null;
    if (referenceType === 'MATERIAL_REQUEST' && referenceId) {
      commitmentToUpdate = await prisma.budgetTransaction.findFirst({
        where: {
          referenceId,
          transactionType: 'COMMITMENT',
          status: 'COMMITTED',
        },
      });
    }

    // Create expense in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update category
      const updatedCategory = await tx.budgetCategoryAllocation.update({
        where: { id: categoryId },
        data: {
          spentAmount: { increment: totalAmount },
          remainingAmount: { decrement: totalAmount },
        },
      });

      // If there was a commitment, update it
      if (commitmentToUpdate) {
        await tx.budgetTransaction.update({
          where: { id: commitmentToUpdate.id },
          data: { status: 'DISBURSED' },
        });
      }

      // Create transaction
      const transaction = await tx.budgetTransaction.create({
        data: {
          transactionNo: `EXP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          budgetId,
          categoryId,
          transactionType: 'EXPENSE',
          status: 'DISBURSED',
          description,
          amount,
          taxAmount: taxAmount || 0,
          totalAmount,
          referenceType,
          referenceId,
          referenceNo,
          expenseId,
          transactionDate: new Date(),
          disbursedDate: new Date(),
          createdById: req.user.userId,
        },
      });

      return { updatedCategory, transaction };
    });

    // Update budget summary
    await calculateBudgetSummary(budgetId);

    // Check alerts
    await checkBudgetAlerts(budgetId, req.user.userId, categoryId);

    res.status(201).json({
      success: true,
      message: 'Expense recorded successfully',
      data: result.transaction,
    });
  } catch (error) {
    console.error('Create expense error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const transferBetweenCategories = async (req, res) => {
  try {
    const { budgetId, fromCategoryId, toCategoryId, amount, description } =
      req.body;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to transfer funds',
      });
    }

    const fromCategory = await prisma.budgetCategoryAllocation.findFirst({
      where: {
        id: fromCategoryId,
        budgetId,
        budget: {
          companyId: req.user.companyId,
        },
      },
    });

    const toCategory = await prisma.budgetCategoryAllocation.findFirst({
      where: {
        id: toCategoryId,
        budgetId,
        budget: {
          companyId: req.user.companyId,
        },
      },
    });

    if (!fromCategory || !toCategory) {
      return res.status(404).json({
        success: false,
        message: 'One or both categories not found',
      });
    }

    const budget = await prisma.budget.findUnique({
      where: { id: budgetId },
    });

    if (budget.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: `Cannot transfer from budget with status: ${budget.status}`,
      });
    }

    // Available amount is remaining (not committed/spent)
    const availableAmount = fromCategory.remainingAmount;

    if (availableAmount < amount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient available funds. Available: ${availableAmount}`,
      });
    }

    // Perform transfer
    const result = await prisma.$transaction(async (tx) => {
      // Deduct from source
      const updatedFrom = await tx.budgetCategoryAllocation.update({
        where: { id: fromCategoryId },
        data: {
          allocatedAmount: { decrement: amount },
          remainingAmount: { decrement: amount },
        },
      });

      // Add to destination
      const updatedTo = await tx.budgetCategoryAllocation.update({
        where: { id: toCategoryId },
        data: {
          allocatedAmount: { increment: amount },
          remainingAmount: { increment: amount },
        },
      });

      // Create transfer transaction
      const transaction = await tx.budgetTransaction.create({
        data: {
          transactionNo: `TRF-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          budgetId,
          categoryId: fromCategoryId,
          transferToCategoryId: toCategoryId,
          transactionType: 'TRANSFER',
          status: 'DISBURSED',
          description: description || `Transfer to ${toCategory.category}`,
          amount,
          totalAmount: amount,
          transactionDate: new Date(),
          disbursedDate: new Date(),
          createdById: req.user.userId,
        },
      });

      return { updatedFrom, updatedTo, transaction };
    });

    // Update budget totals
    await calculateBudgetSummary(budgetId);

    res.json({
      success: true,
      message: 'Transfer completed successfully',
      data: result.transaction,
    });
  } catch (error) {
    console.error('Transfer between categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const updateTransactionStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { status } = req.body;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update transactions',
      });
    }

    const transaction = await prisma.budgetTransaction.findFirst({
      where: {
        id: transactionId,
        budget: {
          companyId: req.user.companyId,
        },
      },
      include: {
        budget: true,
      },
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    // Handle status changes
    if (status === 'CANCELLED' && transaction.status !== 'CANCELLED') {
      // Reverse the budget impact
      await prisma.$transaction(async (tx) => {
        if (transaction.transactionType === 'COMMITMENT') {
      await tx.budgetCategoryAllocation.update({
        where: { id: transaction.categoryId },
        data: {
          committedAmount: { decrement: Math.min(transaction.amount, (await tx.budgetCategoryAllocation.findUnique({ where: { id: transaction.categoryId }, select: { committedAmount: true } })).committedAmount) },
          remainingAmount: { increment: transaction.amount },
        },
      });
        } else if (transaction.transactionType === 'EXPENSE') {
          await tx.budgetCategoryAllocation.update({
            where: { id: transaction.categoryId },
            data: {
              spentAmount: { decrement: transaction.totalAmount },
              remainingAmount: { increment: transaction.totalAmount },
            },
          });
        }
      });
    }

    const updatedTransaction = await prisma.budgetTransaction.update({
      where: { id: transactionId },
      data: { status },
    });

    // Update budget summary
    await calculateBudgetSummary(transaction.budgetId);

    res.json({
      success: true,
      message: 'Transaction status updated successfully',
      data: updatedTransaction,
    });
  } catch (error) {
    console.error('Update transaction status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const convertCommitmentToExpense = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { actualAmount, taxAmount, expenseId } = req.body;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to convert commitments',
      });
    }

    const commitment = await prisma.budgetTransaction.findFirst({
      where: {
        id: transactionId,
        transactionType: 'COMMITMENT',
        status: 'COMMITTED',
        budget: {
          companyId: req.user.companyId,
        },
      },
    });

    if (!commitment) {
      return res.status(404).json({
        success: false,
        message: 'Active commitment not found',
      });
    }

    const totalAmount = actualAmount || commitment.amount + (taxAmount || 0);

    // Update commitment and create expense
    const result = await prisma.$transaction(async (tx) => {
      // Mark commitment as disbursed
      await tx.budgetTransaction.update({
        where: { id: transactionId },
        data: { status: 'DISBURSED' },
      });

      const variance = totalAmount - commitment.amount;

      // Update category
      // Update category correctly!
      // Update category correctly!
      await tx.budgetCategoryAllocation.update({
        where: { id: commitment.categoryId },
        data: {
          committedAmount: { decrement: commitment.amount }, // Release the commitment
          spentAmount: { increment: totalAmount }, // Log the actual spend
          remainingAmount: { decrement: totalAmount - commitment.amount }, // Adjust remaining by the actual impact (variance)
        },
      });

      // Create expense transaction
      const expense = await tx.budgetTransaction.create({
        data: {
          transactionNo: `EXP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          budgetId: commitment.budgetId,
          categoryId: commitment.categoryId,
          transactionType: 'EXPENSE',
          status: 'DISBURSED',
          description: `Converted from commitment: ${commitment.description}`,
          amount: actualAmount || commitment.amount,
          taxAmount: taxAmount || 0,
          totalAmount,
          referenceType: commitment.referenceType,
          referenceId: commitment.referenceId,
          referenceNo: commitment.referenceNo,
          expenseId,
          transactionDate: new Date(),
          disbursedDate: new Date(),
          createdById: req.user.userId,
        },
      });

      return expense;
    });

    // Update budget summary
    await calculateBudgetSummary(commitment.budgetId);

    // Check alerts
    await checkBudgetAlerts(
      commitment.budgetId,
      req.user.userId,
      commitment.categoryId
    );

    res.json({
      success: true,
      message: 'Commitment converted to expense successfully',
      data: result,
    });
  } catch (error) {
    console.error('Convert commitment to expense error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// ==================== BUDGET REVISIONS ====================

export const getBudgetRevisions = async (req, res) => {
  try {
    const { budgetId } = req.params;
    const { status } = req.query;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view revisions',
      });
    }

    const where = {
      budgetId,
      budget: {
        companyId: req.user.companyId,
      },
    };

    // Filter by status if provided in the query string
    if (status) {
      where.status = status;
    }

    const revisions = await prisma.budgetRevision.findMany({
      where,
      include: {
        requestedBy: {
          select: { id: true, name: true },
        },
        approvedBy: {
          select: { id: true, name: true },
        },
        createdBy: {
          select: { id: true, name: true },
        },
        _count: {
          select: {
            transactions: true,
            documents: true,
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
    });

    res.json({
      success: true,
      data: revisions,
    });
  } catch (error) {
    console.error('Get budget revisions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const createRevision = async (req, res) => {
  try {
    const { budgetId } = req.params;
    const {
      revisionType,
      reason,
      description,
      categoryChanges,
      supportingData,
      effectiveDate,
    } = req.body;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create revisions',
      });
    }

    const budget = await prisma.budget.findFirst({
      where: {
        id: budgetId,
        companyId: req.user.companyId,
      },
      include: {
        categories: true,
      },
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Budget not found',
      });
    }

    // Calculate changes safely extracting the .change property
    let totalChange = 0;
    if (categoryChanges) {
      totalChange = Object.values(categoryChanges).reduce(
        (sum, val) => sum + (val.change || 0),
        0
      );
    }

    // Generate revision number
    const revisionCount = await prisma.budgetRevision.count({
      where: { budgetId },
    });
    const revisionNo = `REV-${budget.budgetNo}-${String(revisionCount + 1).padStart(2, '0')}`;

    const revision = await prisma.budgetRevision.create({
      data: {
        revisionNo,
        budgetId,
        revisionType,
        status: 'DRAFT', // Initialize explicitly as draft
        reason,
        description,
        previousTotal: budget.totalApproved,
        newTotal: budget.totalApproved + totalChange,
        changeAmount: totalChange,
        changePercent:
          budget.totalApproved > 0
            ? (Math.abs(totalChange) / budget.totalApproved) * 100
            : 0,
        categoryChanges: categoryChanges || {},
        supportingData,
        requestedById: req.user.userId,
        effectiveDate: new Date(effectiveDate),
        createdById: req.user.userId,
      },
    });

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'BUDGET_REVISION_CREATED',
        entityType: 'BUDGET_REVISION',
        entityId: revision.id,
        newData: { revisionType, reason, totalChange, status: 'DRAFT' },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message: 'Budget revision created successfully',
      data: revision,
    });
  } catch (error) {
    console.error('Create revision error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const submitRevisionForApproval = async (req, res) => {
  try {
    const { revisionId } = req.params;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to submit revisions',
      });
    }

    const revision = await prisma.budgetRevision.findFirst({
      where: {
        id: revisionId,
        budget: {
          companyId: req.user.companyId,
        },
      },
    });

    if (!revision) {
      return res.status(404).json({
        success: false,
        message: 'Revision not found',
      });
    }

    // Safety constraint: Can only submit Drafts
    if (revision.status !== 'DRAFT') {
      return res.status(400).json({
        success: false,
        message: `Cannot submit revision from status: ${revision.status}`,
      });
    }

    const updatedRevision = await prisma.budgetRevision.update({
      where: { id: revisionId },
      data: {
        status: 'PENDING_APPROVAL',
      },
    });

    res.json({
      success: true,
      message: 'Revision submitted for approval',
      data: updatedRevision,
    });
  } catch (error) {
    console.error('Submit revision error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const approveRejectRevision = async (req, res) => {
  try {
    const { revisionId } = req.params;
    const { approved, approvalNotes, rejectionReason } = req.body;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_APPROVE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to approve revisions',
      });
    }

    const revision = await prisma.budgetRevision.findFirst({
      where: {
        id: revisionId,
        budget: {
          companyId: req.user.companyId,
        },
      },
      include: {
        budget: true,
      },
    });

    if (!revision) {
      return res.status(404).json({
        success: false,
        message: 'Revision not found',
      });
    }

    // Safety constraint: Must be Pending Approval to be acted upon
    if (revision.status !== 'PENDING_APPROVAL') {
      return res.status(400).json({
        success: false,
        message: `Cannot approve/reject revision with status: ${revision.status}`,
      });
    }

    if (approved) {
      const updatedRevision = await prisma.budgetRevision.update({
        where: { id: revisionId },
        data: {
          status: 'APPROVED',
          approvedById: req.user.userId,
          approvedAt: new Date(),
          approvalNotes,
        },
      });

      res.json({
        success: true,
        message: 'Revision approved successfully',
        data: updatedRevision,
      });
    } else {
      const updatedRevision = await prisma.budgetRevision.update({
        where: { id: revisionId },
        data: {
          status: 'REJECTED',
          rejectionReason,
        },
      });

      res.json({
        success: true,
        message: 'Revision rejected',
        data: updatedRevision,
      });
    }
  } catch (error) {
    console.error('Approve/reject revision error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const applyRevision = async (req, res) => {
  try {
    const { revisionId } = req.params;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to apply revisions',
      });
    }

    const revision = await prisma.budgetRevision.findFirst({
      where: {
        id: revisionId,
        budget: {
          companyId: req.user.companyId,
        },
      },
      include: {
        budget: {
          include: {
            categories: true,
          },
        },
      },
    });

    if (!revision) {
      return res.status(404).json({
        success: false,
        message: 'Revision not found',
      });
    }

    if (revision.status === 'APPLIED' || revision.isApplied) {
      return res.status(400).json({
        success: false,
        message: 'Revision already applied',
      });
    }

    if (revision.status !== 'APPROVED') {
      return res.status(400).json({
        success: false,
        message: `Only APPROVED revisions can be applied. Current status: ${revision.status}`,
      });
    }

    // Apply revision in transaction
    await prisma.$transaction(async (tx) => {
      // Update categories based on categoryChanges
      if (revision.categoryChanges) {
        for (const [categoryId, changeData] of Object.entries(
          revision.categoryChanges
        )) {
          // Depending on frontend payload structure, changeAmount might be nested inside an object
          const changeAmount =
            typeof changeData === 'object' && changeData.change !== undefined
              ? changeData.change
              : changeData;

          const category = revision.budget.categories.find(
            (c) => c.id === categoryId
          );
          if (category) {
            await tx.budgetCategoryAllocation.update({
              where: { id: categoryId },
              data: {
                allocatedAmount: { increment: changeAmount },
                remainingAmount: { increment: changeAmount },
              },
            });
          }
        }
      }

      // Update budget
      await tx.budget.update({
        where: { id: revision.budgetId },
        data: {
          totalApproved: revision.newTotal,
          // Re-calculate the remaining automatically based on the newly scaled pool
          totalRemaining: { increment: revision.changeAmount },
        },
      });

      // Create revision transaction ledger
      await tx.budgetTransaction.create({
        data: {
          transactionNo: `REV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          budgetId: revision.budgetId,
          categoryId: revision.budget.categories[0]?.id, // Use first category as reference
          transactionType: 'REVISION',
          status: 'COMMITTED',
          description: `Applied revision: ${revision.reason}`,
          amount: revision.changeAmount,
          totalAmount: revision.changeAmount,
          revisionId: revision.id,
          transactionDate: new Date(),
          committedDate: new Date(),
          createdById: req.user.userId,
        },
      });

      // Mark revision as applied AND update status
      await tx.budgetRevision.update({
        where: { id: revisionId },
        data: {
          status: 'APPLIED',
          isApplied: true,
          appliedAt: new Date(),
        },
      });
    });

    // Update budget summary totals just to be safe
    await calculateBudgetSummary(revision.budgetId);

    res.json({
      success: true,
      message: 'Revision applied successfully',
    });
  } catch (error) {
    console.error('Apply revision error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// ==================== BUDGET ALERTS ====================

export const getBudgetAlerts = async (req, res) => {
  try {
    const { budgetId } = req.params;
    const { resolved = false } = req.query;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view alerts',
      });
    }

    const alerts = await prisma.budgetAlert.findMany({
      where: {
        budgetId,
        budget: {
          companyId: req.user.companyId,
        },
        isResolved: resolved === 'true',
      },
      include: {
        category: {
          select: {
            category: true,
            subCategory: true,
          },
        },
        resolvedBy: {
          select: { id: true, name: true },
        },
        createdBy: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: alerts,
    });
  } catch (error) {
    console.error('Get budget alerts error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const resolveAlert = async (req, res) => {
  try {
    const { alertId } = req.params;
    const { resolutionNotes, resolutionAction } = req.body;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to resolve alerts',
      });
    }

    const alert = await prisma.budgetAlert.findFirst({
      where: {
        id: alertId,
        budget: {
          companyId: req.user.companyId,
        },
      },
    });

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found',
      });
    }

    const resolvedAlert = await prisma.budgetAlert.update({
      where: { id: alertId },
      data: {
        isResolved: true,
        resolvedAt: new Date(),
        resolvedById: req.user.userId,
        resolutionNotes,
        resolutionAction,
      },
    });

    res.json({
      success: true,
      message: 'Alert resolved successfully',
      data: resolvedAlert,
    });
  } catch (error) {
    console.error('Resolve alert error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// ==================== BUDGET FORECASTS ====================

export const getBudgetForecasts = async (req, res) => {
  try {
    const { budgetId } = req.params;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view forecasts',
      });
    }

    const forecasts = await prisma.budgetForecast.findMany({
      where: {
        budgetId,
        budget: {
          companyId: req.user.companyId,
        },
      },
      include: {
        createdBy: {
          select: { id: true, name: true },
        },
      },
      orderBy: { forecastMonth: 'asc' },
    });

    res.json({
      success: true,
      data: forecasts,
    });
  } catch (error) {
    console.error('Get budget forecasts error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const createForecast = async (req, res) => {
  try {
    const { budgetId } = req.params;
    const {
      forecastMonth,
      forecastAmount,
      categoryForecasts,
      forecastMethod,
      forecastFactors,
      confidenceLevel,
    } = req.body;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_CREATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create forecasts',
      });
    }

    const budget = await prisma.budget.findFirst({
      where: {
        id: budgetId,
        companyId: req.user.companyId,
      },
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Budget not found',
      });
    }

    const forecast = await prisma.budgetForecast.create({
      data: {
        budgetId,
        forecastMonth: new Date(forecastMonth),
        forecastAmount,
        categoryForecasts: categoryForecasts || {},
        forecastMethod,
        forecastFactors,
        confidenceLevel: confidenceLevel || 80,
        createdById: req.user.userId,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Forecast created successfully',
      data: forecast,
    });
  } catch (error) {
    console.error('Create forecast error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getVarianceAnalysis = async (req, res) => {
  try {
    const { budgetId } = req.params;
    const { fromMonth, toMonth } = req.query;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view variance analysis',
      });
    }

    const where = {
      budgetId,
      budget: {
        companyId: req.user.companyId,
      },
    };

    if (fromMonth || toMonth) {
      where.forecastMonth = {};
      if (fromMonth) where.forecastMonth.gte = new Date(fromMonth);
      if (toMonth) where.forecastMonth.lte = new Date(toMonth);
    }

    const forecasts = await prisma.budgetForecast.findMany({
      where,
      orderBy: { forecastMonth: 'asc' },
    });

    // Calculate variances
    const analysis = forecasts.map((f) => ({
      month: f.forecastMonth,
      forecastAmount: f.forecastAmount,
      actualAmount: f.actualAmount || 0,
      variance: f.variance || 0,
      variancePercent: f.variancePercent || 0,
      confidenceLevel: f.confidenceLevel,
    }));

    // Summary statistics
    const summary = {
      totalForecast: forecasts.reduce((sum, f) => sum + f.forecastAmount, 0),
      totalActual: forecasts.reduce((sum, f) => sum + (f.actualAmount || 0), 0),
      averageVariance:
        forecasts.reduce((sum, f) => sum + (f.variance || 0), 0) /
          forecasts.length || 0,
      averageConfidence:
        forecasts.reduce((sum, f) => sum + (f.confidenceLevel || 0), 0) /
          forecasts.length || 0,
    };

    res.json({
      success: true,
      data: {
        details: analysis,
        summary,
      },
    });
  } catch (error) {
    console.error('Get variance analysis error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// ==================== DASHBOARD & REPORTS ====================

export const getBudgetSummary = async (req, res) => {
  try {
    const { projectId, fromDate, toDate } = req.query;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view budget summary',
      });
    }

    const where = {
      companyId: req.user.companyId,
      isActive: true,
    };

    if (projectId) where.projectId = projectId;

    const budgets = await prisma.budget.findMany({
      where,
      include: {
        project: {
          select: {
            id: true,
            name: true,
            projectId: true,
          },
        },
        categories: true,
      },
    });

    // Summary statistics
    const summary = {
      totalBudgets: budgets.length,
      totalApproved: budgets.reduce((sum, b) => sum + b.totalApproved, 0),
      totalCommitted: budgets.reduce((sum, b) => sum + b.totalCommitted, 0),
      totalSpent: budgets.reduce((sum, b) => sum + b.totalSpent, 0),
      totalRemaining: budgets.reduce((sum, b) => sum + b.totalRemaining, 0),
      averageUtilization:
        budgets.reduce((sum, b) => sum + b.utilizationRate, 0) /
          budgets.length || 0,
    };

    // Category breakdown
    const categoryBreakdown = {};
    budgets.forEach((budget) => {
      budget.categories.forEach((cat) => {
        if (!categoryBreakdown[cat.category]) {
          categoryBreakdown[cat.category] = {
            allocated: 0,
            spent: 0,
            committed: 0,
          };
        }
        categoryBreakdown[cat.category].allocated += cat.allocatedAmount;
        categoryBreakdown[cat.category].spent += cat.spentAmount;
        categoryBreakdown[cat.category].committed += cat.committedAmount;
      });
    });

    // Project breakdown
    const projectBreakdown = budgets.map((budget) => ({
      projectId: budget.project.id,
      projectName: budget.project.name,
      budgetName: budget.name,
      totalApproved: budget.totalApproved,
      totalSpent: budget.totalSpent,
      utilizationRate: budget.utilizationRate,
      status: budget.status,
    }));

    res.json({
      success: true,
      data: {
        summary,
        categoryBreakdown,
        projectBreakdown,
      },
    });
  } catch (error) {
    console.error('Get budget summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getProjectBudgetStatus = async (req, res) => {
  try {
    const { projectId } = req.params;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view budget status',
      });
    }

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        companyId: req.user.companyId,
      },
      include: {
        budgets: {
          where: { isActive: true },
          include: {
            categories: true,
          },
        },
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found',
      });
    }

    const activeBudget = project.budgets[0];

    if (!activeBudget) {
      return res.json({
        success: true,
        data: {
          hasBudget: false,
          message: 'No active budget for this project',
        },
      });
    }

    // Category status
    const categoryStatus = activeBudget.categories.map((cat) => ({
      category: cat.category,
      subCategory: cat.subCategory,
      allocated: cat.allocatedAmount,
      spent: cat.spentAmount,
      committed: cat.committedAmount,
      remaining: cat.remainingAmount,
      utilization: cat.utilizationRate,
      status:
        cat.utilizationRate >= cat.criticalThreshold
          ? 'CRITICAL'
          : cat.utilizationRate >= cat.warningThreshold
            ? 'WARNING'
            : 'HEALTHY',
    }));

    // Alerts
    const alerts = await prisma.budgetAlert.count({
      where: {
        budgetId: activeBudget.id,
        isResolved: false,
      },
    });

    res.json({
      success: true,
      data: {
        hasBudget: true,
        budget: {
          id: activeBudget.id,
          name: activeBudget.name,
          totalApproved: activeBudget.totalApproved,
          totalSpent: activeBudget.totalSpent,
          totalCommitted: activeBudget.totalCommitted,
          totalRemaining: activeBudget.totalRemaining,
          utilizationRate: activeBudget.utilizationRate,
          contingencyRemaining: activeBudget.contingencyRemaining,
        },
        categoryStatus,
        alerts,
        projectProgress: project.progress,
        projectStatus: project.status,
      },
    });
  } catch (error) {
    console.error('Get project budget status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getBudgetUtilizationReport = async (req, res) => {
  try {
    const { projectId, fromDate, toDate, format = 'json' } = req.query;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view reports',
      });
    }

    const where = {
      companyId: req.user.companyId,
      isActive: true,
    };

    if (projectId) where.projectId = projectId;

    const budgets = await prisma.budget.findMany({
      where,
      include: {
        project: {
          select: {
            id: true,
            name: true,
            projectId: true,
          },
        },
        categories: true,
      },
    });

    const report = budgets.map((budget) => ({
      projectName: budget.project.name,
      budgetName: budget.name,
      totalApproved: budget.totalApproved,
      totalSpent: budget.totalSpent,
      totalCommitted: budget.totalCommitted,
      utilizationRate: budget.utilizationRate,
      remainingBudget: budget.totalRemaining,
      categories: budget.categories.map((cat) => ({
        category: cat.category,
        allocated: cat.allocatedAmount,
        spent: cat.spentAmount,
        utilization: cat.utilizationRate,
      })),
    }));

    if (format === 'csv') {
      // Convert to CSV
      const csv = [
        [
          'Project',
          'Budget',
          'Approved',
          'Spent',
          'Utilization%',
          'Remaining',
        ].join(','),
        ...report.map((r) =>
          [
            r.projectName,
            r.budgetName,
            r.totalApproved,
            r.totalSpent,
            r.utilizationRate.toFixed(2),
            r.remainingBudget,
          ].join(',')
        ),
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=budget-utilization.csv'
      );
      return res.send(csv);
    }

    res.json({
      success: true,
      data: report,
    });
  } catch (error) {
    console.error('Get budget utilization report error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getBudgetVarianceReport = async (req, res) => {
  try {
    const { budgetId, fromDate, toDate } = req.query;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view reports',
      });
    }

    const where = {
      budget: {
        companyId: req.user.companyId,
      },
    };

    if (budgetId) where.budgetId = budgetId;

    const forecasts = await prisma.budgetForecast.findMany({
      where,
      include: {
        budget: {
          include: {
            project: {
              select: { name: true },
            },
          },
        },
      },
      orderBy: { forecastMonth: 'asc' },
    });

    const report = forecasts.map((f) => ({
      projectName: f.budget.project.name,
      budgetName: f.budget.name,
      month: f.forecastMonth,
      forecastAmount: f.forecastAmount,
      actualAmount: f.actualAmount || 0,
      variance: f.variance || 0,
      variancePercent: f.variancePercent || 0,
      confidenceLevel: f.confidenceLevel,
    }));

    res.json({
      success: true,
      data: report,
    });
  } catch (error) {
    console.error('Get budget variance report error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getCategorySpendingReport = async (req, res) => {
  try {
    const { projectId, fromDate, toDate } = req.query;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view reports',
      });
    }

    const where = {
      budget: {
        companyId: req.user.companyId,
        isActive: true,
      },
    };

    if (projectId) {
      where.budget.projectId = projectId;
    }

    if (fromDate || toDate) {
      where.transactionDate = {};
      if (fromDate) where.transactionDate.gte = new Date(fromDate);
      if (toDate) where.transactionDate.lte = new Date(toDate);
    }

    const transactions = await prisma.budgetTransaction.findMany({
      where,
      include: {
        budget: {
          include: {
            project: {
              select: { name: true },
            },
          },
        },
        category: true,
      },
    });

    // Group by category
    const categorySpending = {};
    transactions.forEach((t) => {
      const cat = t.category.category;
      if (!categorySpending[cat]) {
        categorySpending[cat] = {
          totalSpent: 0,
          transactions: 0,
          projects: new Set(),
        };
      }
      categorySpending[cat].totalSpent += t.totalAmount;
      categorySpending[cat].transactions += 1;
      categorySpending[cat].projects.add(t.budget.project.name);
    });

    // Convert Sets to arrays
    Object.keys(categorySpending).forEach((key) => {
      categorySpending[key].projects = Array.from(
        categorySpending[key].projects
      );
    });

    res.json({
      success: true,
      data: categorySpending,
    });
  } catch (error) {
    console.error('Get category spending report error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getCommitmentTrackingReport = async (req, res) => {
  try {
    const { projectId, status = 'COMMITTED' } = req.query;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view reports',
      });
    }

    const where = {
      transactionType: 'COMMITMENT',
      status,
      budget: {
        companyId: req.user.companyId,
        isActive: true,
      },
    };

    if (projectId) {
      where.budget.projectId = projectId;
    }

    const commitments = await prisma.budgetTransaction.findMany({
      where,
      include: {
        budget: {
          include: {
            project: {
              select: { name: true },
            },
          },
        },
        category: true,
        materialRequest: {
          select: {
            requestNo: true,
            materialName: true,
          },
        },
      },
      orderBy: { transactionDate: 'desc' },
    });

    const report = commitments.map((c) => ({
      commitmentNo: c.transactionNo,
      date: c.transactionDate,
      projectName: c.budget.project.name,
      category: c.category.category,
      description: c.description,
      amount: c.amount,
      materialRequest: c.materialRequest?.requestNo,
      materialName: c.materialRequest?.materialName,
      status: c.status,
    }));

    // Summary
    const summary = {
      totalCommitments: commitments.length,
      totalAmount: commitments.reduce((sum, c) => sum + c.amount, 0),
    };

    res.json({
      success: true,
      data: {
        summary,
        commitments: report,
      },
    });
  } catch (error) {
    console.error('Get commitment tracking report error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// ==================== MATERIAL REQUEST INTEGRATION ====================

export const checkBudgetBeforeRequest = async (req, res) => {
  try {
    const { projectId, category, estimatedCost } = req.query;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to check budget',
      });
    }

    // Find active budget for project
    const activeBudget = await prisma.budget.findFirst({
      where: {
        projectId,
        companyId: req.user.companyId,
        isActive: true,
        status: 'ACTIVE',
      },
      include: {
        categories: {
          where: { category: category },
        },
      },
    });

    if (!activeBudget) {
      return res.json({
        success: true,
        data: {
          hasBudget: false,
          message: 'No active budget found for this project',
          canProceed: false,
        },
      });
    }

    const budgetCategory = activeBudget.categories[0];

    if (!budgetCategory) {
      return res.json({
        success: true,
        data: {
          hasBudget: true,
          hasCategory: false,
          message: `Category ${category} not found in budget`,
          canProceed: false,
        },
      });
    }

    const estimatedAmount = parseFloat(estimatedCost);
    const isAvailable = budgetCategory.remainingAmount >= estimatedAmount;
    const utilizationAfterRequest =
      ((budgetCategory.spentAmount + estimatedAmount) /
        budgetCategory.allocatedAmount) *
      100;

    res.json({
      success: true,
      data: {
        hasBudget: true,
        hasCategory: true,
        budgetId: activeBudget.id,
        categoryId: budgetCategory.id,
        categoryName: budgetCategory.category,
        allocatedAmount: budgetCategory.allocatedAmount,
        spentAmount: budgetCategory.spentAmount,
        committedAmount: budgetCategory.committedAmount,
        remainingAmount: budgetCategory.remainingAmount,
        requestedAmount: estimatedAmount,
        isAvailable,
        utilizationAfterRequest,
        warningThreshold: budgetCategory.warningThreshold,
        criticalThreshold: budgetCategory.criticalThreshold,
        willCrossWarning:
          utilizationAfterRequest >= budgetCategory.warningThreshold,
        willCrossCritical:
          utilizationAfterRequest >= budgetCategory.criticalThreshold,
        canProceed: isAvailable,
      },
    });
  } catch (error) {
    console.error('Check budget before request error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const commitBudgetToRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { budgetId, categoryId, estimatedCost } = req.body;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to commit budget',
      });
    }

    // Get material request
    const materialRequest = await prisma.materialRequest.findFirst({
      where: {
        id: requestId,
        project: {
          companyId: req.user.companyId,
        },
      },
    });

    if (!materialRequest) {
      return res.status(404).json({
        success: false,
        message: 'Material request not found',
      });
    }

    if (materialRequest.committedToBudget) {
      return res.status(400).json({
        success: false,
        message: 'Budget already committed to this request',
      });
    }

    const commitmentAmount = estimatedCost || materialRequest.estimatedCost;
    if (!commitmentAmount || commitmentAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Estimated cost is required to commit budget',
      });
    }

    const commitment = await prisma.$transaction(async (tx) => {
      // Create commitment
      const txn = await tx.budgetTransaction.create({
        data: {
          transactionNo: `CMT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          budgetId,
          categoryId,
          transactionType: 'COMMITMENT',
          status: 'COMMITTED',
          description: `Budget commitment for material request: ${materialRequest.requestNo}`,
          amount: commitmentAmount,
          committedAmount: commitmentAmount,
          totalAmount: commitmentAmount,
          referenceType: 'MATERIAL_REQUEST',
          referenceId: requestId,
          referenceNo: materialRequest.requestNo,
          materialRequestId: requestId,
          transactionDate: new Date(),
          committedDate: new Date(),
          createdById: req.user.userId,
        },
      });

      // Update material request
      await tx.materialRequest.update({
        where: { id: requestId },
        data: {
          committedToBudget: true,
          estimatedCost: commitmentAmount,
        },
      });

      // Update category
      await tx.budgetCategoryAllocation.update({
        where: { id: categoryId },
        data: {
          committedAmount: { increment: commitmentAmount },
          remainingAmount: { decrement: commitmentAmount },
        },
      });

      return txn;
    });

    // Update budget summary
    await calculateBudgetSummary(budgetId);

    // Check alerts
    await checkBudgetAlerts(budgetId, req.user.userId, categoryId);

    res.json({
      success: true,
      message: 'Budget committed to request successfully',
      data: commitment,
    });
  } catch (error) {
    console.error('Commit budget to request error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getBudgetStatusForRequest = async (req, res) => {
  try {
    const { requestId } = req.params;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view budget status',
      });
    }

    const materialRequest = await prisma.materialRequest.findFirst({
      where: {
        id: requestId,
        project: {
          companyId: req.user.companyId,
        },
      },
      include: {
        budgetTransactions: {
          include: {
            budget: {
              select: {
                id: true,
                name: true,
                budgetNo: true,
              },
            },
            category: {
              select: {
                category: true,
                allocatedAmount: true,
                remainingAmount: true,
              },
            },
          },
        },
      },
    });

    if (!materialRequest) {
      return res.status(404).json({
        success: false,
        message: 'Material request not found',
      });
    }

    res.json({
      success: true,
      data: {
        requestNo: materialRequest.requestNo,
        committedToBudget: materialRequest.committedToBudget,
        estimatedCost: materialRequest.estimatedCost,
        poCreated: materialRequest.poCreated,
        poNumber: materialRequest.poNumber,
        commitments: materialRequest.budgetTransactions,
      },
    });
  } catch (error) {
    console.error('Get budget status for request error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const createPOFromRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { poData } = req.body;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create PO from request',
      });
    }

    const materialRequest = await prisma.materialRequest.findFirst({
      where: {
        id: requestId,
        project: {
          companyId: req.user.companyId,
        },
      },
      include: {
        budgetTransactions: {
          where: {
            transactionType: 'COMMITMENT',
            status: 'COMMITTED',
          },
        },
      },
    });

    if (!materialRequest) {
      return res.status(404).json({
        success: false,
        message: 'Material request not found',
      });
    }

    if (materialRequest.poCreated) {
      return res.status(400).json({
        success: false,
        message: 'PO already created for this request',
      });
    }

    const supplier = await prisma.supplier.findFirst({
      where: {
        id: poData.supplierId,
        companyId: req.user.companyId,
        status: 'ACTIVE',
      },
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found or inactive',
      });
    }

    // Generate PO number
    const year = new Date().getFullYear();
    const poCount = await prisma.purchaseOrder.count({
      where: {
        companyId: req.user.companyId,
        createdAt: {
          gte: new Date(year, 0, 1),
          lt: new Date(year + 1, 0, 1),
        },
      },
    });
    const poNumber = `PO-${year}-${String(poCount + 1).padStart(4, '0')}`;

    const created = await prisma.$transaction(async (tx) => {
      // Create PO
      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          poNumber,
          projectId: materialRequest.projectId,
          companyId: req.user.companyId,
          title: `PO for ${materialRequest.materialName}`,
          description: materialRequest.purpose,
          type: 'MATERIAL',
          status: 'DRAFT',
          supplierId: supplier.id,
          supplierName: supplier.name,
          supplierAddress: supplier.address,
          supplierGST: supplier.gstNumber,
          supplierPAN: supplier.panNumber,
          supplierContact: supplier.contactPerson,
          supplierEmail: supplier.email,
          supplierPhone: supplier.phone,
          subtotal: poData.amount || materialRequest.estimatedCost,
          taxAmount: poData.taxAmount || 0,
          totalAmount:
            (poData.amount || materialRequest.estimatedCost) +
            (poData.taxAmount || 0),
          paymentTerm:
            poData.paymentTerm || supplier.defaultPaymentTerm || 'NET_30',
          orderDate: new Date(),
          expectedDelivery: poData.expectedDelivery
            ? new Date(poData.expectedDelivery)
            : null,
          deliveryAddress: poData.deliveryAddress,
          requestedById: req.user.userId,
          createdById: req.user.userId,
          budgetId: materialRequest.budgetTransactions[0]?.budgetId,
          budgetTransactionId: materialRequest.budgetTransactions[0]?.id,
        },
      });

      // Create PO item
      const itemAmount = poData.amount || materialRequest.estimatedCost || 0;
      const unitPrice =
        materialRequest.quantity > 0
          ? itemAmount / materialRequest.quantity
          : 0;

      const poItem = await tx.purchaseOrderItem.create({
        data: {
          purchaseOrderId: purchaseOrder.id,
          lineNo: 1,
          description: materialRequest.materialName,
          materialId: materialRequest.materialId,
          quantity: materialRequest.quantity,
          unit: materialRequest.unit,
          unitPrice,
          totalPrice: itemAmount,
          taxPercent: poData.taxPercent || 18,
          taxAmount: poData.taxAmount || 0,
          pendingQuantity: materialRequest.quantity,
          budgetCategoryId: materialRequest.budgetTransactions[0]?.categoryId,
        },
      });

      // Update material request (link to PO and PO item)
      await tx.materialRequest.update({
        where: { id: requestId },
        data: {
          poCreated: true,
          poNumber,
          purchaseOrderId: purchaseOrder.id,
          purchaseOrderItemId: poItem.id,
          poItemId: poItem.id,
        },
      });

      // Update commitment if exists
      if (materialRequest.budgetTransactions[0]) {
        await tx.budgetTransaction.update({
          where: { id: materialRequest.budgetTransactions[0].id },
          data: {
            referenceType: 'PURCHASE_ORDER',
            referenceId: purchaseOrder.id,
            referenceNo: poNumber,
          },
        });
      }

      return purchaseOrder;
    });

    res.status(201).json({
      success: true,
      message: 'Purchase Order created successfully from request',
      data: created,
    });
  } catch (error) {
    console.error('Create PO from request error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// ==================== APPROVALS ====================

export const getPendingBudgetApprovals = async (req, res) => {
  try {
    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_APPROVE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view pending approvals',
      });
    }

    const pendingBudgets = await prisma.budget.findMany({
      where: {
        companyId: req.user.companyId,
        status: 'PENDING_APPROVAL',
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            projectId: true,
          },
        },
        requestedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        categories: true,
      },
      orderBy: { requestedAt: 'asc' },
    });

    const pendingRevisions = await prisma.budgetRevision.findMany({
      where: {
        budget: {
          companyId: req.user.companyId,
        },
        approvedAt: null,
        rejectionReason: null,
      },
      include: {
        budget: {
          include: {
            project: {
              select: { name: true },
            },
          },
        },
        requestedBy: {
          select: { name: true },
        },
      },
    });

    res.json({
      success: true,
      data: {
        budgets: pendingBudgets,
        revisions: pendingRevisions,
      },
    });
  } catch (error) {
    console.error('Get pending budget approvals error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
export const approveBudget = async (req, res) => {
  try {
    const { id } = req.params;
    const { approvalNotes } = req.body || {};

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_APPROVE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to approve budgets',
      });
    }

    const budget = await prisma.budget.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        status: 'PENDING_APPROVAL',
      },
      include: {
        categories: true, // Included so we can initialize their remaining amounts
      },
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Pending budget not found',
      });
    } // Process everything inside a transaction to ensure database integrity

    await prisma.$transaction(async (tx) => {
      // 1. Deactivate other active budgets for this project
      await tx.budget.updateMany({
        where: {
          projectId: budget.projectId,
          id: { not: id },
          isActive: true,
        },
        data: { isActive: false },
      }); // 2. Initialize remaining amounts for all categories

      for (const category of budget.categories) {
        // Safe calculation: allocated minus any draft spends/commitments
        const remaining =
          category.allocatedAmount -
          (category.spentAmount || 0) -
          (category.committedAmount || 0);
        await tx.budgetCategoryAllocation.update({
          where: { id: category.id },
          data: { remainingAmount: remaining },
        });
      } // 3. Approve the main budget and set its total remaining pool

      const totalRemaining =
        budget.totalApproved -
        (budget.totalSpent || 0) -
        (budget.totalCommitted || 0);

      await tx.budget.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedById: req.user.userId,
          approvedAt: new Date(),
          approvalNotes,
          isActive: true,
          totalRemaining: totalRemaining,
        },
      }); // 4. Update project's active budget tracker
      await tx.project.update({
        where: { id: budget.projectId },
        data: { activeBudgetId: id },
      });
    }); // Fetch the completely updated budget with the new category values to return
    const approvedBudget = await prisma.budget.findUnique({
      where: { id },
      include: {
        categories: true,
      },
    });

    res.json({
      success: true,
      message: 'Budget approved successfully',
      data: approvedBudget,
    });
  } catch (error) {
    console.error('Approve budget error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const rejectBudget = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body || {};

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_APPROVE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to reject budgets',
      });
    }

    const budget = await prisma.budget.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        status: 'PENDING_APPROVAL',
      },
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Pending budget not found',
      });
    }

    const rejectedBudget = await prisma.budget.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectionReason,
      },
    });

    res.json({
      success: true,
      message: 'Budget rejected',
      data: rejectedBudget,
    });
  } catch (error) {
    console.error('Reject budget error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// ==================== AUDIT ====================

export const getBudgetAuditTrail = async (req, res) => {
  try {
    const { budgetId } = req.params;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view audit trail',
      });
    }

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        companyId: req.user.companyId,
        OR: [
          { entityType: 'BUDGET', entityId: budgetId },
          {
            entityType: 'BUDGET_CATEGORY',
            entityId: { in: await getCategoryIds(budgetId) },
          },
        ],
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { timestamp: 'desc' },
    });

    res.json({
      success: true,
      data: auditLogs,
    });
  } catch (error) {
    console.error('Get budget audit trail error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Helper to get category IDs
const getCategoryIds = async (budgetId) => {
  const categories = await prisma.budgetCategoryAllocation.findMany({
    where: { budgetId },
    select: { id: true },
  });
  return categories.map((c) => c.id);
};

// ==================== SEARCH ====================

export const searchBudgets = async (req, res) => {
  try {
    const { q, status, projectId, fromDate, toDate } = req.query;

    const hasPermission = await checkBudgetPermission(
      req.user.userId,
      req.user.companyId,
      'BUDGET_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to search budgets',
      });
    }

    const where = {
      companyId: req.user.companyId,
    };

    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { budgetNo: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (status) where.status = status;
    if (projectId) where.projectId = projectId;
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
    }

    const budgets = await prisma.budget.findMany({
      where,
      include: {
        project: {
          select: {
            id: true,
            name: true,
            projectId: true,
          },
        },
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: budgets,
    });
  } catch (error) {
    console.error('Search budgets error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
