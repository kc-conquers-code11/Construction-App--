import prisma from '../config/database.js';

// Helper function to check material permissions
const checkMaterialPermission = async (userId, companyId, permissionCode) => {
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

  // Super Admin has all permissions
  if (user.userType === 'SUPER_ADMIN') return true;

  // Check if user belongs to the company
  if (user.companyId !== companyId) return false;

  // Check for specific permission or special access permissions
  const hasPermission = user.role?.rolePermissions.some(
    (rp) =>
      rp.permission.code === permissionCode ||
      rp.permission.code === 'ALL_ACCESS' ||
      rp.permission.code === 'FULL_COMPANY_ACCESS'
  );

  return hasPermission;
};

// Check material stock before requesting
export const checkMaterialStock = async (req, res) => {
  try {
    const { materialId, quantity } = req.body;

    // Check MATERIAL_STOCK_VIEW permission
    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'MATERIAL_STOCK_VIEW'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view material stock',
      });
    }

    // Get material
    const material = await prisma.material.findFirst({
      where: {
        id: materialId,
        companyId: req.user.companyId,
      },
    });

    if (!material) {
      return res.status(404).json({
        success: false,
        message: 'Material not found',
      });
    }

    const availableStock = material.stockQuantity || 0;
    const requestedQuantity = parseFloat(quantity) || 0;
    const minimumStock = material.minimumStock || 0;

    const stockCheck = {
      materialId: material.id,
      materialName: material.name,
      availableStock,
      requestedQuantity,
      minimumStock,
      isAvailable: availableStock >= requestedQuantity,
      shortage: Math.max(0, requestedQuantity - availableStock),
      isBelowMinimum: availableStock < minimumStock,
      canFulfillRequest: availableStock >= requestedQuantity,
      stockAfterRequest: availableStock - requestedQuantity,
      willBeBelowMinimum: availableStock - requestedQuantity < minimumStock,
    };

    // Check if stock alert should be triggered
    if (stockCheck.willBeBelowMinimum) {
      stockCheck.alert = {
        type: 'LOW_STOCK_WARNING',
        message: `Request will bring stock below minimum level (${minimumStock} ${material.unit})`,
      };
    }

    if (stockCheck.isBelowMinimum) {
      stockCheck.alert = {
        type: 'LOW_STOCK',
        message: `Stock is already below minimum level (${minimumStock} ${material.unit})`,
      };
    }

    res.json({
      success: true,
      data: stockCheck,
    });
  } catch (error) {
    console.error('Check material stock error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update material stock (Purchase/Return/Adjustment)
export const updateMaterialStock = async (req, res) => {
  try {
    const {
      materialId,
      quantity,
      transactionType,
      referenceId,
      referenceType,
      notes,
    } = req.body;

    // Check MATERIAL_STOCK_MANAGE permission
    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'MATERIAL_STOCK_MANAGE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to manage material stock',
      });
    }

    // Validate transaction type
    const validTypes = ['PURCHASE', 'RETURN', 'ADJUSTMENT', 'CONSUMPTION'];
    if (!validTypes.includes(transactionType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid transaction type. Must be one of: ${validTypes.join(', ')}`,
      });
    }

    // Get material
    const material = await prisma.material.findFirst({
      where: {
        id: materialId,
        companyId: req.user.companyId,
      },
    });

    if (!material) {
      return res.status(404).json({
        success: false,
        message: 'Material not found',
      });
    }

    const previousStock = material.stockQuantity || 0;
    const quantityNum = parseFloat(quantity);

    if (isNaN(quantityNum) || quantityNum <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be a positive number',
      });
    }

    // Calculate new stock based on transaction type
    let newStock;
    switch (transactionType) {
      case 'PURCHASE':
      case 'RETURN':
        newStock = previousStock + quantityNum;
        break;
      case 'CONSUMPTION':
        newStock = previousStock - quantityNum;
        if (newStock < 0) {
          return res.status(400).json({
            success: false,
            message: 'Insufficient stock for consumption',
          });
        }
        break;
      case 'ADJUSTMENT':
        newStock = quantityNum; // Direct set for adjustment
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid transaction type',
        });
    }

    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update material stock
      const updatedMaterial = await tx.material.update({
        where: { id: materialId },
        data: {
          stockQuantity: newStock,
        },
      });

      // Create stock transaction record
      const stockTransaction = await tx.stockTransaction.create({
        data: {
          materialId,
          transactionType,
          quantity: quantityNum,
          previousStock,
          newStock,
          referenceId,
          referenceType,
          notes,
          createdById: req.user.userId,
        },
      });

      // Check for stock alerts
      const minimumStock = material.minimumStock || 10;
      const shouldCreateAlert = newStock <= minimumStock;

      let stockAlert = null;
      if (shouldCreateAlert) {
        const alertType = newStock <= 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK';
        const message =
          newStock <= 0
            ? `${material.name} is out of stock`
            : `${material.name} stock is low (${newStock} ${material.unit})`;

        stockAlert = await tx.stockAlert.create({
          data: {
            materialId,
            alertType,
            currentStock: newStock,
            threshold: minimumStock,
            message,
            isResolved: false,
            isNotified: false,
          },
        });

        // Send notifications for critical stock levels
        await sendStockAlertNotifications(
          tx,
          material,
          stockAlert,
          req.user.companyId
        );
      }

      return { updatedMaterial, stockTransaction, stockAlert };
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'MATERIAL_STOCK_UPDATED',
        entityType: 'MATERIAL',
        entityId: materialId,
        oldData: { stockQuantity: previousStock },
        newData: { stockQuantity: newStock },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Material stock updated successfully',
      data: {
        material: result.updatedMaterial,
        transaction: result.stockTransaction,
        alert: result.stockAlert,
      },
    });
  } catch (error) {
    console.error('Update material stock error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Helper function to send stock alert notifications
const sendStockAlertNotifications = async (
  tx,
  material,
  stockAlert,
  companyId
) => {
  try {
    // Get users with material management permissions
    const usersWithPermissions = await tx.user.findMany({
      where: {
        companyId,
        isActive: true,
        role: {
          rolePermissions: {
            some: {
              permission: {
                code: {
                  in: [
                    'MATERIAL_REQUEST',
                    'MATERIAL_APPROVE',
                    'MATERIAL_STOCK_VIEW',
                  ],
                },
              },
            },
          },
        },
      },
      select: { id: true },
    });

    const notifications = usersWithPermissions.map((user) => ({
      userId: user.id,
      title: `Stock Alert: ${material.name}`,
      message: stockAlert.message,
      type: 'STOCK_ALERT',
      relatedId: stockAlert.id,
    }));

    if (notifications.length > 0) {
      await tx.notification.createMany({
        data: notifications,
      });
    }

    // Update alert as notified
    await tx.stockAlert.update({
      where: { id: stockAlert.id },
      data: { isNotified: true },
    });
  } catch (error) {
    console.error('Stock alert notification error:', error);
  }
};

// Get material stock history
export const getMaterialStockHistory = async (req, res) => {
  try {
    const { materialId } = req.params;
    const { page = 1, limit = 20, startDate, endDate } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check MATERIAL_STOCK_VIEW permission
    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'MATERIAL_STOCK_VIEW'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view material stock history',
      });
    }

    // Get material
    const material = await prisma.material.findFirst({
      where: {
        id: materialId,
        companyId: req.user.companyId,
      },
    });

    if (!material) {
      return res.status(404).json({
        success: false,
        message: 'Material not found',
      });
    }

    const where = {
      materialId,
    };

    // Add date range filter
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [transactions, total] = await Promise.all([
      prisma.stockTransaction.findMany({
        where,
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          project: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.stockTransaction.count({ where }),
    ]);

    // Calculate summary statistics
    const summary = transactions.reduce(
      (acc, transaction) => {
        if (
          transaction.transactionType === 'PURCHASE' ||
          transaction.transactionType === 'RETURN'
        ) {
          acc.totalPurchased += transaction.quantity;
        } else if (transaction.transactionType === 'CONSUMPTION') {
          acc.totalConsumed += transaction.quantity;
        }
        return acc;
      },
      { totalPurchased: 0, totalConsumed: 0 }
    );

    res.json({
      success: true,
      data: {
        material: {
          id: material.id,
          name: material.name,
          currentStock: material.stockQuantity,
          minimumStock: material.minimumStock,
          unit: material.unit,
        },
        transactions,
        summary,
        currentStock: material.stockQuantity,
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get material stock history error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get active stock alerts
export const getStockAlerts = async (req, res) => {
  try {
    const { page = 1, limit = 20, alertType, isResolved } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check MATERIAL_STOCK_VIEW permission
    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'MATERIAL_STOCK_VIEW'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view stock alerts',
      });
    }

    const where = {
      material: {
        companyId: req.user.companyId,
      },
    };

    // Add alert type filter
    if (alertType) {
      where.alertType = alertType;
    }

    // Add resolved filter
    if (isResolved === 'true' || isResolved === 'false') {
      where.isResolved = isResolved === 'true';
    }

    const [alerts, total] = await Promise.all([
      prisma.stockAlert.findMany({
        where,
        include: {
          material: {
            select: {
              id: true,
              name: true,
              unit: true,
              minimumStock: true,
            },
          },
          resolvedBy: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.stockAlert.count({ where }),
    ]);

    // Categorize alerts
    const categorizedAlerts = {
      critical: alerts.filter((alert) => alert.alertType === 'OUT_OF_STOCK'),
      warning: alerts.filter((alert) => alert.alertType === 'LOW_STOCK'),
      resolved: alerts.filter((alert) => alert.isResolved),
      active: alerts.filter((alert) => !alert.isResolved),
    };

    res.json({
      success: true,
      data: {
        alerts,
        categorized: categorizedAlerts,
        counts: {
          total,
          critical: categorizedAlerts.critical.length,
          warning: categorizedAlerts.warning.length,
          resolved: categorizedAlerts.resolved.length,
          active: categorizedAlerts.active.length,
        },
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get stock alerts error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Resolve stock alert
export const resolveStockAlert = async (req, res) => {
  try {
    const { id } = req.params;
    const { resolutionNotes } = req.body;

    // Check MATERIAL_STOCK_MANAGE permission
    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'MATERIAL_STOCK_MANAGE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to resolve stock alerts',
      });
    }

    const alert = await prisma.stockAlert.findFirst({
      where: {
        id,
        material: {
          companyId: req.user.companyId,
        },
      },
      include: {
        material: true,
      },
    });

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Stock alert not found',
      });
    }

    if (alert.isResolved) {
      return res.status(400).json({
        success: false,
        message: 'Stock alert is already resolved',
      });
    }

    const updatedAlert = await prisma.stockAlert.update({
      where: { id },
      data: {
        isResolved: true,
        resolvedAt: new Date(),
        resolvedById: req.user.userId,
        resolutionNotes,
      },
    });

    res.json({
      success: true,
      message: 'Stock alert resolved successfully',
      data: updatedAlert,
    });
  } catch (error) {
    console.error('Resolve stock alert error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get material consumption report
export const getMaterialConsumptionReport = async (req, res) => {
  try {
    const { materialId, projectId, startDate, endDate } = req.query;

    // Check MATERIAL_REPORT permission
    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'MATERIAL_REPORT'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view material reports',
      });
    }

    const where = {
      material: {
        companyId: req.user.companyId,
      },
    };

    // Add material filter
    if (materialId) {
      where.materialId = materialId;
    }

    // Add project filter
    if (projectId) {
      where.dpr = {
        projectId,
      };
    }

    // Add date range filter
    if (startDate || endDate) {
      where.consumedAt = {};
      if (startDate) where.consumedAt.gte = new Date(startDate);
      if (endDate) where.consumedAt.lte = new Date(endDate);
    }

    const consumptions = await prisma.materialConsumption.findMany({
      where,
      include: {
        material: {
          select: {
            id: true,
            name: true,
            unit: true,
          },
        },
        dpr: {
          include: {
            project: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        consumedBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { consumedAt: 'desc' },
    });

    // Calculate summary by material
    const summaryByMaterial = consumptions.reduce((acc, consumption) => {
      const materialId = consumption.materialId;
      if (!acc[materialId]) {
        acc[materialId] = {
          material: consumption.material,
          totalQuantity: 0,
          consumptions: [],
        };
      }
      acc[materialId].totalQuantity += consumption.quantity;
      acc[materialId].consumptions.push(consumption);
      return acc;
    }, {});

    // Calculate summary by project
    const summaryByProject = consumptions.reduce((acc, consumption) => {
      const projectId = consumption.dpr.projectId;
      const projectName = consumption.dpr.project.name;

      if (!acc[projectId]) {
        acc[projectId] = {
          project: {
            id: projectId,
            name: projectName,
          },
          totalQuantity: 0,
          materials: {},
        };
      }

      acc[projectId].totalQuantity += consumption.quantity;

      // Track material-wise consumption in project
      const materialId = consumption.materialId;
      if (!acc[projectId].materials[materialId]) {
        acc[projectId].materials[materialId] = {
          material: consumption.material,
          quantity: 0,
        };
      }
      acc[projectId].materials[materialId].quantity += consumption.quantity;

      return acc;
    }, {});

    // Convert materials object to array
    Object.keys(summaryByProject).forEach((projectId) => {
      summaryByProject[projectId].materials = Object.values(
        summaryByProject[projectId].materials
      );
    });

    res.json({
      success: true,
      data: {
        consumptions,
        summaryByMaterial: Object.values(summaryByMaterial),
        summaryByProject: Object.values(summaryByProject),
        totalConsumptions: consumptions.length,
        totalQuantity: consumptions.reduce((sum, c) => sum + c.quantity, 0),
      },
    });
  } catch (error) {
    console.error('Get material consumption report error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
