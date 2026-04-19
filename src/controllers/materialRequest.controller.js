import prisma from '../config/database.js';

// ==============================================================================
// HELPER FUNCTIONS
// ==============================================================================

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

// Helper to generate material request number
const generateMaterialRequestNo = async (companyId, prefix = 'MAT') => {
  const settings = await prisma.companySettings.findUnique({
    where: { companyId },
  });

  const materialPrefix = settings?.materialPrefix || prefix;
  const year = new Date().getFullYear().toString().slice(-2);
  const month = (new Date().getMonth() + 1).toString().padStart(2, '0');

  // Get the latest material request for this company to increment serial
  const latestRequest = await prisma.materialRequest.findFirst({
    where: {
      requestNo: {
        startsWith: `${materialPrefix}${year}${month}`,
      },
      project: { companyId }, // Ensure company scope
    },
    orderBy: { requestNo: 'desc' },
    select: { requestNo: true },
  });

  let serial = 1;
  if (latestRequest && latestRequest.requestNo) {
    const lastSerial = parseInt(latestRequest.requestNo.slice(-4)) || 0;
    serial = lastSerial + 1;
  }

  return `${materialPrefix}${year}${month}${serial.toString().padStart(4, '0')}`;
};

// ==============================================================================
// CORE CONTROLLERS
// ==============================================================================

// Check material stock
export const checkMaterialStock = async (req, res) => {
  try {
    const { materialId, projectId, quantity } = req.body;

    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'INVENTORY_READ'
    );

    if (!hasPermission) {
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });
    }

    const material = await prisma.material.findUnique({
      where: { id: materialId },
    });

    if (!material) {
      return res
        .status(404)
        .json({ success: false, message: 'Material not found' });
    }

    // 1. Check Global Stock (Retention)
    const globalInventory = await prisma.inventory.findFirst({
      where: {
        companyId: req.user.companyId,
        materialId,
        location: 'GLOBAL',
      },
    });

    // 2. Check Project Stock (if project provided)
    let projectInventory = null;
    if (projectId) {
      projectInventory = await prisma.inventory.findFirst({
        where: {
          companyId: req.user.companyId,
          materialId,
          projectId,
          location: 'PROJECT',
        },
      });
    }

    const reqQty = parseFloat(quantity) || 0;
    const globalStock = globalInventory?.quantityAvailable || 0;
    const projectStock = projectInventory?.quantityAvailable || 0;
    const minStock = material.minimumStock || 0;

    const response = {
      material: material.name,
      unit: material.unit,
      requestedQuantity: reqQty,
      globalStock: {
        available: globalStock,
        canFulfill: globalStock >= reqQty,
      },
      projectStock: {
        available: projectStock,
        isBelowMinimum: projectStock < minStock,
      },
      recommendation:
        projectStock >= reqQty
          ? 'Material already available at site. Consume from Project Inventory.'
          : globalStock >= reqQty
            ? 'Available in Global Retention. Create a Transfer Request.'
            : 'Insufficient stock. Create a Purchase Order.',
    };

    res.json({ success: true, data: response });
  } catch (error) {
    console.error('Check stock error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Create Material Request (With Budget Checking)
export const createMaterialRequest = async (req, res) => {
  try {
    const {
      projectId,
      materialId,
      quantity,
      unit,
      purpose,
      urgency = 'MEDIUM',
      expectedDelivery,
      supplier,
    } = req.body;
    let materialName = req.body.materialName;

    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'MATERIAL_REQUEST'
    );

    if (!hasPermission) {
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });
    }

    // Validate Project
    const project = await prisma.project.findFirst({
      where: { id: projectId, companyId: req.user.companyId },
    });

    if (!project) {
      return res
        .status(404)
        .json({ success: false, message: 'Project not found' });
    }

    const quantityNum = parseFloat(quantity);
    if (isNaN(quantityNum) || quantityNum <= 0) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid quantity' });
    }

    let material = null;
    // Validate Material
    if (materialId) {
      material = await prisma.material.findFirst({
        where: { id: materialId, companyId: req.user.companyId },
      });
      if (!material) {
        return res
          .status(404)
          .json({ success: false, message: 'Material not found' });
      }
      materialName = material.name;
    } else if (!materialName) {
      return res.status(400).json({
        success: false,
        message: 'Either materialId or materialName must be provided',
      });
    }

    // WORKFLOW ADDITION: Pre-check the budget before generating the request
    let estimatedCost = 0;
    if (material && material.unitPrice) {
      estimatedCost = quantityNum * material.unitPrice;

      const activeBudget = await prisma.budget.findFirst({
        where: {
          projectId: projectId,
          companyId: req.user.companyId,
          isActive: true,
          status: { in: ['ACTIVE', 'APPROVED'] },
        },
        include: {
          categories: {
            where: { category: 'MATERIAL' },
          },
        },
      });

      const budgetCategory = activeBudget?.categories?.[0];

      if (!activeBudget || !budgetCategory) {
        return res.status(400).json({
          success: false,
          message:
            'No active budget or MATERIAL category found for this project.',
        });
      }

      if (budgetCategory.remainingAmount < estimatedCost) {
        return res.status(400).json({
          success: false,
          message: `Budget check failed. Required: ${estimatedCost}, Available: ${budgetCategory.remainingAmount}. Request rejected.`,
        });
      }
    }

    const requestNo = await generateMaterialRequestNo(req.user.companyId);

    const materialRequest = await prisma.materialRequest.create({
      data: {
        requestNo,
        projectId,
        materialId: materialId || null,
        materialName,
        quantity: quantityNum,
        unit,
        purpose,
        urgency,
        requestedById: req.user.userId,
        status: 'REQUESTED',
        supplier: supplier || null,
        estimatedCost: estimatedCost > 0 ? estimatedCost : null,
        expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : null,
      },
    });

    // Log Activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'MATERIAL_REQUEST_CREATED',
        entityType: 'MATERIAL_REQUEST',
        entityId: materialRequest.id,
        newData: { requestNo, quantity, projectId, estimatedCost },
      },
    });

    // Notify Approvers
    const approvers = await prisma.user.findMany({
      where: {
        companyId: req.user.companyId,
        isActive: true,
        role: {
          rolePermissions: {
            some: { permission: { code: 'MATERIAL_APPROVE' } },
          },
        },
      },
      select: { id: true },
    });

    if (approvers.length > 0) {
      const notifications = approvers.map((approver) => ({
        userId: approver.id,
        title: 'New Material Request',
        message: `New material request ${requestNo} created for project: ${project.name}`,
        type: 'MATERIAL_REQUEST',
        relatedId: materialRequest.id,
      }));
      await prisma.notification.createMany({ data: notifications });
    }

    res.status(201).json({
      success: true,
      message: 'Material Request created',
      data: materialRequest,
    });
  } catch (error) {
    console.error('Create request error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Update Status (Removed auto-budget commit, handled by PO workflow now)
export const updateMaterialRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, supplier, expectedDelivery, rejectionReason, notes } =
      req.body;

    // Determine Permission Required based on Status
    let permissionRequired = 'MATERIAL_REQUEST'; // Default
    if (status === 'APPROVED') permissionRequired = 'MATERIAL_APPROVE';
    if (status === 'DELIVERED') permissionRequired = 'INVENTORY_WRITE'; // Needs write access to inventory

    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      permissionRequired
    );

    if (!hasPermission) {
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });
    }

    const request = await prisma.materialRequest.findUnique({
      where: { id },
      include: { material: true },
    });

    if (!request) return res.status(404).json({ message: 'Request not found' });

    // Handle DELIVERED status (Update Inventory Logic)
    if (status === 'DELIVERED') {
      if (!request.materialId) {
        return res.status(400).json({
          message: 'Cannot deliver request without linked Material ID',
        });
      }

      await prisma.$transaction(async (tx) => {
        // 1. Find/Create Project Inventory
        let inventory = await tx.inventory.findFirst({
          where: {
            companyId: req.user.companyId,
            materialId: request.materialId,
            projectId: request.projectId,
            location: 'PROJECT',
          },
        });

        if (!inventory) {
          inventory = await tx.inventory.create({
            data: {
              companyId: req.user.companyId,
              materialId: request.materialId,
              projectId: request.projectId,
              location: 'PROJECT',
              quantityAvailable: 0,
              quantityTotal: 0,
              quantityUsed: 0,
              averageRate: 0,
              totalValue: 0,
            },
          });
        }

        // 2. Update Inventory
        const unitPrice = request.material?.unitPrice || 0;
        const incomingValue = request.quantity * unitPrice;
        const newTotalValue = inventory.totalValue + incomingValue;
        const newTotalQty = inventory.quantityAvailable + request.quantity;
        // WAC Calculation
        const newAvgRate = newTotalQty > 0 ? newTotalValue / newTotalQty : 0;

        await tx.inventory.update({
          where: { id: inventory.id },
          data: {
            quantityAvailable: { increment: request.quantity },
            quantityTotal: { increment: request.quantity },
            totalValue: newTotalValue,
            averageRate: newAvgRate,
          },
        });

        // 3. Create Transaction Log
        await tx.stockTransaction.create({
          data: {
            materialId: request.materialId,
            projectId: request.projectId,
            transactionType: 'PURCHASE', // Or 'REQUEST_FULFILLMENT'
            quantity: request.quantity,
            previousStock: inventory.quantityAvailable,
            newStock: inventory.quantityAvailable + request.quantity,
            referenceId: request.id,
            referenceType: 'MATERIAL_REQUEST',
            createdById: req.user.userId,
            notes: `Request ${request.requestNo} Delivered`,
          },
        });

        // 4. Update Request Status
        await tx.materialRequest.update({
          where: { id },
          data: {
            status: 'DELIVERED',
            actualDelivery: new Date(),
            notes,
            orderedById: req.user.userId, // Track who marked delivery
          },
        });
      });

      return res.json({
        success: true,
        message: 'Request marked Delivered and Inventory updated',
      });
    }

    // Handle Normal Status Updates (APPROVED, ORDERED, REJECTED, etc.)
    // Note: Budget commitment is now handled during the Purchase Order creation/approval stage
    const updated = await prisma.materialRequest.update({
      where: { id },
      data: {
        status,
        supplier,
        expectedDelivery: expectedDelivery
          ? new Date(expectedDelivery)
          : undefined,
        rejectionReason,
        notes,
        ...(status === 'APPROVED'
          ? { approvedById: req.user.userId, approvedAt: new Date() }
          : {}),
        ...(status === 'ORDERED'
          ? { orderedById: req.user.userId, orderedAt: new Date() }
          : {}),
      },
    });

    // Notify Requester
    await prisma.notification.create({
      data: {
        userId: request.requestedById,
        title: `Material Request ${status}`,
        message: `Your material request ${request.requestNo} has been ${status.toLowerCase()}`,
        type: 'MATERIAL_REQUEST',
        relatedId: id,
      },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Consume Material (DPR Integration)
export const consumeMaterialFromDPR = async (req, res) => {
  try {
    const { dprId, materialId, quantity, unit, remarks } = req.body;
    const { userId, companyId } = req.user;

    const hasPermission = await checkMaterialPermission(
      userId,
      companyId,
      'MATERIAL_CONSUME'
    );
    if (!hasPermission)
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });

    // Get DPR to find Project
    const dpr = await prisma.dailyProgressReport.findUnique({
      where: { id: dprId },
      include: { project: true },
    });
    if (!dpr) return res.status(404).json({ message: 'DPR not found' });

    // Get Project Inventory
    const inventory = await prisma.inventory.findFirst({
      where: {
        companyId,
        materialId,
        projectId: dpr.projectId,
        location: 'PROJECT',
      },
      include: { material: true },
    });

    if (!inventory)
      return res.status(404).json({
        message: 'Material not initialized in this project inventory',
      });

    const qty = parseFloat(quantity);
    if (inventory.quantityAvailable < qty) {
      return res.status(400).json({
        message: `Insufficient stock. Available: ${inventory.quantityAvailable}`,
        suggestion: 'Create a Material Request',
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      // FIFO from batches (oldest purchaseDate first)
      const batches = await tx.materialBatch.findMany({
        where: {
          materialId,
          projectId: dpr.projectId,
          quantity: { gt: 0 },
        },
        orderBy: { purchaseDate: 'asc' },
      });

      let remaining = qty;
      let totalCost = 0;
      let runningStock = inventory.quantityAvailable;
      const breakdown = [];

      for (const batch of batches) {
        if (remaining <= 0) break;
        const useQty = Math.min(remaining, batch.quantity);
        if (useQty <= 0) continue;

        await tx.materialBatch.update({
          where: { id: batch.id },
          data: { quantity: { decrement: useQty } },
        });

        totalCost += useQty * batch.unitPrice;
        breakdown.push({
          batchId: batch.id,
          qty: useQty,
          unitPrice: batch.unitPrice,
          batchNumber: batch.batchNumber || null,
        });

        await tx.stockTransaction.create({
          data: {
            materialId,
            projectId: dpr.projectId,
            transactionType: 'CONSUMPTION',
            quantity: useQty,
            previousStock: runningStock,
            newStock: runningStock - useQty,
            referenceId: batch.id,
            referenceType: 'MATERIAL_BATCH',
            createdById: userId,
            notes: `Consumed from batch ${batch.batchNumber || batch.id} in DPR: ${dpr.reportNo}`,
          },
        });

        runningStock -= useQty;
        remaining -= useQty;
      }

      // Fallback: if there are no batches (legacy data), cost using inventory averageRate.
      if (remaining > 0) {
        const fallbackRate = inventory.averageRate || 0;
        totalCost += remaining * fallbackRate;
        breakdown.push({
          batchId: null,
          qty: remaining,
          unitPrice: fallbackRate,
          batchNumber: null,
        });

        await tx.stockTransaction.create({
          data: {
            materialId,
            projectId: dpr.projectId,
            transactionType: 'CONSUMPTION',
            quantity: remaining,
            previousStock: runningStock,
            newStock: runningStock - remaining,
            referenceId: dprId,
            referenceType: 'CONSUMPTION',
            createdById: userId,
            notes: `Consumed using average rate (no batches found) in DPR: ${dpr.reportNo}`,
          },
        });

        runningStock -= remaining;
        remaining = 0;
      }

      const newTotalValue = Math.max(0, inventory.totalValue - totalCost);
      const newAvailable = inventory.quantityAvailable - qty;
      const newAvgRate = newAvailable > 0 ? newTotalValue / newAvailable : 0;

      await tx.inventory.update({
        where: { id: inventory.id },
        data: {
          quantityAvailable: { decrement: qty },
          quantityUsed: { increment: qty },
          totalValue: newTotalValue,
          averageRate: newAvgRate,
        },
      });

      // Create Consumption Record
      const enrichedRemarks =
        (remarks ? `${remarks}\n` : '') +
        `BatchBreakdown=${JSON.stringify(breakdown)}`;

      const consumption = await tx.materialConsumption.create({
        data: {
          dprId,
          materialId,
          projectId: dpr.projectId,
          quantity: qty,
          unit: unit || inventory.material.unit,
          remarks: enrichedRemarks,
          consumedById: userId,
          ratePerUnit: qty > 0 ? totalCost / qty : 0,
          totalCost,
        },
      });

      // Check Alerts
      const newStock = inventory.quantityAvailable - qty;
      const minStock = inventory.material.minimumStock || 0;

      if (newStock <= minStock) {
        await tx.stockAlert.create({
          data: {
            materialId,
            alertType: newStock <= 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK',
            currentStock: newStock,
            threshold: minStock,
            message: `${inventory.material.name} is below threshold at ${dpr.project.name}`,
            isResolved: false,
          },
        });
      }

      return consumption;
    });

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    console.error('Consumption error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Fulfill Request via Transfer (Retention -> Project)
export const fulfillRequestFromStock = async (req, res) => {
  try {
    const { requestId } = req.body;
    const { userId, companyId } = req.user;

    const hasPermission = await checkMaterialPermission(
      userId,
      companyId,
      'INVENTORY_WRITE'
    );
    if (!hasPermission)
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });

    const request = await prisma.materialRequest.findUnique({
      where: { id: requestId },
      include: { project: true },
    });

    if (!request || !request.materialId)
      return res
        .status(400)
        .json({ message: 'Invalid Request or missing Material link' });

    // Call Inventory Controller Logic basically, but simplified here
    // We create a Transfer directly
    const transfer = await prisma.inventoryTransfer.create({
      data: {
        transferNo: `FULFILL-${request.requestNo}`,
        companyId,
        fromLocation: 'GLOBAL',
        toLocation: 'PROJECT',
        toProjectId: request.projectId,
        status: 'IN_TRANSIT', // Admin needs to complete it via Inventory module
        requestedById: userId,
        description: `Fulfillment for Material Request ${request.requestNo}`,
        items: {
          create: {
            itemType: 'MATERIAL',
            materialId: request.materialId,
            quantity: request.quantity,
          },
        },
      },
    });

    // Update Request
    await prisma.materialRequest.update({
      where: { id: requestId },
      data: {
        status: 'APPROVED',
        notes: `Transfer initiated: ${transfer.transferNo}`,
      },
    });

    res.json({
      success: true,
      message: 'Transfer initiated successfully',
      data: transfer,
    });
  } catch (error) {
    console.error('Fulfillment error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get All Material Requests (With multi-status filtering support)
export const getAllMaterialRequests = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status,
      projectId,
      materialId,
      urgency,
      requestedById,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check MATERIAL_REQUEST permission
    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'MATERIAL_REQUEST'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view material requests',
      });
    }

    const where = {
      project: {
        companyId: req.user.companyId,
      },
    };

    // Add search filter
    if (search) {
      where.OR = [
        { requestNo: { contains: search, mode: 'insensitive' } },
        { materialName: { contains: search, mode: 'insensitive' } },
        { purpose: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Add filters - updated status to handle comma separated values
    if (status) {
      const statusArray = status.split(',').map((s) => s.trim());
      where.status = { in: statusArray };
    }

    if (projectId) where.projectId = projectId;
    if (materialId) where.materialId = materialId;
    if (urgency) where.urgency = urgency;
    if (requestedById) where.requestedById = requestedById;

    // For non-admin users, show only their requests or requests for their projects
    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        include: {
          role: {
            include: { rolePermissions: { include: { permission: true } } },
          },
        },
      });

      const hasAllMaterialAccess = user.role?.rolePermissions.some(
        (rp) =>
          rp.permission.code === 'VIEW_ALL_MATERIALS' ||
          rp.permission.code === 'ALL_ACCESS' ||
          rp.permission.code === 'FULL_COMPANY_ACCESS'
      );

      if (!hasAllMaterialAccess) {
        const userAssignments = await prisma.projectAssignment.findMany({
          where: { userId: req.user.userId },
          select: { projectId: true },
        });
        const assignedProjectIds = userAssignments.map((pa) => pa.projectId);

        where.AND = [
          {
            OR: [
              { requestedById: req.user.userId },
              { projectId: { in: assignedProjectIds } },
            ],
          },
        ];
      }
    }

    const [materialRequests, total] = await Promise.all([
      prisma.materialRequest.findMany({
        where,
        include: {
          project: { select: { id: true, name: true, projectId: true } },
          material: { select: { id: true, name: true, unit: true } }, // Minimal material details
          requestedBy: { select: { id: true, name: true, email: true } },
          approvedBy: { select: { id: true, name: true } },
          orderedBy: { select: { id: true, name: true } },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.materialRequest.count({ where }),
    ]);

    // Enhance with inventory data
    const requestsWithStockInfo = await Promise.all(
      materialRequests.map(async (request) => {
        let stockInfo = null;
        // Check Project specific inventory first
        if (request.materialId && request.projectId) {
          const inventory = await prisma.inventory.findFirst({
            where: {
              companyId: req.user.companyId,
              materialId: request.materialId,
              projectId: request.projectId,
            },
            include: { material: true },
          });

          if (inventory) {
            stockInfo = {
              currentStock: inventory.quantityAvailable,
              minimumStock: inventory.material.minimumStock,
              unit: inventory.material.unit,
              isBelowMinimum:
                inventory.quantityAvailable <
                (inventory.material.minimumStock || 0),
              shortage: Math.max(
                0,
                request.quantity - inventory.quantityAvailable
              ),
            };
          }
        }
        return { ...request, stockInfo };
      })
    );

    res.json({
      success: true,
      data: requestsWithStockInfo,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get material requests error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get Material Request by ID
export const getMaterialRequestById = async (req, res) => {
  try {
    const { id } = req.params;

    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'MATERIAL_REQUEST'
    );

    if (!hasPermission) {
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });
    }

    const materialRequest = await prisma.materialRequest.findFirst({
      where: {
        id,
        project: { companyId: req.user.companyId },
      },
      include: {
        project: {
          select: { id: true, name: true, projectId: true, location: true },
        },
        material: {
          select: {
            id: true,
            name: true,
            stockQuantity: true,
            minimumStock: true,
            unit: true,
            unitPrice: true,
            supplier: true,
          },
        },
        requestedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            designation: true,
          },
        },
        approvedBy: { select: { id: true, name: true, designation: true } },
        orderedBy: { select: { id: true, name: true, designation: true } },
      },
    });

    if (!materialRequest) {
      return res
        .status(404)
        .json({ success: false, message: 'Material request not found' });
    }

    // Get stock transactions related to this request
    const stockTransactions = await prisma.stockTransaction.findMany({
      where: {
        referenceId: id,
        referenceType: 'MATERIAL_REQUEST',
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: {
        ...materialRequest,
        stockTransactions,
      },
    });
  } catch (error) {
    console.error('Get material request error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Delete Material Request
export const deleteMaterialRequest = async (req, res) => {
  try {
    const { id } = req.params;

    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'MATERIAL_REQUEST'
    );

    if (!hasPermission) {
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });
    }

    const materialRequest = await prisma.materialRequest.findFirst({
      where: {
        id,
        project: { companyId: req.user.companyId },
      },
    });

    if (!materialRequest) {
      return res
        .status(404)
        .json({ success: false, message: 'Material request not found' });
    }

    const deletableStatuses = ['REQUESTED', 'REJECTED'];
    if (!deletableStatuses.includes(materialRequest.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete material request with status: ${materialRequest.status}`,
      });
    }

    const isRequester = materialRequest.requestedById === req.user.userId;
    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN' &&
      !isRequester
    ) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own material requests',
      });
    }

    await prisma.materialRequest.delete({ where: { id } });

    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'MATERIAL_REQUEST_DELETED',
        entityType: 'MATERIAL_REQUEST',
        entityId: id,
        oldData: materialRequest,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Material request deleted successfully',
    });
  } catch (error) {
    console.error('Delete material request error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get Material Request Statistics
export const getMaterialRequestStatistics = async (req, res) => {
  try {
    const { projectId, startDate, endDate } = req.query;

    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'MATERIAL_REQUEST'
    );

    if (!hasPermission) {
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });
    }

    const where = {
      project: { companyId: req.user.companyId },
    };

    if (projectId) where.projectId = projectId;

    const defaultStartDate = new Date();
    defaultStartDate.setDate(defaultStartDate.getDate() - 90);

    where.createdAt = {
      gte: startDate ? new Date(startDate) : defaultStartDate,
    };

    if (endDate) {
      where.createdAt.lte = new Date(endDate);
    }

    const [
      requestsByStatus,
      requestsByUrgency,
      totalRequests,
      totalQuantity,
      pendingRequests,
      recentRequests,
    ] = await Promise.all([
      prisma.materialRequest.groupBy({
        by: ['status'],
        where,
        _count: true,
        _sum: { quantity: true },
      }),
      prisma.materialRequest.groupBy({
        by: ['urgency'],
        where,
        _count: true,
      }),
      prisma.materialRequest.count({ where }),
      prisma.materialRequest.aggregate({
        where,
        _sum: { quantity: true },
      }),
      prisma.materialRequest.count({
        where: {
          ...where,
          status: { in: ['REQUESTED', 'APPROVED', 'ORDERED'] },
        },
      }),
      prisma.materialRequest.findMany({
        where,
        include: {
          project: { select: { id: true, name: true } },
          material: { select: { id: true, name: true } },
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const statistics = {
      byStatus: requestsByStatus.reduce((acc, item) => {
        acc[item.status] = { count: item._count, quantity: item._sum.quantity };
        return acc;
      }, {}),
      byUrgency: requestsByUrgency.reduce((acc, item) => {
        acc[item.urgency] = item._count;
        return acc;
      }, {}),
      totals: {
        requests: totalRequests,
        quantity: totalQuantity._sum.quantity || 0,
        pending: pendingRequests,
        completed: totalRequests - pendingRequests,
        completionRate:
          totalRequests > 0
            ? ((totalRequests - pendingRequests) / totalRequests) * 100
            : 0,
      },
      recentRequests,
    };

    res.json({ success: true, data: statistics });
  } catch (error) {
    console.error('Get statistics error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get Material Requests by Project
export const getMaterialRequestsByProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { page = 1, limit = 10, status, materialId } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'MATERIAL_REQUEST'
    );

    if (!hasPermission) {
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, companyId: req.user.companyId },
    });

    if (!project) {
      return res
        .status(404)
        .json({ success: false, message: 'Project not found' });
    }

    const where = { projectId };
    // Update to handle multiple comma separated statuses
    if (status) {
      const statusArray = status.split(',').map((s) => s.trim());
      where.status = { in: statusArray };
    }
    if (materialId) where.materialId = materialId;

    const [materialRequests, total] = await Promise.all([
      prisma.materialRequest.findMany({
        where,
        include: {
          material: {
            select: { id: true, name: true, unit: true, minimumStock: true },
          },
          requestedBy: { select: { id: true, name: true, designation: true } },
          approvedBy: { select: { id: true, name: true } },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.materialRequest.count({ where }),
    ]);

    // Simple project stats
    const projectStats = {
      totalRequests: total,
      pendingRequests: materialRequests.filter((req) =>
        ['REQUESTED', 'APPROVED', 'ORDERED'].includes(req.status)
      ).length,
      deliveredRequests: materialRequests.filter(
        (req) => req.status === 'DELIVERED'
      ).length,
      totalQuantity: materialRequests.reduce(
        (sum, req) => sum + req.quantity,
        0
      ),
    };

    res.json({
      success: true,
      data: {
        project: { id: project.id, name: project.name },
        materialRequests,
        stats: projectStats,
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get material requests by project error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
