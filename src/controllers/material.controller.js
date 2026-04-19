// src/controllers/material.controller.js
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

// Create Material
export const createMaterial = async (req, res) => {
  try {
    const {
      materialCode,
      name,
      unit,
      stockQuantity,
      minimumStock,
      unitPrice,
      supplier,
      supplierContact,
      projectId,
    } = req.body;
    console.log('Create Material Request Body:', req.body);

    // Check MATERIAL_CREATE permission
    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'MATERIAL_CREATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create materials',
      });
    }

    // Check if material code already exists in company
    if (materialCode) {
      const existingMaterial = await prisma.material.findFirst({
        where: {
          materialCode,
          companyId: req.user.companyId,
        },
      });

      if (existingMaterial) {
        return res.status(400).json({
          success: false,
          message: 'Material code already exists in your company',
        });
      }
    }

    const material = await prisma.material.create({
      data: {
        materialCode,
        name,
        unit,
        stockQuantity: parseFloat(stockQuantity) || 0,
        minimumStock: parseFloat(minimumStock) || 10,
        unitPrice: unitPrice ? parseFloat(unitPrice) : null,
        supplier,
        supplierContact,
        companyId: req.user.companyId,
        createdById: req.user.userId,
        projects: {
          connect: projectId ? { id: projectId } : undefined,
        },
      },
      include: {
        projects: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'MATERIAL_CREATED',
        entityType: 'MATERIAL',
        entityId: material.id,
        newData: { name, materialCode, stockQuantity },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message: 'Material created successfully',
      data: material,
    });
  } catch (error) {
    console.error('Create material error:', error);

    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'Material with similar details already exists',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get All Materials
export const getAllMaterials = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      lowStock = 'false',
      outOfStock = 'false',
      projectId,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check MATERIAL_READ permission
    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'MATERIAL_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view materials',
      });
    }

    const where = {
      companyId: req.user.companyId,
    };

    // Add search filter
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { materialCode: { contains: search, mode: 'insensitive' } },
        { supplier: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Add low stock filter
    if (lowStock === 'true') {
      where.stockQuantity = {
        lte: prisma.material.fields.minimumStock,
        gt: 0,
      };
    }

    // Add out of stock filter
    if (outOfStock === 'true') {
      where.stockQuantity = {
        equals: 0,
      };
    }

    // Add project filter
    if (projectId) {
      where.projects = {
        some: {
          id: projectId,
        },
      };
    }

    const [materials, total] = await Promise.all([
      prisma.material.findMany({
        where,
        include: {
          projects: {
            select: {
              id: true,
              name: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              materialRequests: true,
              stockTransactions: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { name: 'asc' },
      }),
      prisma.material.count({ where }),
    ]);

    // Add stock status
    const materialsWithStatus = materials.map((material) => {
      let stockStatus = 'NORMAL';
      if (material.stockQuantity === 0) {
        stockStatus = 'OUT_OF_STOCK';
      } else if (material.stockQuantity <= material.minimumStock) {
        stockStatus = 'LOW_STOCK';
      }

      return {
        ...material,
        stockStatus,
        isBelowMinimum: material.stockQuantity <= material.minimumStock,
      };
    });

    res.json({
      success: true,
      data: materialsWithStatus,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get materials error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Material by ID
export const getMaterialById = async (req, res) => {
  try {
    const { id } = req.params;

    // Check MATERIAL_READ permission
    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'MATERIAL_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view material details',
      });
    }

    const material = await prisma.material.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
      include: {
        projects: {
          select: {
            id: true,
            name: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
          },
        },
        materialRequests: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            requestNo: true,
            quantity: true,
            status: true,
            createdAt: true,
            project: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        stockTransactions: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            createdBy: {
              select: {
                id: true,
                name: true,
              },
            },
            project: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        stockAlerts: {
          where: {
            isResolved: false,
          },
          take: 5,
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: {
            materialRequests: true,
            stockTransactions: true,
            materialConsumptions: true,
          },
        },
      },
    });

    if (!material) {
      return res.status(404).json({
        success: false,
        message: 'Material not found',
      });
    }

    // Calculate stock status
    let stockStatus = 'NORMAL';
    if (material.stockQuantity === 0) {
      stockStatus = 'OUT_OF_STOCK';
    } else if (material.stockQuantity <= material.minimumStock) {
      stockStatus = 'LOW_STOCK';
    }

    const materialWithStatus = {
      ...material,
      stockStatus,
      isBelowMinimum: material.stockQuantity <= material.minimumStock,
      totalConsumed: material._count.materialConsumptions,
    };

    res.json({
      success: true,
      data: materialWithStatus,
    });
  } catch (error) {
    console.error('Get material error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update Material
export const updateMaterial = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Check MATERIAL_UPDATE permission
    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'MATERIAL_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update materials',
      });
    }

    // Check if material exists and belongs to company
    const material = await prisma.material.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!material) {
      return res.status(404).json({
        success: false,
        message: 'Material not found',
      });
    }

    // Convert numeric fields
    if (updates.stockQuantity !== undefined) {
      updates.stockQuantity = parseFloat(updates.stockQuantity);
    }
    if (updates.minimumStock !== undefined) {
      updates.minimumStock = parseFloat(updates.minimumStock);
    }
    if (updates.unitPrice !== undefined) {
      updates.unitPrice = updates.unitPrice
        ? parseFloat(updates.unitPrice)
        : null;
    }

    // Handle project connections if provided
    let updateData = { ...updates };
    if (updates.projectIds) {
      updateData = {
        ...updates,
        projects: {
          set: updates.projectIds.map((projectId) => ({ id: projectId })),
        },
      };
      delete updateData.projectIds;
    }

    const updatedMaterial = await prisma.material.update({
      where: { id },
      data: updateData,
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'MATERIAL_UPDATED',
        entityType: 'MATERIAL',
        entityId: id,
        oldData: material,
        newData: updatedMaterial,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Material updated successfully',
      data: updatedMaterial,
    });
  } catch (error) {
    console.error('Update material error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Delete Material
export const deleteMaterial = async (req, res) => {
  try {
    const { id } = req.params;

    // Check MATERIAL_DELETE permission
    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'MATERIAL_DELETE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete materials',
      });
    }

    // Check if material exists and belongs to company
    const material = await prisma.material.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
      include: {
        _count: {
          select: {
            materialRequests: true,
            stockTransactions: true,
            materialConsumptions: true,
          },
        },
      },
    });

    if (!material) {
      return res.status(404).json({
        success: false,
        message: 'Material not found',
      });
    }

    // Check if material has related data
    const hasRelatedData =
      material._count.materialRequests > 0 ||
      material._count.stockTransactions > 0 ||
      material._count.materialConsumptions > 0;

    if (hasRelatedData) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete material with related data.',
      });
    }

    await prisma.material.delete({
      where: { id },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'MATERIAL_DELETED',
        entityType: 'MATERIAL',
        entityId: id,
        oldData: material,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Material deleted successfully',
    });
  } catch (error) {
    console.error('Delete material error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Adjust Material Stock
export const adjustMaterialStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { adjustmentType, quantity, reason, projectId } = req.body;

    // Check MATERIAL_STOCK_ADJUST permission
    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'MATERIAL_STOCK_ADJUST'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to adjust material stock',
      });
    }

    // Check if material exists and belongs to company
    const material = await prisma.material.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!material) {
      return res.status(404).json({
        success: false,
        message: 'Material not found',
      });
    }

    const adjustmentQuantity = parseFloat(quantity);
    if (isNaN(adjustmentQuantity) || adjustmentQuantity <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be a positive number',
      });
    }

    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      const previousStock = material.stockQuantity || 0;
      let newStock;

      if (adjustmentType === 'ADD') {
        newStock = previousStock + adjustmentQuantity;
      } else if (adjustmentType === 'REMOVE') {
        if (adjustmentQuantity > previousStock) {
          throw new Error('Cannot remove more than available stock');
        }
        newStock = previousStock - adjustmentQuantity;
      } else {
        throw new Error('Invalid adjustment type');
      }

      // Update material stock
      await tx.material.update({
        where: { id },
        data: {
          stockQuantity: newStock,
        },
      });

      // Create stock transaction
      const transaction = await tx.stockTransaction.create({
        data: {
          materialId: id,
          transactionType:
            adjustmentType === 'ADD' ? 'ADJUSTMENT_ADD' : 'ADJUSTMENT_REMOVE',
          quantity: adjustmentQuantity,
          previousStock,
          newStock,
          projectId: projectId || null,
          referenceType: 'MANUAL_ADJUSTMENT',
          notes: reason || 'Manual stock adjustment',
          createdById: req.user.userId,
        },
      });

      // Check for stock alerts
      const minimumStock = material.minimumStock || 10;
      if (newStock <= minimumStock) {
        const alertType = newStock <= 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK';
        const message =
          newStock <= 0
            ? `${material.name} is out of stock after manual adjustment`
            : `${material.name} stock is low (${newStock} ${material.unit}) after manual adjustment`;

        await tx.stockAlert.create({
          data: {
            materialId: id,
            alertType,
            currentStock: newStock,
            threshold: minimumStock,
            message,
            isResolved: false,
            isNotified: false,
          },
        });
      }

      return {
        transaction,
        previousStock,
        newStock,
        adjustment: adjustmentQuantity,
      };
    });

    res.json({
      success: true,
      message: 'Stock adjusted successfully',
      data: result,
    });
  } catch (error) {
    console.error('Adjust material stock error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
};

// Check Material Stock Before Request
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
    const minimumStock = material.minimumStock || 10;

    const stockCheck = {
      materialId: material.id,
      materialName: material.name,
      availableStock,
      requestedQuantity,
      minimumStock,
      unit: material.unit,
      isAvailable: availableStock >= requestedQuantity,
      shortage: Math.max(0, requestedQuantity - availableStock),
      isBelowMinimum: availableStock < minimumStock,
      canFulfillRequest: availableStock >= requestedQuantity,
      stockAfterRequest: availableStock - requestedQuantity,
      willBeBelowMinimum: availableStock - requestedQuantity < minimumStock,
      status:
        availableStock >= requestedQuantity ? 'AVAILABLE' : 'INSUFFICIENT',
    };

    // Check if stock alert should be triggered
    if (stockCheck.willBeBelowMinimum) {
      stockCheck.alert = {
        type: 'LOW_STOCK_WARNING',
        message: `Request will bring stock below minimum level (${minimumStock} ${material.unit})`,
        severity: 'WARNING',
      };
    }

    if (stockCheck.isBelowMinimum) {
      stockCheck.alert = {
        type: 'LOW_STOCK',
        message: `Stock is already below minimum level (${minimumStock} ${material.unit})`,
        severity: 'HIGH',
      };
    }

    // Check if stock is critical (less than 20% of minimum)
    if (availableStock < minimumStock * 0.2) {
      stockCheck.alert = {
        type: 'CRITICAL_STOCK',
        message: `Stock is critically low (${availableStock} ${material.unit})`,
        severity: 'CRITICAL',
      };
    }

    res.json({
      success: true,
      data: stockCheck,
      recommendation: stockCheck.canFulfillRequest
        ? 'Material available in stock. You can consume directly.'
        : 'Material stock insufficient. You need to create a material request.',
    });
  } catch (error) {
    console.error('Check material stock error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Material Statistics
export const getMaterialStatistics = async (req, res) => {
  try {
    const { projectId } = req.query;

    // Check MATERIAL_READ permission
    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'MATERIAL_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view material statistics',
      });
    }

    const where = {
      companyId: req.user.companyId,
    };

    // Add project filter
    if (projectId) {
      where.projects = {
        some: {
          id: projectId,
        },
      };
    }

    const [
      totalMaterials,
      lowStockMaterials,
      outOfStockMaterials,
      totalStockValue,
      recentTransactions,
      stockAlerts,
    ] = await Promise.all([
      // Total materials
      prisma.material.count({ where }),

      // Low stock materials
      prisma.material.count({
        where: {
          ...where,
          stockQuantity: {
            lte: prisma.material.fields.minimumStock,
            gt: 0,
          },
        },
      }),

      // Out of stock materials
      prisma.material.count({
        where: {
          ...where,
          stockQuantity: {
            equals: 0,
          },
        },
      }),

      // Total stock value
      prisma.material.aggregate({
        where,
        _sum: {
          stockQuantity: true,
        },
      }),

      // Recent stock transactions (last 10)
      prisma.stockTransaction.findMany({
        where: {
          material: {
            companyId: req.user.companyId,
          },
        },
        include: {
          material: {
            select: {
              id: true,
              name: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
          project: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      }),

      // Active stock alerts
      prisma.stockAlert.findMany({
        where: {
          material: {
            companyId: req.user.companyId,
          },
          isResolved: false,
        },
        include: {
          material: {
            select: {
              id: true,
              name: true,
              unit: true,
            },
          },
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const statistics = {
      totals: {
        materials: totalMaterials,
        lowStock: lowStockMaterials,
        outOfStock: outOfStockMaterials,
        totalStockQuantity: totalStockValue._sum.stockQuantity || 0,
      },
      percentages: {
        lowStock:
          totalMaterials > 0 ? (lowStockMaterials / totalMaterials) * 100 : 0,
        outOfStock:
          totalMaterials > 0 ? (outOfStockMaterials / totalMaterials) * 100 : 0,
      },
      recentTransactions,
      activeAlerts: stockAlerts,
    };

    res.json({
      success: true,
      data: statistics,
    });
  } catch (error) {
    console.error('Get material statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Material Consumption Report
export const getMaterialConsumptionReport = async (req, res) => {
  try {
    const { materialId, startDate, endDate, projectId } = req.query;

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
          select: {
            id: true,
            reportNo: true,
            date: true,
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

    // Calculate summary
    const summary = {
      totalConsumptions: consumptions.length,
      totalQuantity: consumptions.reduce((sum, c) => sum + c.quantity, 0),
      uniqueMaterials: [...new Set(consumptions.map((c) => c.materialId))]
        .length,
      uniqueProjects: [...new Set(consumptions.map((c) => c.dpr.projectId))]
        .length,
    };

    // Group by material
    const byMaterial = consumptions.reduce((acc, consumption) => {
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

    // Group by project
    const byProject = consumptions.reduce((acc, consumption) => {
      const projectId = consumption.dpr.projectId;
      if (!acc[projectId]) {
        acc[projectId] = {
          project: consumption.dpr.project,
          totalQuantity: 0,
          consumptions: [],
        };
      }
      acc[projectId].totalQuantity += consumption.quantity;
      acc[projectId].consumptions.push(consumption);
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        consumptions,
        summary,
        byMaterial: Object.values(byMaterial),
        byProject: Object.values(byProject),
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
