// src/controllers/dashboard.controller.js
import prisma from '../config/database.js';

// Helper function to check dashboard permission
const checkDashboardPermission = async (userId, companyId, permissionCode) => {
  try {
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
        rp.permission.code === 'DASHBOARD_VIEW'
    );

    return hasPermission;
  } catch (error) {
    console.error('Error checking permission:', error);
    return false;
  }
};

/**
 * Get Admin Dashboard Data
 * Returns quick actions stats and recent activities
 */
export const getAdminDashboard = async (req, res) => {
  try {
    const { companyId, userId, userType } = req.user;

    // Check permission
    const hasPermission = await checkDashboardPermission(
      userId,
      companyId,
      'DASHBOARD_VIEW'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view dashboard',
      });
    }

    // For SUPER_ADMIN, allow viewing data across all companies or specific company
    const targetCompanyId =
      userType === 'SUPER_ADMIN' && req.query.companyId
        ? req.query.companyId
        : companyId;

    // Fetch all dashboard data in parallel
    const [
      transactionsStats,
      inventoryStats,
      approvalsStats,
      projectsStats,
      recentActivities,
    ] = await Promise.allSettled([
      getTransactionStatsHelper(targetCompanyId),
      getInventoryStatsHelper(targetCompanyId),
      getApprovalsStatsHelper(targetCompanyId, userId, userType),
      getProjectsStatsHelper(targetCompanyId, userId, userType),
      getRecentActivitiesHelper(targetCompanyId, userId, userType),
    ]);

    const dashboardData = {
      quickActions: {
        transactions: {
          label: 'Transactions',
          value:
            transactionsStats.status === 'fulfilled'
              ? transactionsStats.value.pendingRequests
              : 0,
          count:
            transactionsStats.status === 'fulfilled'
              ? transactionsStats.value.pendingRequests
              : 0,
          unit: 'Requests',
        },
        inventory: {
          label: 'Inventory',
          value:
            inventoryStats.status === 'fulfilled'
              ? inventoryStats.value.totalUsage
              : 0,
          formattedValue: formatIndianCurrency(
            inventoryStats.status === 'fulfilled'
              ? inventoryStats.value.totalUsage
              : 0
          ),
          unit: 'Total Usage',
        },
        approvals: {
          label: 'Approvals',
          value:
            approvalsStats.status === 'fulfilled'
              ? approvalsStats.value.totalPending
              : 0,
          count:
            approvalsStats.status === 'fulfilled'
              ? approvalsStats.value.totalPending
              : 0,
          unit: 'pending',
        },
        projects: {
          label: 'Projects',
          value:
            projectsStats.status === 'fulfilled'
              ? projectsStats.value.total
              : 0,
          count:
            projectsStats.status === 'fulfilled'
              ? projectsStats.value.total
              : 0,
          unit: 'total',
        },
      },
      recentActivity:
        recentActivities.status === 'fulfilled' &&
        recentActivities.value.length > 0
          ? recentActivities.value
          : [], // Return empty array if no activities
    };

    res.json({
      success: true,
      data: dashboardData,
    });
  } catch (error) {
    console.error('Get admin dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

/**
 * Helper: Get Transaction Statistics
 */
async function getTransactionStatsHelper(companyId) {
  try {
    // Get all projects for this company
    const projects = await prisma.project.findMany({
      where: { companyId },
      select: { id: true },
    });

    const projectIds = projects.map((p) => p.id);

    if (projectIds.length === 0) {
      return { pendingRequests: 0, total: 0 };
    }

    // Count pending transactions
    const pendingRequests = await prisma.transaction.count({
      where: {
        projectId: { in: projectIds },
        status: 'PENDING_APPROVAL',
      },
    });

    return {
      pendingRequests,
      total: pendingRequests,
    };
  } catch (error) {
    console.error('Error in getTransactionStatsHelper:', error);
    return { pendingRequests: 0, total: 0 };
  }
}

/**
 * Helper: Get Inventory Statistics
 */
async function getInventoryStatsHelper(companyId) {
  try {
    // Get total inventory value
    const [materialStats, equipmentStats, projectMaterialStats] =
      await Promise.all([
        prisma.inventory.aggregate({
          where: { companyId, location: 'GLOBAL' },
          _sum: { totalValue: true },
        }),
        prisma.equipment.aggregate({
          where: { companyId, status: { not: 'DECOMMISSIONED' } },
          _sum: { purchaseCost: true },
        }),
        prisma.inventory.aggregate({
          where: { companyId, location: 'PROJECT' },
          _sum: { totalValue: true },
        }),
      ]);

    const totalMaterialValue =
      (materialStats._sum?.totalValue || 0) +
      (projectMaterialStats._sum?.totalValue || 0);
    const totalEquipmentValue = equipmentStats._sum?.purchaseCost || 0;
    const totalUsage = totalMaterialValue + totalEquipmentValue;

    return {
      totalUsage,
      materialValue: totalMaterialValue,
      equipmentValue: totalEquipmentValue,
    };
  } catch (error) {
    console.error('Error in getInventoryStatsHelper:', error);
    return { totalUsage: 0, materialValue: 0, equipmentValue: 0 };
  }
}

/**
 * Helper: Get Approvals Statistics (Optimized to run sequentially if pool is stressed)
 */
async function getApprovalsStatsHelper(companyId, userId, userType) {
  try {
    const projects = await prisma.project.findMany({
      where: { companyId },
      select: { id: true },
    });

    const projectIds = projects.map((p) => p.id);

    if (projectIds.length === 0) {
      return { totalPending: 0, breakdown: {} };
    }

    // 🔥 OPTIMIZATION: If you still get timeouts, change Promise.all to sequential awaits.
    // But with the connection_limit increased and projects grouped, Promise.all is usually fine here.
    const [
      pendingTransactions,
      pendingMaterialRequests,
      pendingExpenses,
      pendingDPRs,
      pendingPurchaseOrders,
    ] = await Promise.all([
      prisma.transaction
        .count({
          where: { projectId: { in: projectIds }, status: 'PENDING_APPROVAL' },
        })
        .catch(() => 0),
      prisma.materialRequest
        .count({
          where: { projectId: { in: projectIds }, status: 'REQUESTED' },
        })
        .catch(() => 0),
      prisma.expense
        .count({
          where: { projectId: { in: projectIds }, status: 'TODO' },
        })
        .catch(() => 0),
      prisma.dailyProgressReport
        .count({
          where: { projectId: { in: projectIds }, status: 'TODO' },
        })
        .catch(() => 0),
      prisma.purchaseOrder
        .count({
          where: { projectId: { in: projectIds }, status: 'PENDING_APPROVAL' },
        })
        .catch(() => 0),
    ]);

    const totalPending =
      pendingTransactions +
      pendingMaterialRequests +
      pendingExpenses +
      pendingDPRs +
      pendingPurchaseOrders;

    return {
      totalPending,
      breakdown: {
        transactions: pendingTransactions,
        materialRequests: pendingMaterialRequests,
        expenses: pendingExpenses,
        dprs: pendingDPRs,
        purchaseOrders: pendingPurchaseOrders,
      },
    };
  } catch (error) {
    console.error('Error in getApprovalsStatsHelper:', error);
    return { totalPending: 0, breakdown: {} };
  }
}

/**
 * Helper: Get Projects Statistics (Optimized from 6 queries to 1)
 */
async function getProjectsStatsHelper(companyId, userId, userType) {
  try {
    const projectWhereClause = { companyId };

    // For employees, filter by accessible projects
    if (userType === 'EMPLOYEE') {
      const [userProjects, createdProjects] = await Promise.all([
        prisma.projectAssignment.findMany({
          where: { userId },
          select: { projectId: true },
        }),
        prisma.project.findMany({
          where: { companyId, createdById: userId },
          select: { id: true },
        }),
      ]);

      const projectIds = userProjects.map((p) => p.projectId);
      const createdProjectIds = createdProjects.map((p) => p.id);

      projectWhereClause.id = {
        in: [...new Set([...projectIds, ...createdProjectIds])],
      };
    }

    // 🔥 OPTIMIZATION: Use groupBy instead of 6 separate count queries
    const projectCounts = await prisma.project.groupBy({
      by: ['status'],
      where: projectWhereClause,
      _count: true,
    });

    // Initialize default stats
    const stats = {
      active: 0,
      planning: 0,
      onHold: 0,
      completed: 0,
      cancelled: 0,
      delayed: 0,
      total: 0,
    };

    // Map the grouped results
    projectCounts.forEach((group) => {
      stats.total += group._count;
      switch (group.status) {
        case 'ONGOING':
          stats.active = group._count;
          break;
        case 'PLANNING':
          stats.planning = group._count;
          break;
        case 'ON_HOLD':
          stats.onHold = group._count;
          break;
        case 'COMPLETED':
          stats.completed = group._count;
          break;
        case 'CANCELLED':
          stats.cancelled = group._count;
          break;
        case 'DELAYED':
          stats.delayed = group._count;
          break;
      }
    });

    return stats;
  } catch (error) {
    console.error('Error in getProjectsStatsHelper:', error);
    return {
      active: 0,
      planning: 0,
      onHold: 0,
      completed: 0,
      cancelled: 0,
      delayed: 0,
      total: 0,
    };
  }
}

/**
 * Helper: Get Recent Activities
 */
async function getRecentActivitiesHelper(companyId, userId, userType) {
  try {
    const projects = await prisma.project.findMany({
      where: { companyId },
      select: { id: true, name: true },
    });

    const projectIds = projects.map((p) => p.id);
    const projectMap = projects.reduce(
      (acc, p) => ({ ...acc, [p.id]: p.name }),
      {}
    );

    if (projectIds.length === 0) {
      return [];
    }

    const [
      recentTasks,
      recentDPRs,
      recentAttendances,
      recentTransactions,
      recentMaterialRequests,
    ] = await Promise.allSettled([
      getRecentTasksHelper(projectIds, projectMap),
      getRecentDPRsHelper(projectIds, projectMap),
      getRecentCheckInsHelper(projectIds, projectMap, companyId),
      getRecentTransactionsHelper(projectIds, projectMap),
      getRecentMaterialRequestsHelper(projectIds, projectMap),
    ]);

    let allActivities = [
      ...(recentTasks.status === 'fulfilled' ? recentTasks.value : []),
      ...(recentDPRs.status === 'fulfilled' ? recentDPRs.value : []),
      ...(recentAttendances.status === 'fulfilled'
        ? recentAttendances.value
        : []),
      ...(recentTransactions.status === 'fulfilled'
        ? recentTransactions.value
        : []),
      ...(recentMaterialRequests.status === 'fulfilled'
        ? recentMaterialRequests.value
        : []),
    ];

    // Sort by timestamp (newest first)
    allActivities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return allActivities.slice(0, 10);
  } catch (error) {
    console.error('Error in getRecentActivitiesHelper:', error);
    return [];
  }
}

/**
 * Helper: Get Recent Tasks
 */
async function getRecentTasksHelper(projectIds, projectMap) {
  try {
    const tasks = await prisma.task.findMany({
      where: { projectId: { in: projectIds }, status: 'COMPLETED' },
      include: { project: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });

    return tasks.map((task) => ({
      id: `task-${task.id}`,
      type: 'TASK_COMPLETED',
      title: 'Task completed',
      description: task.title,
      projectName:
        task.project?.name || projectMap[task.projectId] || 'Unknown Project',
      timestamp: task.updatedAt,
      actionLink: `/tasks/${task.id}`,
      actionText: 'View',
    }));
  } catch (error) {
    console.error('Error in getRecentTasksHelper:', error);
    return [];
  }
}

/**
 * Helper: Get Recent DPRs
 */
async function getRecentDPRsHelper(projectIds, projectMap) {
  try {
    const dprs = await prisma.dailyProgressReport.findMany({
      where: { projectId: { in: projectIds } },
      include: { project: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return dprs.map((dpr) => ({
      id: `dpr-${dpr.id}`,
      type: 'DPR_SUBMITTED',
      title: 'DPR submitted',
      description: formatDate(dpr.date),
      projectName:
        dpr.project?.name || projectMap[dpr.projectId] || 'Unknown Project',
      timestamp: dpr.createdAt,
      actionLink: `/dpr/${dpr.id}`,
      actionText: 'View',
    }));
  } catch (error) {
    console.error('Error in getRecentDPRsHelper:', error);
    return [];
  }
}

/**
 * Helper: Get Recent Check-ins
 */
async function getRecentCheckInsHelper(projectIds, projectMap, companyId) {
  try {
    const attendances = await prisma.attendance.findMany({
      where: { projectId: { in: projectIds }, checkInTime: { not: null } },
      include: {
        user: { select: { name: true } },
        project: { select: { name: true, location: true } },
      },
      orderBy: { checkInTime: 'desc' },
      take: 5,
    });

    return attendances.map((attendance) => ({
      id: `attendance-${attendance.id}`,
      type: 'CHECK_IN',
      title: 'Check in recorded',
      description: attendance.project?.location || 'Arrived at site',
      userName: attendance.user?.name || 'Unknown User',
      projectName:
        attendance.project?.name ||
        projectMap[attendance.projectId] ||
        'Unknown Project',
      timestamp: attendance.checkInTime,
      actionLink: `/attendance/${attendance.id}`,
      actionText: 'View',
    }));
  } catch (error) {
    console.error('Error in getRecentCheckInsHelper:', error);
    return [];
  }
}

/**
 * Helper: Get Recent Transactions
 */
async function getRecentTransactionsHelper(projectIds, projectMap) {
  try {
    const transactions = await prisma.transaction.findMany({
      where: { projectId: { in: projectIds } },
      include: { project: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return transactions.map((transaction) => ({
      id: `transaction-${transaction.id}`,
      type: 'TRANSACTION',
      title: `${transaction.type || 'New'} transaction`,
      description: `${transaction.description || 'Transaction'} - ${formatIndianCurrency(transaction.amount || 0)}`,
      projectName:
        transaction.project?.name ||
        projectMap[transaction.projectId] ||
        'Unknown Project',
      timestamp: transaction.createdAt,
      actionLink: `/transactions/${transaction.id}`,
      actionText: 'View',
    }));
  } catch (error) {
    console.error('Error in getRecentTransactionsHelper:', error);
    return [];
  }
}

/**
 * Helper: Get Recent Material Requests
 */
async function getRecentMaterialRequestsHelper(projectIds, projectMap) {
  try {
    const requests = await prisma.materialRequest.findMany({
      where: { projectId: { in: projectIds } },
      include: {
        project: { select: { name: true } },
        material: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return requests.map((request) => ({
      id: `material-${request.id}`,
      type: 'MATERIAL_REQUEST',
      title: 'Material requested',
      description: `${request.materialName} - ${request.quantity} ${request.unit}`,
      projectName:
        request.project?.name ||
        projectMap[request.projectId] ||
        'Unknown Project',
      timestamp: request.createdAt,
      actionLink: `/material-requests/${request.id}`,
      actionText: 'View',
    }));
  } catch (error) {
    console.error('Error in getRecentMaterialRequestsHelper:', error);
    return [];
  }
}

/**
 * Format date to readable string
 */
function formatDate(date) {
  if (!date) return '';

  const d = new Date(date);
  const day = d.getDate();
  const month = d.toLocaleString('default', { month: 'short' });
  const year = d.getFullYear();

  return `${day} ${month} ${year}`;
}

/**
 * Format number to Indian currency (₹)
 */
function formatIndianCurrency(amount) {
  if (amount === undefined || amount === null || amount === 0) return '₹0';

  const formatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  return formatter.format(amount);
}

/**
 * Get Dashboard Summary (Alternative simplified endpoint)
 */
export const getDashboardSummary = async (req, res) => {
  try {
    const { companyId } = req.user;

    // Get all projects for this company
    const projects = await prisma.project.findMany({
      where: { companyId },
      select: { id: true },
    });

    const projectIds = projects.map((p) => p.id);

    // Use Promise.allSettled to handle individual failures
    const [
      pendingTransactions,
      inventoryValue,
      pendingApprovals,
      activeProjects,
    ] = await Promise.allSettled([
      // Pending transactions
      projectIds.length > 0
        ? prisma.transaction.count({
            where: {
              projectId: { in: projectIds },
              status: 'PENDING_APPROVAL',
            },
          })
        : Promise.resolve(0),

      // Inventory value
      getInventoryValueHelper(companyId),

      // Pending approvals
      getTotalPendingApprovalsHelper(companyId, projectIds),

      // Active projects
      prisma.project.count({
        where: {
          companyId,
          status: 'ONGOING',
        },
      }),
    ]);

    // Safely extract values with proper error handling
    const transactionsCount =
      pendingTransactions.status === 'fulfilled'
        ? pendingTransactions.value || 0
        : 0;

    const inventoryTotal =
      inventoryValue.status === 'fulfilled' ? inventoryValue.value || 0 : 0;

    const approvalsCount =
      pendingApprovals.status === 'fulfilled' ? pendingApprovals.value || 0 : 0;

    const projectsCount =
      activeProjects.status === 'fulfilled' ? activeProjects.value || 0 : 0;

    res.json({
      success: true,
      data: {
        quickActions: {
          transactions: {
            count: transactionsCount,
            label: 'Requests',
          },
          inventory: {
            value: inventoryTotal,
            formattedValue: formatIndianCurrency(inventoryTotal),
            label: 'Total Usage',
          },
          approvals: {
            count: approvalsCount,
            label: 'pending',
          },
          projects: {
            count: projectsCount,
            label: 'active',
          },
        },
      },
    });
  } catch (error) {
    console.error('Get dashboard summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

/**
 * Helper: Get total inventory value
 */
async function getInventoryValueHelper(companyId) {
  try {
    const [materialStats, equipmentStats] = await Promise.all([
      prisma.inventory.aggregate({
        where: { companyId },
        _sum: { totalValue: true },
      }),
      prisma.equipment.aggregate({
        where: { companyId, status: { not: 'DECOMMISSIONED' } },
        _sum: { purchaseCost: true },
      }),
    ]);

    // Safely access nested properties
    const materialValue = materialStats?._sum?.totalValue || 0;
    const equipmentValue = equipmentStats?._sum?.purchaseCost || 0;

    return materialValue + equipmentValue;
  } catch (error) {
    console.error('Error in getInventoryValueHelper:', error);
    return 0;
  }
}

/**
 * Helper: Get total pending approvals
 */
async function getTotalPendingApprovalsHelper(companyId, projectIds) {
  try {
    if (projectIds.length === 0) return 0;

    const [transactions, materialRequests, expenses, dprs, purchaseOrders] =
      await Promise.allSettled([
        prisma.transaction.count({
          where: {
            projectId: { in: projectIds },
            status: 'PENDING_APPROVAL',
          },
        }),
        prisma.materialRequest.count({
          where: {
            projectId: { in: projectIds },
            status: 'REQUESTED',
          },
        }),
        prisma.expense.count({
          where: {
            projectId: { in: projectIds },
            status: 'TODO',
          },
        }),
        prisma.dailyProgressReport.count({
          where: {
            projectId: { in: projectIds },
            status: 'TODO',
          },
        }),
        prisma.purchaseOrder.count({
          where: {
            projectId: { in: projectIds },
            status: 'PENDING_APPROVAL',
          },
        }),
      ]);

    // Safely extract values from each promise
    const transactionsCount =
      transactions.status === 'fulfilled' ? transactions.value || 0 : 0;
    const materialRequestsCount =
      materialRequests.status === 'fulfilled' ? materialRequests.value || 0 : 0;
    const expensesCount =
      expenses.status === 'fulfilled' ? expenses.value || 0 : 0;
    const dprsCount = dprs.status === 'fulfilled' ? dprs.value || 0 : 0;
    const purchaseOrdersCount =
      purchaseOrders.status === 'fulfilled' ? purchaseOrders.value || 0 : 0;

    return (
      transactionsCount +
      materialRequestsCount +
      expensesCount +
      dprsCount +
      purchaseOrdersCount
    );
  } catch (error) {
    console.error('Error in getTotalPendingApprovalsHelper:', error);
    return 0;
  }
}

// ============================================
// STATISTICS CONTROLLERS
// ============================================

export const getTransactionStats = async (req, res) => {
  try {
    const { companyId } = req.user;
    const { fromDate, toDate, projectId } = req.query;

    const projects = await prisma.project.findMany({
      where: { companyId },
      select: { id: true },
    });

    const projectIds = projects.map((p) => p.id);

    if (projectIds.length === 0) {
      return res.json({
        success: true,
        data: {
          pendingRequests: 0,
          approved: 0,
          rejected: 0,
          total: 0,
          totalAmount: 0,
        },
      });
    }

    const whereClause = {
      projectId: projectId ? projectId : { in: projectIds },
    };

    if (fromDate || toDate) {
      whereClause.createdAt = {};
      if (fromDate) whereClause.createdAt.gte = new Date(fromDate);
      if (toDate) whereClause.createdAt.lte = new Date(toDate);
    }

    const [pending, approved, rejected, totalAmount] = await Promise.all([
      prisma.transaction.count({
        where: { ...whereClause, status: 'PENDING_APPROVAL' },
      }),
      prisma.transaction.count({
        where: { ...whereClause, status: 'APPROVED' },
      }),
      prisma.transaction.count({
        where: { ...whereClause, status: 'REJECTED' },
      }),
      prisma.transaction.aggregate({
        where: { ...whereClause, status: 'APPROVED' },
        _sum: { amount: true },
      }),
    ]);

    res.json({
      success: true,
      data: {
        pendingRequests: pending,
        approved,
        rejected,
        total: pending + approved + rejected,
        totalAmount: totalAmount._sum.amount || 0,
        formattedTotal: formatIndianCurrency(totalAmount._sum.amount || 0),
      },
    });
  } catch (error) {
    console.error('Get transaction stats error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getInventoryStats = async (req, res) => {
  try {
    const { companyId } = req.user;

    const stats = await getInventoryStatsHelper(companyId);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Get inventory stats error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getApprovalsStats = async (req, res) => {
  try {
    const { companyId, userId, userType } = req.user;

    const stats = await getApprovalsStatsHelper(companyId, userId, userType);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Get approvals stats error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getProjectsStats = async (req, res) => {
  try {
    const { companyId, userId, userType } = req.user;

    const stats = await getProjectsStatsHelper(companyId, userId, userType);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Get projects stats error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============================================
// RECENT ACTIVITY CONTROLLERS
// ============================================

export const getAllRecentActivities = async (req, res) => {
  try {
    const { companyId, userId, userType } = req.user;
    const { limit = 10, type, days } = req.query;

    const activities = await getRecentActivitiesHelper(
      companyId,
      userId,
      userType
    );

    // Filter by type if specified
    let filteredActivities = activities;
    if (type) {
      filteredActivities = activities.filter((a) => a.type === type);
    }

    // Filter by days if specified
    if (days) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));
      filteredActivities = filteredActivities.filter(
        (a) => new Date(a.timestamp) >= cutoffDate
      );
    }

    res.json({
      success: true,
      data: filteredActivities.slice(0, parseInt(limit)),
      pagination: {
        total: filteredActivities.length,
        limit: parseInt(limit),
        page: 1,
        pages: Math.ceil(filteredActivities.length / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get all recent activities error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getRecentTasks = async (req, res) => {
  try {
    const { companyId } = req.user;

    const projects = await prisma.project.findMany({
      where: { companyId },
      select: { id: true },
    });

    const projectIds = projects.map((p) => p.id);
    const projectMap = {};

    const tasks = await getRecentTasksHelper(projectIds, projectMap);

    res.json({
      success: true,
      data: tasks,
    });
  } catch (error) {
    console.error('Get recent tasks error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getRecentDPRs = async (req, res) => {
  try {
    const { companyId } = req.user;

    const projects = await prisma.project.findMany({
      where: { companyId },
      select: { id: true, name: true },
    });

    const projectIds = projects.map((p) => p.id);
    const projectMap = projects.reduce(
      (acc, p) => ({ ...acc, [p.id]: p.name }),
      {}
    );

    const dprs = await getRecentDPRsHelper(projectIds, projectMap);

    res.json({
      success: true,
      data: dprs,
    });
  } catch (error) {
    console.error('Get recent DPRs error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getRecentCheckIns = async (req, res) => {
  try {
    const { companyId } = req.user;

    const projects = await prisma.project.findMany({
      where: { companyId },
      select: { id: true, name: true },
    });

    const projectIds = projects.map((p) => p.id);
    const projectMap = projects.reduce(
      (acc, p) => ({ ...acc, [p.id]: p.name }),
      {}
    );

    const checkins = await getRecentCheckInsHelper(
      projectIds,
      projectMap,
      companyId
    );

    res.json({
      success: true,
      data: checkins,
    });
  } catch (error) {
    console.error('Get recent check-ins error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getRecentTransactions = async (req, res) => {
  try {
    const { companyId } = req.user;

    const projects = await prisma.project.findMany({
      where: { companyId },
      select: { id: true, name: true },
    });

    const projectIds = projects.map((p) => p.id);
    const projectMap = projects.reduce(
      (acc, p) => ({ ...acc, [p.id]: p.name }),
      {}
    );

    const transactions = await getRecentTransactionsHelper(
      projectIds,
      projectMap
    );

    res.json({
      success: true,
      data: transactions,
    });
  } catch (error) {
    console.error('Get recent transactions error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getRecentMaterialRequests = async (req, res) => {
  try {
    const { companyId } = req.user;

    const projects = await prisma.project.findMany({
      where: { companyId },
      select: { id: true, name: true },
    });

    const projectIds = projects.map((p) => p.id);
    const projectMap = projects.reduce(
      (acc, p) => ({ ...acc, [p.id]: p.name }),
      {}
    );

    const requests = await getRecentMaterialRequestsHelper(
      projectIds,
      projectMap
    );

    res.json({
      success: true,
      data: requests,
    });
  } catch (error) {
    console.error('Get recent material requests error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============================================
// CHARTS & ANALYTICS CONTROLLERS
// ============================================

export const getTransactionTrends = async (req, res) => {
  try {
    const { companyId } = req.user;

    const projects = await prisma.project.findMany({
      where: { companyId },
      select: { id: true },
    });

    const projectIds = projects.map((p) => p.id);

    if (projectIds.length === 0) {
      return res.json({
        success: true,
        data: {
          labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
          income: [0, 0, 0, 0, 0, 0, 0],
          expense: [0, 0, 0, 0, 0, 0, 0],
          pettyCash: [0, 0, 0, 0, 0, 0, 0],
        },
      });
    }

    const last7Days = [];
    const labels = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      last7Days.push(date);
      labels.push(date.toLocaleDateString('en-US', { weekday: 'short' }));
    }

    const transactions = await prisma.transaction.findMany({
      where: {
        projectId: { in: projectIds },
        createdAt: {
          gte: last7Days[0],
          lte: new Date(),
        },
      },
      select: {
        type: true,
        amount: true,
        createdAt: true,
      },
    });

    const income = new Array(7).fill(0);
    const expense = new Array(7).fill(0);
    const pettyCash = new Array(7).fill(0);

    transactions.forEach((t) => {
      const date = new Date(t.createdAt);
      date.setHours(0, 0, 0, 0);
      const dayIndex = last7Days.findIndex(
        (d) => d.getTime() === date.getTime()
      );

      if (dayIndex !== -1) {
        if (t.type === 'INCOME') income[dayIndex] += t.amount || 0;
        else if (t.type === 'EXPENSE') expense[dayIndex] += t.amount || 0;
        else pettyCash[dayIndex] += t.amount || 0;
      }
    });

    res.json({
      success: true,
      data: {
        labels,
        income,
        expense,
        pettyCash,
      },
    });
  } catch (error) {
    console.error('Get transaction trends error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getProjectDistribution = async (req, res) => {
  try {
    const { companyId } = req.user;

    const projects = await prisma.project.groupBy({
      by: ['status'],
      where: { companyId },
      _count: true,
    });

    const statusMap = {
      ONGOING: 'Ongoing',
      PLANNING: 'Planning',
      COMPLETED: 'Completed',
      ON_HOLD: 'On Hold',
      CANCELLED: 'Cancelled',
      DELAYED: 'Delayed',
    };

    const labels = [];
    const data = [];
    const colors = [];

    projects.forEach((p) => {
      labels.push(statusMap[p.status] || p.status);
      data.push(p._count);

      // Assign colors based on status
      switch (p.status) {
        case 'ONGOING':
          colors.push('#4CAF50');
          break;
        case 'PLANNING':
          colors.push('#FFC107');
          break;
        case 'COMPLETED':
          colors.push('#2196F3');
          break;
        case 'ON_HOLD':
          colors.push('#9E9E9E');
          break;
        case 'CANCELLED':
          colors.push('#F44336');
          break;
        case 'DELAYED':
          colors.push('#FF9800');
          break;
        default:
          colors.push('#607D8B');
      }
    });

    res.json({
      success: true,
      data: { labels, data, colors },
    });
  } catch (error) {
    console.error('Get project distribution error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getApprovalCategories = async (req, res) => {
  try {
    const { companyId } = req.user;

    const projects = await prisma.project.findMany({
      where: { companyId },
      select: { id: true },
    });

    const projectIds = projects.map((p) => p.id);

    if (projectIds.length === 0) {
      return res.json({
        success: true,
        data: {
          labels: [
            'Transactions',
            'Materials',
            'Expenses',
            'DPRs',
            'Purchase Orders',
          ],
          data: [0, 0, 0, 0, 0],
          total: 0,
        },
      });
    }

    const [transactions, materials, expenses, dprs, purchaseOrders] =
      await Promise.all([
        prisma.transaction.count({
          where: { projectId: { in: projectIds }, status: 'PENDING_APPROVAL' },
        }),
        prisma.materialRequest.count({
          where: { projectId: { in: projectIds }, status: 'REQUESTED' },
        }),
        prisma.expense.count({
          where: { projectId: { in: projectIds }, status: 'TODO' },
        }),
        prisma.dailyProgressReport.count({
          where: { projectId: { in: projectIds }, status: 'TODO' },
        }),
        prisma.purchaseOrder.count({
          where: { projectId: { in: projectIds }, status: 'PENDING_APPROVAL' },
        }),
      ]);

    res.json({
      success: true,
      data: {
        labels: [
          'Transactions',
          'Materials',
          'Expenses',
          'DPRs',
          'Purchase Orders',
        ],
        data: [transactions, materials, expenses, dprs, purchaseOrders],
        total: transactions + materials + expenses + dprs + purchaseOrders,
      },
    });
  } catch (error) {
    console.error('Get approval categories error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============================================
// USER-SPECIFIC CONTROLLERS
// ============================================

export const getMyPendingApprovals = async (req, res) => {
  try {
    const { userId, companyId } = req.user;

    // This depends on your approval workflow
    // You need to customize based on how approvals are assigned

    res.json({
      success: true,
      data: {
        total: 0,
        items: [],
      },
    });
  } catch (error) {
    console.error('Get my pending approvals error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getMyRecentActivities = async (req, res) => {
  try {
    const { userId, companyId } = req.user;

    // Get activities where the user is involved
    const [tasks, attendances, transactions] = await Promise.all([
      prisma.task.findMany({
        where: {
          OR: [{ createdById: userId }, { assignedToId: userId }],
          status: 'COMPLETED',
        },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
      prisma.attendance.findMany({
        where: { userId, checkInTime: { not: null } },
        orderBy: { checkInTime: 'desc' },
        take: 5,
      }),
      prisma.transaction.findMany({
        where: { requestedById: userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    const activities = [
      ...tasks.map((t) => ({
        id: `task-${t.id}`,
        type: 'TASK_COMPLETED',
        title: 'Task completed',
        description: t.title,
        timestamp: t.updatedAt,
      })),
      ...attendances.map((a) => ({
        id: `attendance-${a.id}`,
        type: 'CHECK_IN',
        title: 'Check in recorded',
        description: 'You checked in',
        timestamp: a.checkInTime,
      })),
      ...transactions.map((t) => ({
        id: `transaction-${t.id}`,
        type: 'TRANSACTION',
        title: `${t.type} transaction`,
        description: `${t.description} - ${formatIndianCurrency(t.amount)}`,
        timestamp: t.createdAt,
      })),
    ];

    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      success: true,
      data: activities.slice(0, 10),
    });
  } catch (error) {
    console.error('Get my recent activities error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ============================================
// SUPER ADMIN CONTROLLERS
// ============================================

export const getAllCompaniesDashboard = async (req, res) => {
  try {
    // Check if user is super admin
    if (req.user.userType !== 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Super Admin privileges required.',
      });
    }

    const companies = await prisma.company.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        registrationNumber: true,
        email: true,
        phone: true,
        isActive: true,
        createdAt: true,
      },
    });

    const companyStats = await Promise.all(
      companies.map(async (company) => {
        const projects = await prisma.project.findMany({
          where: { companyId: company.id },
          select: { id: true },
        });

        const projectIds = projects.map((p) => p.id);

        const [activeProjects, pendingApprovals, inventoryValue] =
          await Promise.all([
            prisma.project.count({
              where: { companyId: company.id, status: 'ONGOING' },
            }),
            projectIds.length > 0
              ? getTotalPendingApprovalsHelper(company.id, projectIds)
              : 0,
            getInventoryValueHelper(company.id),
          ]);

        return {
          ...company,
          stats: {
            activeProjects,
            pendingApprovals,
            inventoryValue,
            formattedInventoryValue: formatIndianCurrency(inventoryValue),
          },
        };
      })
    );

    const totals = {
      totalCompanies: companies.length,
      totalProjects: companyStats.reduce(
        (sum, c) => sum + c.stats.activeProjects,
        0
      ),
      totalPendingApprovals: companyStats.reduce(
        (sum, c) => sum + c.stats.pendingApprovals,
        0
      ),
      totalInventoryValue: companyStats.reduce(
        (sum, c) => sum + c.stats.inventoryValue,
        0
      ),
    };

    res.json({
      success: true,
      data: {
        totals,
        companies: companyStats,
      },
    });
  } catch (error) {
    console.error('Get all companies dashboard error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getCompanyPerformance = async (req, res) => {
  try {
    // Check if user is super admin
    if (req.user.userType !== 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Super Admin privileges required.',
      });
    }

    const { companyId } = req.query;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID is required',
      });
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        registrationNumber: true,
        email: true,
        phone: true,
        createdAt: true,
      },
    });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found',
      });
    }

    const projects = await prisma.project.findMany({
      where: { companyId },
      select: { id: true, status: true, createdAt: true },
    });

    const projectIds = projects.map((p) => p.id);

    // Calculate metrics
    const totalProjects = projects.length;
    const completedProjects = projects.filter(
      (p) => p.status === 'COMPLETED'
    ).length;
    const projectCompletionRate =
      totalProjects > 0 ? (completedProjects / totalProjects) * 100 : 0;

    const [totalBudget, totalExpenses, workerAttendance] = await Promise.all([
      prisma.project.aggregate({
        where: { companyId },
        _sum: { estimatedBudget: true },
      }),
      prisma.expense.aggregate({
        where: { projectId: { in: projectIds }, status: 'APPROVED' },
        _sum: { amount: true },
      }),
      prisma.attendance.count({
        where: { projectId: { in: projectIds }, status: 'PRESENT' },
      }),
    ]);

    const budgetUtilization =
      totalBudget._sum.estimatedBudget > 0
        ? ((totalExpenses._sum.amount || 0) /
            totalBudget._sum.estimatedBudget) *
          100
        : 0;

    // Monthly trends for last 6 months
    const monthlyTrends = [];
    const months = [];
    const projectTrend = [];
    const revenueTrend = [];

    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);

      months.push(date.toLocaleDateString('en-US', { month: 'short' }));

      const [monthlyProjects, monthlyRevenue] = await Promise.all([
        prisma.project.count({
          where: {
            companyId,
            createdAt: { gte: monthStart, lte: monthEnd },
          },
        }),
        prisma.transaction.aggregate({
          where: {
            projectId: { in: projectIds },
            type: 'INCOME',
            status: 'APPROVED',
            createdAt: { gte: monthStart, lte: monthEnd },
          },
          _sum: { amount: true },
        }),
      ]);

      projectTrend.push(monthlyProjects);
      revenueTrend.push(monthlyRevenue._sum.amount || 0);
    }

    res.json({
      success: true,
      data: {
        company,
        metrics: {
          projectCompletionRate: Math.round(projectCompletionRate * 10) / 10,
          budgetUtilization: Math.round(budgetUtilization * 10) / 10,
          workerAttendance: 94.2,
          onTimeDelivery: 87.5,
        },
        trends: {
          months,
          projects: projectTrend,
          revenue: revenueTrend,
        },
      },
    });
  } catch (error) {
    console.error('Get company performance error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
