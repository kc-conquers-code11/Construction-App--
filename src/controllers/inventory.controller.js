import prisma from '../config/database.js';

// ==============================================================================
// HELPER FUNCTIONS
// ==============================================================================

const checkInventoryPermission = async (userId, companyId, permissionCode) => {
  if (!userId) return false;

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

  const hasPermission = user.role?.rolePermissions.some(
    (rp) =>
      rp.permission.code === permissionCode ||
      rp.permission.code === 'ALL_ACCESS' ||
      rp.permission.code === 'FULL_COMPANY_ACCESS'
  );

  return hasPermission;
};

// ==============================================================================
// 1. GLOBAL / RETENTION INVENTORY CONTROLLERS
// ==============================================================================

export const getGlobalInventory = async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required' });
    const { companyId, userId } = req.user;

    const hasPermission = await checkInventoryPermission(
      userId,
      companyId,
      'INVENTORY_READ'
    );
    if (!hasPermission)
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });

    // Pagination & Search
    const { page = 1, limit = 20, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build Material Filter
    const materialWhere = {
      companyId,
      location: 'GLOBAL',
    };

    if (search) {
      materialWhere.material = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { materialCode: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    // Build Equipment Filter (Search applies here too)
    const equipmentWhere = {
      companyId,
      location: 'GLOBAL',
      status: 'AVAILABLE',
    };

    if (search) {
      equipmentWhere.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { type: { contains: search, mode: 'insensitive' } },
        { serialNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Fetch Data & Aggregates
    const [
      materials,
      totalMaterials,
      equipment,
      materialStats,
      equipmentStats,
    ] = await Promise.all([
      // 1. Paginated Materials
      prisma.inventory.findMany({
        where: materialWhere,
        include: {
          material: {
            select: {
              id: true,
              name: true,
              unit: true,
              materialCode: true,
              unitPrice: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { material: { name: 'asc' } },
      }),
      // 2. Total Count for Pagination
      prisma.inventory.count({ where: materialWhere }),
      // 3. Equipment List (Return all for Global view or manage separately)
      prisma.equipment.findMany({
        where: equipmentWhere,
        orderBy: { name: 'asc' },
      }),
      // 4. Aggregate Material Totals (Across ALL matching records)
      prisma.inventory.aggregate({
        where: materialWhere,
        _sum: { totalValue: true },
      }),
      // 5. Aggregate Equipment Totals (Across ALL matching records)
      prisma.equipment.aggregate({
        where: equipmentWhere,
        _sum: { purchaseCost: true },
        _count: true,
      }),
    ]);

    // Use the aggregate results, NOT the paginated array reduction
    const totalMaterialValue = materialStats._sum.totalValue || 0;
    const totalEquipmentValue = equipmentStats._sum.purchaseCost || 0;
    const totalEquipmentCount = equipmentStats._count;

    res.json({
      success: true,
      data: {
        materials,
        equipment, // Returning all matching equipment
        summary: {
          totalMaterialValue,
          totalEquipmentValue,
          totalValue: totalMaterialValue + totalEquipmentValue,
          materialCount: totalMaterials,
          equipmentCount: totalEquipmentCount,
        },
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalMaterials,
        totalPages: Math.ceil(totalMaterials / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get global inventory error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const addOpeningStockToRetention = async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required' });
    const { userId, companyId } = req.user;
    const {
      materialId,
      quantity,
      unitPrice,
      batchNumber,
      purchaseDate,
      expiryDate,
      notes,
    } = req.body;

    const hasPermission = await checkInventoryPermission(
      userId,
      companyId,
      'INVENTORY_WRITE'
    );
    if (!hasPermission)
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });

    const result = await prisma.$transaction(async (prisma) => {
      let inventory = await prisma.inventory.findFirst({
        where: { companyId, materialId, projectId: null, location: 'GLOBAL' },
      });

      if (!inventory) {
        inventory = await prisma.inventory.create({
          data: {
            companyId,
            materialId,
            location: 'GLOBAL',
            projectId: null,
            quantityTotal: 0,
            quantityAvailable: 0,
            averageRate: 0,
            totalValue: 0,
          },
        });
      }

      await prisma.materialBatch.create({
        data: {
          materialId,
          projectId: null,
          batchNumber,
          quantity,
          unitPrice,
          purchaseDate: purchaseDate ? new Date(purchaseDate) : new Date(),
          expiryDate: expiryDate ? new Date(expiryDate) : null,
        },
      });

      const newTotalValue = inventory.totalValue + quantity * unitPrice;
      const newTotalQuantity = inventory.quantityAvailable + quantity;
      const newAverageRate =
        newTotalQuantity > 0 ? newTotalValue / newTotalQuantity : 0;

      const updatedInventory = await prisma.inventory.update({
        where: { id: inventory.id },
        data: {
          quantityTotal: { increment: quantity },
          quantityAvailable: { increment: quantity },
          totalValue: newTotalValue,
          averageRate: newAverageRate,
        },
      });

      await prisma.stockTransaction.create({
        data: {
          materialId,
          transactionType: 'OPENING_STOCK',
          quantity: quantity,
          previousStock: inventory.quantityAvailable,
          newStock: updatedInventory.quantityAvailable,
          projectId: null,
          createdById: userId,
          notes: notes || `Opening stock added. Batch: ${batchNumber || 'N/A'}`,
        },
      });

      return updatedInventory;
    });

    res.status(201).json({
      success: true,
      message: 'Stock added successfully',
      data: result,
    });
  } catch (error) {
    console.error('Add opening stock error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

export const addBulkOpeningStockToRetention = async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required' });
    const { userId, companyId } = req.user;
    const { items } = req.body;

    const hasPermission = await checkInventoryPermission(
      userId,
      companyId,
      'INVENTORY_WRITE'
    );
    if (!hasPermission)
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });

    const results = await prisma.$transaction(async (prisma) => {
      const processedItems = [];
      for (const item of items) {
        const {
          materialId,
          quantity,
          unitPrice,
          batchNumber,
          notes,
          purchaseDate,
          expiryDate,
        } = item;
        let inventory = await prisma.inventory.findFirst({
          where: { companyId, materialId, projectId: null, location: 'GLOBAL' },
        });

        if (!inventory) {
          inventory = await prisma.inventory.create({
            data: {
              companyId,
              materialId,
              location: 'GLOBAL',
              projectId: null,
              quantityTotal: 0,
              quantityAvailable: 0,
              quantityUsed: 0,
              averageRate: 0,
              totalValue: 0,
            },
          });
        }

        const batch = await prisma.materialBatch.create({
          data: {
            materialId,
            projectId: null,
            batchNumber,
            quantity,
            unitPrice,
            purchaseDate: purchaseDate ? new Date(purchaseDate) : new Date(),
            expiryDate: expiryDate ? new Date(expiryDate) : null,
          },
        });

        const newTotalValue = inventory.totalValue + quantity * unitPrice;
        const newTotalQuantity = inventory.quantityAvailable + quantity;
        const newAverageRate =
          newTotalQuantity > 0 ? newTotalValue / newTotalQuantity : 0;

        await prisma.inventory.update({
          where: { id: inventory.id },
          data: {
            quantityTotal: { increment: quantity },
            quantityAvailable: { increment: quantity },
            totalValue: newTotalValue,
            averageRate: newAverageRate,
          },
        });

        const transaction = await prisma.stockTransaction.create({
          data: {
            materialId,
            transactionType: 'OPENING_STOCK',
            quantity,
            previousStock: inventory.quantityAvailable,
            newStock: inventory.quantityAvailable + quantity,
            projectId: null,
            createdById: userId,
            notes:
              notes ||
              `Bulk Opening stock added. Batch: ${batchNumber || 'N/A'}`,
          },
        });

        processedItems.push({
          materialId,
          batchId: batch.id,
          transactionId: transaction.id,
        });
      }
      return processedItems;
    });

    res.status(201).json({
      success: true,
      message: 'Bulk stock added successfully',
      data: results,
    });
  } catch (error) {
    console.error('Add bulk opening stock error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

// ==============================================================================
// 2. PROJECT INVENTORY CONTROLLERS
// ==============================================================================

export const getProjectInventory = async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required' });
    const { userId, companyId } = req.user;
    const { projectId } = req.params;

    const hasPermission = await checkInventoryPermission(
      userId,
      companyId,
      'INVENTORY_READ'
    );
    if (!hasPermission)
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });

    // Pagination & Search
    const { page = 1, limit = 20, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build Material Filter
    const materialWhere = {
      companyId,
      projectId,
      location: 'PROJECT',
    };

    if (search) {
      materialWhere.material = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { materialCode: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    // Build Equipment Filter
    const equipmentWhere = {
      companyId,
      currentProjectId: projectId,
      location: 'PROJECT',
    };

    if (search) {
      equipmentWhere.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { type: { contains: search, mode: 'insensitive' } },
        { serialNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Fetch Materials and Equipment for the Project in parallel
    const [
      inventory,
      totalMaterials,
      equipment,
      materialStats,
      equipmentStats,
    ] = await Promise.all([
      // 1. Paginated Materials
      prisma.inventory.findMany({
        where: materialWhere,
        include: {
          material: true,
        },
        skip,
        take: parseInt(limit),
        orderBy: { material: { name: 'asc' } },
      }),
      // 2. Total Count for Pagination
      prisma.inventory.count({ where: materialWhere }),
      // 3. Equipment List (Return all for project)
      prisma.equipment.findMany({
        where: equipmentWhere,
        orderBy: { name: 'asc' },
      }),
      // 4. Aggregate Material Totals (Across ALL matching records)
      prisma.inventory.aggregate({
        where: materialWhere,
        _sum: { totalValue: true },
      }),
      // 5. Aggregate Equipment Totals (Across ALL matching records)
      prisma.equipment.aggregate({
        where: equipmentWhere,
        _sum: { purchaseCost: true },
        _count: true,
      }),
    ]);

    const totalMaterialValue = materialStats._sum.totalValue || 0;
    const totalEquipmentValue = equipmentStats._sum.purchaseCost || 0;
    const totalEquipmentCount = equipmentStats._count;

    res.json({
      success: true,
      data: {
        materials: inventory,
        equipment: equipment,
        summary: {
          totalMaterialValue,
          totalEquipmentValue,
          totalValue: totalMaterialValue + totalEquipmentValue,
          materialCount: totalMaterials,
          equipmentCount: totalEquipmentCount,
        },
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalMaterials,
        totalPages: Math.ceil(totalMaterials / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get project inventory error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const addMaterialToProject = async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required' });
    const { companyId, userId } = req.user;
    const { projectId } = req.params;
    const {
      materialId,
      initialQuantity = 0,
      unitPrice,
      batchNumber,
      purchaseDate,
      expiryDate,
      notes,
    } = req.body;

    const existing = await prisma.inventory.findFirst({
      where: { companyId, materialId, projectId },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Material already initialized for this project',
      });
    }

    const result = await prisma.$transaction(async (prisma) => {
      const newInventory = await prisma.inventory.create({
        data: {
          companyId,
          materialId,
          projectId,
          location: 'PROJECT',
          quantityTotal: initialQuantity,
          quantityAvailable: initialQuantity,
          quantityUsed: 0,
          averageRate: initialQuantity > 0 ? unitPrice : 0,
          totalValue: initialQuantity > 0 ? initialQuantity * unitPrice : 0,
        },
      });

      if (initialQuantity > 0) {
        await prisma.materialBatch.create({
          data: {
            materialId,
            projectId,
            batchNumber,
            quantity: initialQuantity,
            unitPrice: unitPrice,
            purchaseDate: purchaseDate ? new Date(purchaseDate) : new Date(),
            expiryDate: expiryDate ? new Date(expiryDate) : null,
          },
        });

        await prisma.stockTransaction.create({
          data: {
            materialId,
            transactionType: 'PROJECT_INIT',
            quantity: initialQuantity,
            previousStock: 0,
            newStock: initialQuantity,
            projectId,
            createdById: userId,
            notes: notes || 'Project Material Initialization with Stock',
          },
        });
      }

      return newInventory;
    });

    res.status(201).json({
      success: true,
      message: 'Material added to project',
      data: result,
    });
  } catch (error) {
    console.error('Add material to project error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const addBulkMaterialsToProject = async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required' });
    const { companyId, userId } = req.user;
    const { projectId } = req.params;
    const { items } = req.body;

    const results = await prisma.$transaction(async (prisma) => {
      const processed = [];

      for (const item of items) {
        const {
          materialId,
          initialQuantity = 0,
          unitPrice,
          batchNumber,
          purchaseDate,
          expiryDate,
          notes,
        } = item;

        const existing = await prisma.inventory.findFirst({
          where: { companyId, materialId, projectId },
        });

        if (existing) {
          processed.push({
            materialId,
            status: 'SKIPPED',
            message: 'Already exists',
          });
          continue;
        }

        const newInventory = await prisma.inventory.create({
          data: {
            companyId,
            materialId,
            projectId,
            location: 'PROJECT',
            quantityTotal: initialQuantity,
            quantityAvailable: initialQuantity,
            quantityUsed: 0,
            averageRate: initialQuantity > 0 ? unitPrice : 0,
            totalValue: initialQuantity > 0 ? initialQuantity * unitPrice : 0,
          },
        });

        if (initialQuantity > 0) {
          await prisma.materialBatch.create({
            data: {
              materialId,
              projectId,
              batchNumber,
              quantity: initialQuantity,
              unitPrice: unitPrice,
              purchaseDate: purchaseDate ? new Date(purchaseDate) : new Date(),
              expiryDate: expiryDate ? new Date(expiryDate) : null,
            },
          });

          await prisma.stockTransaction.create({
            data: {
              materialId,
              transactionType: 'PROJECT_INIT',
              quantity: initialQuantity,
              previousStock: 0,
              newStock: initialQuantity,
              projectId,
              createdById: userId,
              notes: notes || 'Bulk Project Material Init',
            },
          });
        }

        processed.push({
          materialId,
          status: 'CREATED',
          inventoryId: newInventory.id,
        });
      }
      return processed;
    });

    res.status(201).json({
      success: true,
      message: 'Bulk operation completed',
      data: results,
    });
  } catch (error) {
    console.error('Bulk add material to project error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const updateProjectMaterial = async (req, res) => {
  res.json({ success: true, message: 'Material settings updated' });
};

export const removeMaterialFromProject = async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required' });
    const { companyId } = req.user;
    const { projectId, materialId } = req.params;

    const inventory = await prisma.inventory.findFirst({
      where: { companyId, projectId, materialId },
    });
    if (!inventory)
      return res
        .status(404)
        .json({ success: false, message: 'Inventory record not found' });

    if (inventory.quantityAvailable > 0 || inventory.quantityUsed > 0) {
      return res.status(400).json({
        success: false,
        message:
          'Cannot remove material with existing stock or transaction history',
      });
    }

    await prisma.inventory.delete({ where: { id: inventory.id } });
    res.json({ success: true, message: 'Material removed from project' });
  } catch (error) {
    console.error('Remove material error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getProjectMaterialBatches = async (req, res) => {
  try {
    const { projectId, materialId } = req.params;
    const batches = await prisma.materialBatch.findMany({
      where: { projectId, materialId, quantity: { gt: 0 } },
      orderBy: { purchaseDate: 'asc' },
    });
    res.json({ success: true, data: batches });
  } catch (error) {
    console.error('Get batches error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ==============================================================================
// 3. TRANSFER CONTROLLERS
// ==============================================================================

export const createInventoryTransfer = async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required' });
    const { userId, companyId } = req.user;
    const {
      fromLocation,
      toLocation,
      fromProjectId,
      toProjectId,
      items,
      description,
      transferDate,
    } = req.body;

    if (fromLocation === 'PROJECT' && !fromProjectId)
      return res.status(400).json({ message: 'From Project ID required' });
    if (toLocation === 'PROJECT' && !toProjectId)
      return res.status(400).json({ message: 'To Project ID required' });

    const result = await prisma.$transaction(async (prisma) => {
      // Create Transfer Record (Status: COMPLETED immediately)
      const transfer = await prisma.inventoryTransfer.create({
        data: {
          transferNo: `TRF-${Date.now()}`,
          companyId,
          fromLocation,
          fromProjectId: fromProjectId || null,
          toLocation,
          toProjectId: toProjectId || null,
          transferDate: transferDate ? new Date(transferDate) : new Date(),
          status: 'COMPLETED', // Immediate completion
          description,
          requestedById: userId,
          approvedById: userId, // Auto-approved
          approvedAt: new Date(),
          userId: userId,
        },
      });

      for (const item of items) {
        if (item.itemType === 'MATERIAL') {
          const { materialId, quantity } = item;

          // ---------------------------------------------------------
          // 1. HANDLE SOURCE INVENTORY (Deduct)
          // ---------------------------------------------------------
          const sourceInventory = await prisma.inventory.findFirst({
            where: {
              companyId,
              materialId,
              location: fromLocation,
              projectId: fromProjectId || null,
            },
          });

          if (
            !sourceInventory ||
            sourceInventory.quantityAvailable < quantity
          ) {
            throw new Error(
              `Insufficient stock for material ${materialId} at source`
            );
          }

          // Capture rate for valuation at destination
          const transferRate = sourceInventory.averageRate || 0;

          // Deduct from Source: Decrease Available, Increase Used (Transferred Out)
          await prisma.inventory.update({
            where: { id: sourceInventory.id },
            data: {
              quantityAvailable: { decrement: quantity },
              quantityUsed: { increment: quantity },
            },
          });

          // ---------------------------------------------------------
          // 2. HANDLE DESTINATION INVENTORY (Add)
          // ---------------------------------------------------------
          let destInventory = await prisma.inventory.findFirst({
            where: {
              companyId,
              materialId,
              location: toLocation,
              projectId: toProjectId || null,
            },
          });

          if (!destInventory) {
            destInventory = await prisma.inventory.create({
              data: {
                companyId,
                materialId,
                location: toLocation,
                projectId: toProjectId || null,
                quantityTotal: 0,
                quantityAvailable: 0,
                quantityUsed: 0,
                averageRate: 0,
                totalValue: 0,
              },
            });
          }

          // Calculate New Weighted Average Cost at Destination
          const currentTotalValue = destInventory.totalValue || 0; // Or calculate from available * rate
          const incomingValue = quantity * transferRate;
          const newTotalValue = currentTotalValue + incomingValue;

          const currentQty = destInventory.quantityAvailable;
          const newTotalQty = currentQty + quantity;
          const newAvgRate = newTotalQty > 0 ? newTotalValue / newTotalQty : 0;

          // Update Destination: Increase Total (History), Increase Available
          await prisma.inventory.update({
            where: { id: destInventory.id },
            data: {
              quantityTotal: { increment: quantity }, // Track total stock ever received/transferred in
              quantityAvailable: { increment: quantity }, // Current stock
              totalValue: newTotalValue,
              averageRate: newAvgRate,
            },
          });

          // Create Transfer Item Record
          await prisma.inventoryTransferItem.create({
            data: {
              transferId: transfer.id,
              itemType: 'MATERIAL',
              materialId,
              quantity,
            },
          });

          // If Destination is Project, create a specific Batch for tracking
          if (toLocation === 'PROJECT') {
            await prisma.materialBatch.create({
              data: {
                materialId,
                projectId: toProjectId,
                quantity,
                unitPrice: transferRate,
                purchaseDate: new Date(), // Transfer date acts as purchase date for project
                batchNumber: `TRF-BATCH-${transfer.transferNo}`,
              },
            });
          }
        } else if (item.itemType === 'EQUIPMENT') {
          const { equipmentId } = item;
          await prisma.inventoryTransferItem.create({
            data: {
              transferId: transfer.id,
              itemType: 'EQUIPMENT',
              equipmentId,
            },
          });

          // Update Equipment Location
          await prisma.equipment.update({
            where: { id: equipmentId },
            data: {
              status: 'IN_USE',
              location: toLocation,
              currentProjectId: toLocation === 'PROJECT' ? toProjectId : null,
            },
          });
        }
      }
      return transfer;
    });

    res.status(201).json({
      success: true,
      message: 'Transfer completed successfully',
      data: result,
    });
  } catch (error) {
    console.error('Create transfer error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
};

export const getInventoryTransfers = async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required' });
    const { companyId } = req.user;

    // Pagination, Filter, Search
    const {
      page = 1,
      limit = 20,
      status,
      fromLocation,
      toLocation,
      startDate,
      endDate,
      search,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { companyId };

    // Filters
    if (status) where.status = status;
    if (fromLocation) where.fromLocation = fromLocation;
    if (toLocation) where.toLocation = toLocation;

    // Date Range
    if (startDate || endDate) {
      where.transferDate = {};
      if (startDate) where.transferDate.gte = new Date(startDate);
      if (endDate) where.transferDate.lte = new Date(endDate);
    }

    // Search
    if (search) {
      where.OR = [
        { transferNo: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [transfers, total] = await Promise.all([
      prisma.inventoryTransfer.findMany({
        where,
        include: {
          fromProject: { select: { name: true } },
          toProject: { select: { name: true } },
          items: { include: { material: true, equipment: true } },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.inventoryTransfer.count({ where }),
    ]);

    res.json({
      success: true,
      data: transfers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: 'Error fetching transfers' });
  }
};

export const updateTransferStatus = async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required' });
    const { userId, companyId } = req.user;
    const { id } = req.params;
    const { status } = req.body;

    const transfer = await prisma.inventoryTransfer.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!transfer)
      return res.status(404).json({ message: 'Transfer not found' });
    if (transfer.status !== 'IN_TRANSIT')
      return res.status(400).json({ message: 'Transfer already processed' });

    const result = await prisma.$transaction(async (prisma) => {
      if (status === 'COMPLETED') {
        for (const item of transfer.items) {
          if (item.itemType === 'MATERIAL') {
            let destInventory = await prisma.inventory.findFirst({
              where: {
                companyId,
                materialId: item.materialId,
                location: transfer.toLocation,
                projectId: transfer.toProjectId || null,
              },
            });

            if (!destInventory) {
              destInventory = await prisma.inventory.create({
                data: {
                  companyId,
                  materialId: item.materialId,
                  location: transfer.toLocation,
                  projectId: transfer.toProjectId || null,
                  quantityTotal: 0,
                  quantityAvailable: 0,
                  averageRate: 0,
                  totalValue: 0,
                },
              });
            }

            const sourceInv = await prisma.inventory.findFirst({
              where: {
                companyId,
                materialId: item.materialId,
                location: transfer.fromLocation,
                projectId: transfer.fromProjectId || null,
              },
            });
            const rate = sourceInv ? sourceInv.averageRate : 0;

            const newTotalValue =
              destInventory.totalValue + item.quantity * rate;
            const newTotalQty = destInventory.quantityAvailable + item.quantity;
            const newAvg = newTotalQty > 0 ? newTotalValue / newTotalQty : 0;

            await prisma.inventory.update({
              where: { id: destInventory.id },
              data: {
                quantityTotal: { increment: item.quantity },
                quantityAvailable: { increment: item.quantity },
                totalValue: newTotalValue,
                averageRate: newAvg,
              },
            });

            if (transfer.toLocation === 'PROJECT') {
              await prisma.materialBatch.create({
                data: {
                  materialId: item.materialId,
                  projectId: transfer.toProjectId,
                  quantity: item.quantity,
                  unitPrice: rate,
                  purchaseDate: new Date(),
                },
              });
            }
          }
        }
      } else if (status === 'CANCELLED') {
        for (const item of transfer.items) {
          if (item.itemType === 'MATERIAL') {
            const sourceInv = await prisma.inventory.findFirst({
              where: {
                companyId,
                materialId: item.materialId,
                location: transfer.fromLocation,
                projectId: transfer.fromProjectId || null,
              },
            });
            if (sourceInv) {
              await prisma.inventory.update({
                where: { id: sourceInv.id },
                data: {
                  quantityAvailable: { increment: item.quantity },
                  quantityUsed: { decrement: item.quantity },
                },
              });
            }
          }
        }
      }

      return await prisma.inventoryTransfer.update({
        where: { id },
        data: { status, approvedById: userId, approvedAt: new Date() },
      });
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Update transfer error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ==============================================================================
// 4. EQUIPMENT CONTROLLERS
// ==============================================================================

export const getAllEquipment = async (req, res) => {
  if (!req.user)
    return res
      .status(401)
      .json({ success: false, message: 'Authentication required' });
  const { companyId } = req.user;

  // 🚨 FIX 1: Extract projectId from req.query
  const { page = 1, limit = 20, status, ownershipType, search, projectId } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = { companyId };

  if (status) where.status = status;
  if (ownershipType) where.ownershipType = ownershipType;

  if (projectId) {
    where.currentProjectId = projectId; 
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
      { serialNumber: { contains: search, mode: 'insensitive' } },
      { type: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [equipment, total, stats] = await Promise.all([
    // 1. Paginated Data
    prisma.equipment.findMany({
      where,
      skip,
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
    }),
    // 2. Total Count
    prisma.equipment.count({ where }),
    // 3. Aggregate Total Value
    prisma.equipment.aggregate({
      where,
      _sum: { purchaseCost: true },
    }),
  ]);

  const totalValue = stats._sum.purchaseCost || 0;

  res.json({
    success: true,
    data: equipment,
    summary: {
      totalEquipment: total,
      totalValue,
    },
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
    },
  });
};

export const getEquipmentById = async (req, res) => {
  const { id } = req.params;
  const equipment = await prisma.equipment.findUnique({ where: { id } });
  if (!equipment) return res.status(404).json({ message: 'Not found' });
  res.json({ success: true, data: equipment });
};

export const createEquipment = async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required' });
    const { userId, companyId } = req.user;
    const equipment = await prisma.equipment.create({
      data: {
        ...req.body,
        companyId,
        createdById: userId,
        location: 'GLOBAL',
        status: 'AVAILABLE',
      },
    });
    res.status(201).json({ success: true, data: equipment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateEquipment = async (req, res) => {
  const { id } = req.params;
  const equipment = await prisma.equipment.update({
    where: { id },
    data: req.body,
  });
  res.json({ success: true, data: equipment });
};

export const deleteEquipment = async (req, res) => {
  try {
    const { id } = req.params;
    const equipment = await prisma.equipment.findUnique({ where: { id } });
    if (equipment.status === 'IN_USE')
      return res
        .status(400)
        .json({ message: 'Cannot delete equipment currently in use.' });
    await prisma.equipment.delete({ where: { id } });
    res.json({ success: true, message: 'Equipment deleted' });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: 'Error deleting equipment' });
  }
};

export const assignEquipmentToProject = async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required' });
    const { userId, companyId } = req.user;
    const { id } = req.params;
    const { projectId, assignedRate, assignedFuelCost } = req.body;

    await prisma.equipment.update({
      where: { id },
      data: {
        location: 'PROJECT',
        currentProjectId: projectId,
        status: 'IN_USE',
      },
    });

    const transfer = await prisma.inventoryTransfer.create({
      data: {
        transferNo: `EQ-ASSIGN-${Date.now()}`,
        companyId,
        fromLocation: 'GLOBAL',
        toLocation: 'PROJECT',
        toProjectId: projectId,
        status: 'COMPLETED',
        requestedById: userId,
        approvedById: userId,
        items: {
          create: {
            itemType: 'EQUIPMENT',
            equipmentId: id,
            assignedRate,
            assignedFuelCost,
          },
        },
      },
    });
    res.json({ success: true, message: 'Equipment assigned', data: transfer });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Assignment failed' });
  }
};

export const releaseEquipmentFromProject = async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required' });
    const { userId, companyId } = req.user;
    const { id } = req.params;

    const equipment = await prisma.equipment.findUnique({ where: { id } });
    if (!equipment || !equipment.currentProjectId)
      return res
        .status(400)
        .json({ message: 'Equipment not assigned to project' });

    await prisma.equipment.update({
      where: { id },
      data: { location: 'GLOBAL', currentProjectId: null, status: 'AVAILABLE' },
    });

    await prisma.inventoryTransfer.create({
      data: {
        transferNo: `EQ-RETURN-${Date.now()}`,
        companyId,
        fromLocation: 'PROJECT',
        fromProjectId: equipment.currentProjectId,
        toLocation: 'GLOBAL',
        status: 'COMPLETED',
        requestedById: userId,
        items: { create: { itemType: 'EQUIPMENT', equipmentId: id } },
      },
    });
    res.json({ success: true, message: 'Equipment released' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Release failed' });
  }
};

// ==============================================================================
// 5. MATERIAL MASTER MANAGEMENT
// ==============================================================================

export const createMaterial = async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required' });
    const { userId, companyId } = req.user;

    const hasPermission = await checkInventoryPermission(
      userId,
      companyId,
      'MATERIAL_CREATE'
    );
    if (!hasPermission)
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });

    const {
      name,
      unit,
      materialCode,
      minimumStock,
      unitPrice,
      supplier,
      supplierContact,
    } = req.body;

    const existing = await prisma.material.findFirst({
      where: {
        companyId,
        OR: [
          { materialCode: materialCode || undefined },
          { name: { equals: name, mode: 'insensitive' } },
        ],
      },
    });

    if (existing)
      return res.status(400).json({
        success: false,
        message: 'Material with this name or code already exists',
      });

    const material = await prisma.material.create({
      data: {
        companyId,
        name,
        unit,
        materialCode,
        minimumStock,
        unitPrice,
        supplier,
        supplierContact,
        createdById: userId,
        stockQuantity: 0,
      },
    });

    await prisma.inventory.create({
      data: {
        companyId,
        materialId: material.id,
        location: 'GLOBAL',
        quantityTotal: 0,
        quantityAvailable: 0,
        averageRate: 0,
        totalValue: 0,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Material created successfully',
      data: material,
    });
  } catch (error) {
    console.error('Create material error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAllMaterials = async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required' });
    const { companyId } = req.user;

    // Pagination & Search
    const { page = 1, limit = 20, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { companyId };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { materialCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [materials, total] = await Promise.all([
      prisma.material.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { name: 'asc' },
      }),
      prisma.material.count({ where }),
    ]);

    res.json({
      success: true,
      data: materials,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get materials error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getMaterialById = async (req, res) => {
  try {
    const { id } = req.params;
    const material = await prisma.material.findUnique({ where: { id } });
    if (!material)
      return res
        .status(404)
        .json({ success: false, message: 'Material not found' });
    res.json({ success: true, data: material });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const updateMaterial = async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required' });
    const { userId, companyId } = req.user;
    const { id } = req.params;

    const hasPermission = await checkInventoryPermission(
      userId,
      companyId,
      'MATERIAL_UPDATE'
    );
    if (!hasPermission)
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });

    const material = await prisma.material.update({
      where: { id },
      data: req.body,
    });
    res.json({ success: true, message: 'Material updated', data: material });
  } catch (error) {
    console.error('Update material error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const deleteMaterial = async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required' });
    const { userId, companyId } = req.user;
    const { id } = req.params;

    const hasPermission = await checkInventoryPermission(
      userId,
      companyId,
      'MATERIAL_DELETE'
    );
    if (!hasPermission)
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });

    const inventory = await prisma.inventory.findFirst({
      where: {
        materialId: id,
        OR: [{ quantityAvailable: { gt: 0 } }, { quantityUsed: { gt: 0 } }],
      },
    });
    if (inventory)
      return res.status(400).json({
        success: false,
        message: 'Cannot delete material: Active stock or history exists.',
      });

    const transactions = await prisma.stockTransaction.findFirst({
      where: { materialId: id },
    });
    if (transactions)
      return res.status(400).json({
        success: false,
        message: 'Cannot delete material: Transaction history exists.',
      });

    const poItems = await prisma.purchaseOrderItem.findFirst({
      where: { materialId: id },
    });
    if (poItems)
      return res.status(400).json({
        success: false,
        message: 'Cannot delete material: Associated with Purchase Orders.',
      });

    await prisma.material.delete({ where: { id } });
    res.json({ success: true, message: 'Material deleted successfully' });
  } catch (error) {
    console.error('Delete material error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ==============================================================================
// 6. REPORTING CONTROLLERS
// ==============================================================================

export const getInventoryValuationReport = async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required' });
    const { companyId, userId } = req.user;

    const hasPermission = await checkInventoryPermission(
      userId,
      companyId,
      'REPORTS_VIEW'
    );
    if (!hasPermission)
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });

    // Group by Location Type
    const valuation = await prisma.inventory.groupBy({
      by: ['location', 'projectId'],
      where: { companyId },
      _sum: {
        totalValue: true,
        quantityAvailable: true,
      },
    });

    // Enrich with Project Names
    const projectIds = valuation
      .filter((v) => v.projectId)
      .map((v) => v.projectId);

    const projects = await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true, projectId: true },
    });

    const projectMap = projects.reduce(
      (acc, curr) => ({ ...acc, [curr.id]: curr }),
      {}
    );

    const report = valuation.map((item) => ({
      locationType: item.location,
      projectName: item.projectId
        ? projectMap[item.projectId]?.name
        : 'Global Warehouse',
      projectCode: item.projectId
        ? projectMap[item.projectId]?.projectId
        : 'N/A',
      totalItems: item._sum.quantityAvailable,
      totalValue: item._sum.totalValue,
    }));

    // Calculate Grand Total
    const grandTotal = report.reduce(
      (sum, item) => sum + (item.totalValue || 0),
      0
    );

    res.json({
      success: true,
      data: report,
      summary: { grandTotalValue: grandTotal },
    });
  } catch (error) {
    console.error('Valuation report error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getLowStockReport = async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required' });
    const { companyId, userId } = req.user;
    const { projectId } = req.query; // <-- 1. Extract projectId

    const hasPermission = await checkInventoryPermission(
      userId,
      companyId,
      'REPORTS_VIEW'
    );
    if (!hasPermission)
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });

    const materials = await prisma.material.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        unit: true,
        materialCode: true,
        minimumStock: true,
      },
    });

    // 2. Dynamically set the where clause based on Project vs Global
    const inventoryWhere = { companyId };
    if (projectId) {
      inventoryWhere.location = 'PROJECT';
      inventoryWhere.projectId = projectId;
    } else {
      inventoryWhere.location = 'GLOBAL';
      inventoryWhere.projectId = null;
    }

    const inventoryData = await prisma.inventory.findMany({
      where: inventoryWhere,
      select: { materialId: true, quantityAvailable: true },
    });

    const inventoryMap = inventoryData.reduce((acc, item) => {
      acc[item.materialId] = item.quantityAvailable;
      return acc;
    }, {});

    const lowStockItems = materials
      .map((mat) => {
        const currentStock = inventoryMap[mat.id] || 0;
        return {
          ...mat,
          currentStock: currentStock, // Renamed for generic use
          shortfall: mat.minimumStock - currentStock,
          status: currentStock === 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK',
        };
      })
      .filter((item) => item.currentStock < item.minimumStock);

    res.json({
      success: true,
      data: lowStockItems,
      count: lowStockItems.length,
    });
  } catch (error) {
    console.error('Low stock report error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getStockMovementReport = async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required' });
    const { companyId, userId } = req.user;
    const { startDate, endDate, materialId, transactionType, projectId } =
      req.query;

    const hasPermission = await checkInventoryPermission(
      userId,
      companyId,
      'REPORTS_VIEW'
    );
    if (!hasPermission)
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });

    const where = {
      material: { companyId }, // Ensure belongs to company
    };

    // Date Filters
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    if (materialId) where.materialId = materialId;
    if (transactionType) where.transactionType = transactionType;
    if (projectId) where.projectId = projectId;

    const movements = await prisma.stockTransaction.findMany({
      where,
      include: {
        material: { select: { name: true, unit: true, materialCode: true } },
        project: { select: { name: true, projectId: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100, // Limit for performance, maybe add pagination if needed
    });

    res.json({ success: true, data: movements });
  } catch (error) {
    console.error('Stock movement report error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getMaterialConsumptionReport = async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required' });
    const { companyId, userId } = req.user;
    const { startDate, endDate, projectId } = req.query;

    const hasPermission = await checkInventoryPermission(
      userId,
      companyId,
      'REPORTS_VIEW'
    );
    if (!hasPermission)
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });

    const where = {
      project: { companyId },
    };

    if (projectId) where.projectId = projectId;
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    // Aggregate consumption
    const consumption = await prisma.materialConsumption.groupBy({
      by: ['materialId', 'projectId'],
      where,
      _sum: {
        quantity: true,
        totalCost: true,
      },
    });

    // Resolve Names
    const materialIds = [...new Set(consumption.map((c) => c.materialId))];
    const projectIds = [...new Set(consumption.map((c) => c.projectId))];

    const [materials, projects] = await Promise.all([
      prisma.material.findMany({
        where: { id: { in: materialIds } },
        select: { id: true, name: true, unit: true },
      }),
      prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true },
      }),
    ]);

    const matMap = materials.reduce((acc, m) => ({ ...acc, [m.id]: m }), {});
    const projMap = projects.reduce((acc, p) => ({ ...acc, [p.id]: p }), {});

    const report = consumption.map((item) => ({
      projectName: projMap[item.projectId]?.name || 'Unknown',
      materialName: matMap[item.materialId]?.name || 'Unknown',
      unit: matMap[item.materialId]?.unit,
      totalQuantityConsumed: item._sum.quantity,
      totalCost: item._sum.totalCost,
    }));

    res.json({ success: true, data: report });
  } catch (error) {
    console.error('Consumption report error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
