import prisma from '../config/database.js';
import { recalculateBudgetSummary } from '../services/budget.service.js';

// Helper function to check purchase order permissions
const checkPOPermission = async (userId, companyId, permissionCode) => {
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
      rp.permission.code === 'PO_ALL_ACCESS'
  );

  return hasPermission;
};

// Helper to calculate PO totals
const calculatePOTotals = async (poId) => {
  const items = await prisma.purchaseOrderItem.findMany({
    where: { purchaseOrderId: poId },
  });

  let subtotal = 0;
  let taxAmount = 0;
  let totalAmount = 0;
  let totalReceived = 0;
  let totalQuantity = 0;

  items.forEach((item) => {
    subtotal += item.totalPrice;
    taxAmount += item.taxAmount || 0;
    totalAmount += item.totalPrice + (item.taxAmount || 0);
    totalReceived += item.receivedQuantity || 0;
    totalQuantity += item.quantity;
  });

  const receiptPercent =
    totalQuantity > 0 ? (totalReceived / totalQuantity) * 100 : 0;

  await prisma.purchaseOrder.update({
    where: { id: poId },
    data: {
      subtotal,
      taxAmount,
      totalAmount,
      totalReceived,
      totalPending: totalQuantity - totalReceived,
      receiptPercent,
    },
  });

  return {
    subtotal,
    taxAmount,
    totalAmount,
    totalReceived,
    receiptPercent,
    totalQuantity,
  };
};

// Helper to create PO history
const createPOHistory = async (
  poId,
  userId,
  action,
  fromStatus,
  toStatus,
  changes = null,
  notes = null
) => {
  await prisma.purchaseOrderHistory.create({
    data: {
      purchaseOrderId: poId,
      action,
      fromStatus,
      toStatus,
      changes,
      performedById: userId,
      notes,
    },
  });
};

// Helper to safely parse dates and avoid "Invalid Date" objects crashing Prisma
const safeDate = (dateVal) => {
  if (!dateVal) return null;
  const parsed = new Date(dateVal);
  return isNaN(parsed.getTime()) ? null : parsed;
};

// ==================== PURCHASE ORDER CORE ====================

export const createPurchaseOrder = async (req, res) => {
  try {
    const {
      projectId,
      title,
      description,
      type,
      supplierId,
      supplierName,
      supplierAddress,
      supplierGST,
      supplierPAN,
      supplierContact,
      supplierEmail,
      supplierPhone,
      subtotal,
      taxAmount,
      taxRate,
      discount,
      discountType,
      shippingCost,
      otherCharges,
      currency,
      paymentTerm,
      advancePercentage,
      expectedDelivery,
      deliveryAddress,
      deliveryInstructions,
      shippingMethod,
      shippingTerms,
      validUntil,
      notes,
      terms,
      items,
      budgetId,
      budgetCategoryId,
    } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_CREATE'
    );

    if (!hasPermission) {
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, companyId: req.user.companyId },
    });

    if (!project)
      return res
        .status(404)
        .json({ success: false, message: 'Project not found' });

    let finalSupplierName = supplierName;
    let finalSupplierAddress = supplierAddress;
    let finalSupplierGST = supplierGST;
    let finalSupplierPAN = supplierPAN;
    let finalSupplierContact = supplierContact;
    let finalSupplierEmail = supplierEmail;
    let finalSupplierPhone = supplierPhone;

    if (supplierId) {
      const supplier = await prisma.supplier.findFirst({
        where: {
          id: supplierId,
          companyId: req.user.companyId,
          status: 'ACTIVE',
        },
      });
      if (!supplier)
        return res
          .status(404)
          .json({ success: false, message: 'Supplier not found' });

      finalSupplierName = supplier.name;
      finalSupplierAddress = supplier.address;
      finalSupplierGST = supplier.gstNumber;
      finalSupplierPAN = supplier.panNumber;
      finalSupplierContact = supplier.contactPerson;
      finalSupplierEmail = supplier.email;
      finalSupplierPhone = supplier.phone;
    } else if (!finalSupplierName) {
      return res
        .status(400)
        .json({ success: false, message: 'Supplier Name required' });
    }

    const year = new Date().getFullYear();
    const poCount = await prisma.purchaseOrder.count({
      where: {
        companyId: req.user.companyId,
        createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) },
      },
    });
    const poNumber = `PO-${year}-${String(poCount + 1).padStart(4, '0')}`;

    let calculatedSubtotal = 0;
    let calculatedTaxAmount = 0;

    if (items) {
      items.forEach((item) => {
        const itemTotal = item.quantity * item.unitPrice;
        calculatedSubtotal += itemTotal;
        calculatedTaxAmount += item.taxPercent
          ? (itemTotal * item.taxPercent) / 100
          : 0;
      });
    }

    let discountAmount = 0;
    if (discount) {
      discountAmount =
        discountType === 'PERCENTAGE'
          ? (calculatedSubtotal * discount) / 100
          : discount;
    }

    const finalSubtotal = calculatedSubtotal - discountAmount;
    const finalTotal =
      finalSubtotal +
      calculatedTaxAmount +
      (shippingCost || 0) +
      (otherCharges || 0);

    if (budgetId && budgetCategoryId) {
      const category = await prisma.budgetCategoryAllocation.findFirst({
        where: { id: budgetCategoryId, budgetId },
      });
      if (category && category.remainingAmount < finalTotal) {
        return res
          .status(400)
          .json({ success: false, message: `Insufficient budget` });
      }
    }

    // Wrap in Transaction with timeout
    const purchaseOrder = await prisma.$transaction(
      async (tx) => {
        const po = await tx.purchaseOrder.create({
          data: {
            poNumber,
            projectId,
            companyId: req.user.companyId,
            title,
            description,
            type: type || 'MATERIAL',
            status: 'DRAFT',
            supplierId: supplierId || null,
            supplierName: finalSupplierName,
            supplierAddress: finalSupplierAddress,
            supplierGST: finalSupplierGST,
            supplierPAN: finalSupplierPAN,
            supplierContact: finalSupplierContact,
            supplierEmail: finalSupplierEmail,
            supplierPhone: finalSupplierPhone,
            subtotal: finalSubtotal,
            taxAmount: calculatedTaxAmount,
            taxRate,
            discount,
            discountType,
            shippingCost,
            otherCharges,
            currency: currency || 'INR',
            totalAmount: finalTotal,
            paymentTerm: paymentTerm || 'NET_30',
            advancePercentage,
            advanceAmount: advancePercentage
              ? (finalTotal * advancePercentage) / 100
              : 0,
            expectedDelivery: safeDate(expectedDelivery),
            validUntil: safeDate(validUntil),
            deliveryAddress,
            deliveryInstructions,
            shippingMethod,
            shippingTerms,
            notes,
            terms,
            requestedById: req.user.userId,
            createdById: req.user.userId,
            budgetId,
          },
        });

        if (items && items.length > 0) {
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const itemTotal = item.quantity * item.unitPrice;
            const itemTax = item.taxPercent
              ? (itemTotal * item.taxPercent) / 100
              : 0;

            const newItem = await tx.purchaseOrderItem.create({
              data: {
                purchaseOrderId: po.id,
                lineNo: i + 1,
                description: item.description,
                materialId: item.materialId,
                specification: item.specification,
                make: item.make,
                model: item.model,
                size: item.size,
                color: item.color,
                quantity: item.quantity,
                unit: item.unit,
                unitPrice: item.unitPrice,
                discountPercent: item.discountPercent,
                discountAmount: item.discountAmount,
                taxPercent: item.taxPercent || 18,
                taxAmount: itemTax,
                totalPrice: itemTotal,
                pendingQuantity: item.quantity,
                expectedDelivery: safeDate(item.expectedDelivery),
                qualityStandard: item.qualityStandard,
                inspectionRequired: item.inspectionRequired || false,
                budgetCategoryId: item.budgetCategoryId || budgetCategoryId,
                notes: item.notes,
              },
            });

            if (item.materialRequestId) {
              await tx.materialRequest.update({
                where: { id: item.materialRequestId },
                data: {
                  purchaseOrderId: po.id,
                  purchaseOrderItemId: newItem.id,
                  poCreated: true,
                  poNumber: po.poNumber,
                },
              });
            }
          }
        }

        await tx.purchaseOrderHistory.create({
          data: {
            purchaseOrderId: po.id,
            action: 'CREATED',
            toStatus: 'DRAFT',
            performedById: req.user.userId,
          },
        });
        return po;
      },
      { maxWait: 5000, timeout: 15000 }
    );

    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'PO_CREATED',
        entityType: 'PURCHASE_ORDER',
        entityId: purchaseOrder.id,
        newData: { poNumber, title, totalAmount: finalTotal },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({ success: true, data: purchaseOrder });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAllPurchaseOrders = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status,
      type,
      projectId,
      supplierId,
      fromDate,
      toDate,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view purchase orders',
      });
    }

    const where = {
      companyId: req.user.companyId,
    };

    if (search) {
      where.OR = [
        { poNumber: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status) where.status = status;
    if (type) where.type = type;
    if (projectId) where.projectId = projectId;
    if (supplierId) where.supplierId = supplierId;
    if (fromDate || toDate) {
      where.orderDate = {};
      const from = safeDate(fromDate);
      const to = safeDate(toDate);
      if (from) where.orderDate.gte = from;
      if (to) where.orderDate.lte = to;
    }

    const [pos, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: {
          project: {
            select: {
              id: true,
              name: true,
              projectId: true,
            },
          },
          supplier: {
            select: {
              id: true,
              name: true,
              supplierCode: true,
            },
          },
          items: {
            select: {
              id: true,
              lineNo: true,
              description: true,
              quantity: true,
              unit: true,
              unitPrice: true,
              totalPrice: true,
              receivedQuantity: true,
              pendingQuantity: true,
            },
          },
          _count: {
            select: {
              items: true,
              receipts: true,
              payments: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    res.json({
      success: true,
      data: pos,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get purchase orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getPurchaseOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );
    if (!hasPermission)
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });

    const po = await prisma.purchaseOrder.findFirst({
      where: { id, companyId: req.user.companyId },
      include: {
        project: true,
        supplier: true,
        items: { include: { material: true, budgetCategory: true } },
        receipts: { include: { receivedBy: true } },
        payments: { include: { createdBy: true } },
        history: {
          include: { performedBy: true },
          orderBy: { performedAt: 'desc' },
        },
        budget: true,
      },
    });

    if (!po)
      return res.status(404).json({ success: false, message: 'PO not found' });
    res.json({ success: true, data: po });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updatePurchaseOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      expectedDelivery,
      actualDelivery,
      deliveryAddress,
      deliveryInstructions,
      notes,
      terms,
      shippingCost,
      otherCharges,
    } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update purchase orders',
      });
    }

    const existingPO = await prisma.purchaseOrder.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!existingPO) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found',
      });
    }

    if (
      existingPO.status !== 'DRAFT' &&
      existingPO.status !== 'PENDING_APPROVAL'
    ) {
      return res.status(400).json({
        success: false,
        message: `Cannot update PO with status: ${existingPO.status}`,
      });
    }

    const updatedPO = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        title,
        description,
        expectedDelivery: expectedDelivery
          ? safeDate(expectedDelivery)
          : undefined,
        deliveryAddress,
        deliveryInstructions,
        notes,
        terms,
        actualDelivery,
        shippingCost,
        otherCharges,
      },
    });

    // Create history
    await createPOHistory(
      id,
      req.user.userId,
      'UPDATED',
      existingPO.status,
      existingPO.status,
      { title, description },
      'PO details updated'
    );

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'PO_UPDATED',
        entityType: 'PURCHASE_ORDER',
        entityId: id,
        oldData: {
          title: existingPO.title,
          description: existingPO.description,
        },
        newData: { title, description },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Purchase order updated successfully',
      data: updatedPO,
    });
  } catch (error) {
    console.error('Update purchase order error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const deletePurchaseOrder = async (req, res) => {
  try {
    const { id } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_DELETE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete purchase orders',
      });
    }

    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
      include: {
        receipts: true,
        payments: true,
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found',
      });
    }

    if (po.status !== 'DRAFT') {
      return res.status(400).json({
        success: false,
        message: `Cannot delete PO with status: ${po.status}`,
      });
    }

    if (po.receipts.length > 0 || po.payments.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete PO with receipts or payments',
      });
    }

    await prisma.$transaction(async (tx) => {
      // Reverse budget commitment if exists
      if (po.budgetTransactionId) {
        const transaction = await tx.budgetTransaction.findUnique({
          where: { id: po.budgetTransactionId },
        });

        if (transaction) {
          await tx.budgetCategoryAllocation.update({
            where: { id: transaction.categoryId },
            data: {
              committedAmount: { decrement: transaction.amount },
              remainingAmount: { increment: transaction.amount },
            },
          });

          await tx.budgetTransaction.update({
            where: { id: po.budgetTransactionId },
            data: { status: 'CANCELLED' },
          });
        }
      }

      // Unlink material requests
      await tx.materialRequest.updateMany({
        where: { purchaseOrderId: id },
        data: {
          purchaseOrderId: null,
          purchaseOrderItemId: null,
          poCreated: false,
          poNumber: null,
        },
      });

      await tx.purchaseOrder.delete({
        where: { id },
      });
    });

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'PO_DELETED',
        entityType: 'PURCHASE_ORDER',
        entityId: id,
        oldData: { poNumber: po.poNumber, title: po.title },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Purchase order deleted successfully',
    });
  } catch (error) {
    console.error('Delete purchase order error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getProjectPurchaseOrders = async (req, res) => {
  try {
    const { projectId } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view purchase orders',
      });
    }

    const pos = await prisma.purchaseOrder.findMany({
      where: {
        projectId,
        companyId: req.user.companyId,
      },
      include: {
        items: true,
        supplier: {
          select: {
            id: true,
            name: true,
            supplierCode: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: pos,
    });
  } catch (error) {
    console.error('Get project purchase orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getSupplierPurchaseOrders = async (req, res) => {
  try {
    const { supplierId } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view purchase orders',
      });
    }

    const pos = await prisma.purchaseOrder.findMany({
      where: {
        supplierId,
        companyId: req.user.companyId,
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            projectId: true,
          },
        },
        items: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: pos,
    });
  } catch (error) {
    console.error('Get supplier purchase orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const submitPOForApproval = async (req, res) => {
  try {
    const { id } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to submit purchase orders',
      });
    }

    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        status: 'DRAFT',
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Draft purchase order not found',
      });
    }

    const updatedPO = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: 'PENDING_APPROVAL',
      },
    });

    // Create history
    await createPOHistory(
      id,
      req.user.userId,
      'SUBMITTED',
      'DRAFT',
      'PENDING_APPROVAL',
      null,
      'PO submitted for approval'
    );

    res.json({
      success: true,
      message: 'Purchase order submitted for approval',
      data: updatedPO,
    });
  } catch (error) {
    console.error('Submit PO for approval error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
export const approveRejectPO = async (req, res) => {
  try {
    const { id } = req.params;
    const { approved, action, approvalNotes, rejectionReason } = req.body;
    const isApproved =
      typeof approved === 'boolean' ? approved : action === 'approve';

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_APPROVE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to approve/reject purchase orders',
      });
    }

    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        status: 'PENDING_APPROVAL',
      },
      include: {
        items: true,
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Pending purchase order not found',
      });
    }

    if (isApproved) {
      const updatedPO = await prisma.$transaction(
        async (tx) => {
          const approved = await tx.purchaseOrder.update({
            where: { id },
            data: {
              status: 'APPROVED',
              approvedById: req.user.userId,
              approvedAt: new Date(),
              approvalNotes,
            },
          }); // Create budget commitment upon approval

          if (po.budgetId && !po.budgetTransactionId) {
            // Fallback: If item lacks a category, grab the first available one to prevent budget skips
            let categoryId = po.items.find(
              (i) => i.budgetCategoryId
            )?.budgetCategoryId;

            if (!categoryId) {
              const defaultCat = await tx.budgetCategoryAllocation.findFirst({
                where: { budgetId: po.budgetId },
              });
              if (defaultCat) categoryId = defaultCat.id;
            }

            if (categoryId) {
              const transaction = await tx.budgetTransaction.create({
                data: {
                  transactionNo: `CMT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                  budgetId: po.budgetId,
                  categoryId: categoryId,
                  transactionType: 'COMMITMENT',
                  status: 'COMMITTED',
                  description: `Budget commitment for PO: ${po.poNumber}`,
                  amount: po.totalAmount,
                  committedAmount: po.totalAmount,
                  totalAmount: po.totalAmount,
                  referenceType: 'PURCHASE_ORDER',
                  referenceId: po.id,
                  referenceNo: po.poNumber,
                  transactionDate: new Date(),
                  committedDate: new Date(),
                  createdById: req.user.userId,
                },
              });

              await tx.budgetCategoryAllocation.update({
                where: { id: categoryId },
                data: {
                  committedAmount: { increment: po.totalAmount },
                  remainingAmount: { decrement: po.totalAmount },
                },
              });

              await tx.purchaseOrder.update({
                where: { id: po.id },
                data: { budgetTransactionId: transaction.id },
              });
            }
          } // Cascade Approval to linked Material Requests

          await tx.materialRequest.updateMany({
            where: { purchaseOrderId: id },
            data: {
              status: 'APPROVED',
              approvedById: req.user.userId,
              approvedAt: new Date(),
            },
          }); // Create history

          await tx.purchaseOrderHistory.create({
            data: {
              purchaseOrderId: id,
              action: 'APPROVED',
              fromStatus: 'PENDING_APPROVAL',
              toStatus: 'APPROVED',
              performedById: req.user.userId,
              notes: approvalNotes,
            },
          });

          return approved;
        },
        { maxWait: 5000, timeout: 15000 }
      );

      res.json({
        success: true,
        message: 'Purchase order approved',
        data: updatedPO,
      });
    } else {
      const updatedPO = await prisma.$transaction(
        async (tx) => {
          if (po.budgetTransactionId) {
            const transaction = await tx.budgetTransaction.findUnique({
              where: { id: po.budgetTransactionId },
            });
            if (transaction && transaction.status === 'COMMITTED') {
              // Release only the remaining commitment
              const remainingCommitment = transaction.committedAmount || 0;
              if (remainingCommitment > 0) {
                await tx.budgetCategoryAllocation.update({
                  where: { id: transaction.categoryId },
                  data: {
                    committedAmount: { decrement: remainingCommitment },
                    remainingAmount: { increment: remainingCommitment },
                  },
                });
              }
              await tx.budgetTransaction.update({
                where: { id: po.budgetTransactionId },
                data: { status: 'CANCELLED', committedAmount: 0 },
              });
            }
          }

          const rejected = await tx.purchaseOrder.update({
            where: { id },
            data: {
              status: 'REJECTED',
              rejectionReason,
            },
          }); // Cascade Rejection to linked Material Requests

          await tx.materialRequest.updateMany({
            where: { purchaseOrderId: id },
            data: {
              status: 'REJECTED',
              rejectionReason: rejectionReason || 'PO was rejected',
            },
          }); // Create history

          await tx.purchaseOrderHistory.create({
            data: {
              purchaseOrderId: id,
              action: 'REJECTED',
              fromStatus: 'PENDING_APPROVAL',
              toStatus: 'REJECTED',
              performedById: req.user.userId,
              notes: rejectionReason,
            },
          });

          return rejected;
        },
        { maxWait: 5000, timeout: 15000 }
      );

      res.json({
        success: true,
        message: 'Purchase order rejected',
        data: updatedPO,
      });
    }
  } catch (error) {
    console.error('Approve/reject PO error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const approvePO = async (req, res) => {
  try {
    const { id } = req.params;
    const { approvalNotes } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_APPROVE'
    );
    if (!hasPermission)
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });

    const po = await prisma.purchaseOrder.findFirst({
      where: { id, companyId: req.user.companyId, status: 'PENDING_APPROVAL' },
      include: { items: true },
    });

    if (!po)
      return res
        .status(404)
        .json({ success: false, message: 'Pending PO not found' });

    const updatedPO = await prisma.$transaction(
      async (tx) => {
        const approved = await tx.purchaseOrder.update({
          where: { id },
          data: {
            status: 'APPROVED',
            approvedById: req.user.userId,
            approvedAt: new Date(),
            approvalNotes,
          },
        });

        // Budget Commitment Creation
        if (po.budgetId && !po.budgetTransactionId) {
          // Fallback: If item lacks a category, grab the first available one to prevent budget skips
          let categoryId = po.items.find(
            (i) => i.budgetCategoryId
          )?.budgetCategoryId;

          if (!categoryId) {
            const defaultCat = await tx.budgetCategoryAllocation.findFirst({
              where: { budgetId: po.budgetId },
            });
            if (defaultCat) categoryId = defaultCat.id;
          }

          if (categoryId) {
            const transaction = await tx.budgetTransaction.create({
              data: {
                transactionNo: `CMT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                budgetId: po.budgetId,
                categoryId: categoryId,
                transactionType: 'COMMITMENT',
                status: 'COMMITTED',
                description: `Budget commitment for PO: ${po.poNumber}`,
                amount: po.totalAmount,
                committedAmount: po.totalAmount, // Ensure this defaults correctly
                totalAmount: po.totalAmount,
                referenceType: 'PURCHASE_ORDER',
                referenceId: po.id,
                referenceNo: po.poNumber,
                transactionDate: new Date(),
                committedDate: new Date(),
                createdById: req.user.userId,
              },
            });

            await tx.budgetCategoryAllocation.update({
              where: { id: categoryId },
              data: {
                committedAmount: { increment: po.totalAmount },
                remainingAmount: { decrement: po.totalAmount },
              },
            });

            await tx.purchaseOrder.update({
              where: { id: po.id },
              data: { budgetTransactionId: transaction.id },
            });
          }
        }

        await tx.materialRequest.updateMany({
          where: { purchaseOrderId: id },
          data: {
            status: 'APPROVED',
            approvedById: req.user.userId,
            approvedAt: new Date(),
          },
        });

        await tx.purchaseOrderHistory.create({
          data: {
            purchaseOrderId: id,
            action: 'APPROVED',
            fromStatus: 'PENDING_APPROVAL',
            toStatus: 'APPROVED',
            performedById: req.user.userId,
            notes: approvalNotes,
          },
        });

        return approved;
      },
      { maxWait: 5000, timeout: 15000 }
    );

    res.json({
      success: true,
      message: 'Purchase order approved',
      data: updatedPO,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const rejectPO = async (req, res) => {
  // Logic updated to restore budget variance safely
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;
    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_APPROVE'
    );
    if (!hasPermission)
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });

    const po = await prisma.purchaseOrder.findFirst({
      where: { id, companyId: req.user.companyId, status: 'PENDING_APPROVAL' },
    });
    if (!po)
      return res
        .status(404)
        .json({ success: false, message: 'Pending PO not found' });

    const updatedPO = await prisma.$transaction(async (tx) => {
      if (po.budgetTransactionId) {
        const transaction = await tx.budgetTransaction.findUnique({
          where: { id: po.budgetTransactionId },
        });
        if (transaction && transaction.status === 'COMMITTED') {
          // Release only the remaining commitment
          const remainingCommitment = transaction.committedAmount || 0;
          if (remainingCommitment > 0) {
            await tx.budgetCategoryAllocation.update({
              where: { id: transaction.categoryId },
              data: {
                committedAmount: { decrement: remainingCommitment },
                remainingAmount: { increment: remainingCommitment },
              },
            });
          }
          await tx.budgetTransaction.update({
            where: { id: po.budgetTransactionId },
            data: { status: 'CANCELLED', committedAmount: 0 },
          });
        }
      }

      const rejected = await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'REJECTED', rejectionReason },
      });

      await tx.materialRequest.updateMany({
        where: { purchaseOrderId: id },
        data: {
          status: 'REJECTED',
          rejectionReason: rejectionReason || 'PO was rejected',
        },
      });

      await tx.purchaseOrderHistory.create({
        data: {
          purchaseOrderId: id,
          action: 'REJECTED',
          fromStatus: 'PENDING_APPROVAL',
          toStatus: 'REJECTED',
          performedById: req.user.userId,
          notes: rejectionReason,
        },
      });

      return rejected;
    });

    res.json({ success: true, data: updatedPO });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const markAsOrdered = async (req, res) => {
  try {
    const { id } = req.params;
    const { orderDate, notes } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update purchase orders',
      });
    }

    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        status: 'APPROVED',
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Approved purchase order not found',
      });
    }

    const updatedPO = await prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: 'ORDERED',
          orderedById: req.user.userId,
          orderedAt: orderDate ? safeDate(orderDate) || new Date() : new Date(),
        },
      });

      // Cascade Ordered status to linked Material Requests
      await tx.materialRequest.updateMany({
        where: { purchaseOrderId: id },
        data: {
          status: 'ORDERED',
          orderedById: req.user.userId,
          orderedAt: orderDate ? safeDate(orderDate) || new Date() : new Date(),
        },
      });

      // Create history
      await tx.purchaseOrderHistory.create({
        data: {
          purchaseOrderId: id,
          action: 'ORDERED',
          fromStatus: 'APPROVED',
          toStatus: 'ORDERED',
          performedById: req.user.userId,
          notes: notes || 'PO marked as ordered',
        },
      });

      return updated;
    });

    res.json({
      success: true,
      message: 'Purchase order marked as ordered',
      data: updatedPO,
    });
  } catch (error) {
    console.error('Mark as ordered error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const markAsReceived = async (req, res) => {
  try {
    const { id } = req.params;
    const { actualDelivery, notes } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update purchase orders',
      });
    }

    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] },
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found or cannot be received',
      });
    }

    const updatedPO = await prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: 'RECEIVED',
          actualDelivery: actualDelivery
            ? safeDate(actualDelivery) || new Date()
            : new Date(),
        },
      });

      // Cascade Delivered status to ALL linked Material Requests since full PO is received
      await tx.materialRequest.updateMany({
        where: { purchaseOrderId: id },
        data: {
          status: 'DELIVERED',
          actualDelivery: actualDelivery
            ? safeDate(actualDelivery) || new Date()
            : new Date(),
        },
      });

      // Create history
      await tx.purchaseOrderHistory.create({
        data: {
          purchaseOrderId: id,
          action: 'RECEIVED',
          fromStatus: po.status,
          toStatus: 'RECEIVED',
          performedById: req.user.userId,
          notes: notes || 'PO marked as received',
        },
      });

      return updated;
    });

    res.json({
      success: true,
      message: 'Purchase order marked as received',
      data: updatedPO,
    });
  } catch (error) {
    console.error('Mark as received error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const cancelPO = async (req, res) => {
  try {
    const { id } = req.params;
    const { cancellationReason } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );
    if (!hasPermission)
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });

    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        status: { notIn: ['CANCELLED', 'CLOSED', 'RECEIVED'] },
      },
    });
    if (!po)
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found or cannot be cancelled',
      });

    const updatedPO = await prisma.$transaction(
      async (tx) => {
        // Restore remaining budget correctly (Fix for bug)
        if (po.budgetTransactionId) {
          const transaction = await tx.budgetTransaction.findUnique({
            where: { id: po.budgetTransactionId },
          });
          if (transaction && transaction.status !== 'CANCELLED') {
            const remainingCommitment = transaction.committedAmount || 0;
            if (remainingCommitment > 0) {
              await tx.budgetCategoryAllocation.update({
                where: { id: transaction.categoryId },
                data: {
                  committedAmount: { decrement: remainingCommitment },
                  remainingAmount: { increment: remainingCommitment },
                },
              });
            }
            await tx.budgetTransaction.update({
              where: { id: po.budgetTransactionId },
              data: { status: 'CANCELLED', committedAmount: 0 },
            });
          }
        }

        const cancelled = await tx.purchaseOrder.update({
          where: { id },
          data: {
            status: 'CANCELLED',
            cancelledById: req.user.userId,
            cancelledAt: new Date(),
            cancellationReason,
          },
        });

        await tx.materialRequest.updateMany({
          where: { purchaseOrderId: id },
          data: {
            status: 'APPROVED',
            purchaseOrderId: null,
            purchaseOrderItemId: null,
            poCreated: false,
            poNumber: null,
          },
        });

        await tx.purchaseOrderHistory.create({
          data: {
            purchaseOrderId: id,
            action: 'CANCELLED',
            fromStatus: po.status,
            toStatus: 'CANCELLED',
            performedById: req.user.userId,
            notes: cancellationReason,
          },
        });

        return cancelled;
      },
      { maxWait: 5000, timeout: 15000 }
    );

    res.json({ success: true, message: 'PO cancelled', data: updatedPO });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const closePO = async (req, res) => {
  try {
    const { id } = req.params;
    const { closureNotes } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to close purchase orders',
      });
    }

    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        status: { in: ['RECEIVED', 'PAID'] },
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found or cannot be closed',
      });
    }

    // Check if all items are closed
    const openItems = await prisma.purchaseOrderItem.count({
      where: {
        purchaseOrderId: id,
        isClosed: false,
      },
    });

    if (openItems > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot close PO with open items',
      });
    }

    const updatedPO = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        isClosed: true,
        status: 'CLOSED',
        closedAt: new Date(),
        closedById: req.user.userId,
        closureNotes,
      },
    });

    // Create history
    await createPOHistory(
      id,
      req.user.userId,
      'CLOSED',
      po.status,
      'CLOSED',
      null,
      closureNotes
    );

    res.json({
      success: true,
      message: 'Purchase order closed',
      data: updatedPO,
    });
  } catch (error) {
    console.error('Close PO error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// ==================== PURCHASE ORDER ITEMS ====================

export const getPOItems = async (req, res) => {
  try {
    const { poId } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view PO items',
      });
    }

    const items = await prisma.purchaseOrderItem.findMany({
      where: {
        purchaseOrderId: poId,
        purchaseOrder: {
          companyId: req.user.companyId,
        },
      },
      include: {
        material: {
          select: {
            id: true,
            name: true,
            materialCode: true,
            unit: true,
          },
        },
        budgetCategory: {
          select: {
            category: true,
            subCategory: true,
          },
        },
        receipts: {
          include: {
            goodsReceipt: {
              select: {
                id: true,
                grNumber: true,
                receiptDate: true,
              },
            },
          },
        },
        materialRequests: {
          select: {
            id: true,
            requestNo: true,
          },
        },
      },
      orderBy: { lineNo: 'asc' },
    });

    res.json({
      success: true,
      data: items,
    });
  } catch (error) {
    console.error('Get PO items error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getPOItemById = async (req, res) => {
  try {
    const { itemId } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view PO items',
      });
    }

    const item = await prisma.purchaseOrderItem.findFirst({
      where: {
        id: itemId,
        purchaseOrder: {
          companyId: req.user.companyId,
        },
      },
      include: {
        purchaseOrder: {
          select: {
            id: true,
            poNumber: true,
            projectId: true,
          },
        },
        material: {
          select: {
            id: true,
            name: true,
            materialCode: true,
            unit: true,
            stockQuantity: true,
          },
        },
        budgetCategory: {
          select: {
            category: true,
            allocatedAmount: true,
            remainingAmount: true,
          },
        },
        receipts: {
          include: {
            goodsReceipt: {
              select: {
                id: true,
                grNumber: true,
                receiptDate: true,
                receivedBy: {
                  select: { name: true },
                },
              },
            },
          },
        },
        materialRequests: {
          select: {
            id: true,
            requestNo: true,
            materialName: true,
          },
        },
      },
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'PO item not found',
      });
    }

    res.json({
      success: true,
      data: item,
    });
  } catch (error) {
    console.error('Get PO item error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const addPOItem = async (req, res) => {
  try {
    const { poId } = req.params;
    const {
      description,
      materialId,
      materialRequestId,
      specification,
      make,
      model,
      size,
      color,
      quantity,
      unit,
      unitPrice,
      discountPercent,
      taxPercent,
      expectedDelivery,
      qualityStandard,
      inspectionRequired,
      budgetCategoryId,
      notes,
    } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to modify PO items',
      });
    }

    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id: poId,
        companyId: req.user.companyId,
        status: { in: ['DRAFT', 'PENDING_APPROVAL'] },
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found or cannot be modified',
      });
    }

    // Get next line number
    const lastItem = await prisma.purchaseOrderItem.findFirst({
      where: { purchaseOrderId: poId },
      orderBy: { lineNo: 'desc' },
    });
    const lineNo = lastItem ? lastItem.lineNo + 1 : 1;

    const itemTotal = quantity * unitPrice;
    const itemTax = taxPercent ? (itemTotal * taxPercent) / 100 : 0;

    const item = await prisma.$transaction(async (tx) => {
      const newItem = await tx.purchaseOrderItem.create({
        data: {
          purchaseOrderId: poId,
          lineNo,
          description,
          materialId,
          specification,
          make,
          model,
          size,
          color,
          quantity,
          unit,
          unitPrice,
          discountPercent,
          taxPercent: taxPercent || 18,
          taxAmount: itemTax,
          totalPrice: itemTotal,
          pendingQuantity: quantity,
          expectedDelivery: expectedDelivery
            ? safeDate(expectedDelivery)
            : null,
          qualityStandard,
          inspectionRequired: inspectionRequired || false,
          budgetCategoryId,
          notes,
        },
      });

      if (materialRequestId) {
        await tx.materialRequest.update({
          where: { id: materialRequestId },
          data: {
            purchaseOrderId: po.id,
            purchaseOrderItemId: newItem.id,
            poCreated: true,
            poNumber: po.poNumber,
          },
        });
      }

      // Update PO totals
      await calculatePOTotals(poId);

      return newItem;
    });

    // Create history
    await createPOHistory(
      poId,
      req.user.userId,
      'UPDATED',
      po.status,
      po.status,
      { action: 'ITEM_ADDED', item: description },
      `Added item: ${description}`
    );

    res.status(201).json({
      success: true,
      message: 'Item added to purchase order',
      data: item,
    });
  } catch (error) {
    console.error('Add PO item error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const updatePOItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const {
      description,
      specification,
      make,
      model,
      size,
      color,
      quantity,
      unit,
      unitPrice,
      discountPercent,
      taxPercent,
      expectedDelivery,
      qualityStandard,
      inspectionRequired,
      notes,
    } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to modify PO items',
      });
    }

    const item = await prisma.purchaseOrderItem.findFirst({
      where: {
        id: itemId,
        purchaseOrder: {
          companyId: req.user.companyId,
          status: { in: ['DRAFT', 'PENDING_APPROVAL'] },
        },
      },
      include: {
        purchaseOrder: true,
      },
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'PO item not found or cannot be modified',
      });
    }

    if (item.receivedQuantity > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot modify item with received quantity',
      });
    }

    const itemTotal = quantity * unitPrice;
    const itemTax = taxPercent ? (itemTotal * taxPercent) / 100 : 0;

    const updatedItem = await prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseOrderItem.update({
        where: { id: itemId },
        data: {
          description,
          specification,
          make,
          model,
          size,
          color,
          quantity,
          unit,
          unitPrice,
          discountPercent,
          taxPercent: taxPercent || 18,
          taxAmount: itemTax,
          totalPrice: itemTotal,
          pendingQuantity: quantity - item.receivedQuantity,
          expectedDelivery: expectedDelivery
            ? safeDate(expectedDelivery)
            : null,
          qualityStandard,
          inspectionRequired,
          notes,
        },
      });

      // Update PO totals
      await calculatePOTotals(item.purchaseOrderId);

      return updated;
    });

    // Create history
    await createPOHistory(
      item.purchaseOrderId,
      req.user.userId,
      'UPDATED',
      item.purchaseOrder.status,
      item.purchaseOrder.status,
      { action: 'ITEM_UPDATED', itemId },
      `Updated item: ${description}`
    );

    res.json({
      success: true,
      message: 'PO item updated',
      data: updatedItem,
    });
  } catch (error) {
    console.error('Update PO item error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const removePOItem = async (req, res) => {
  try {
    const { itemId } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to remove PO items',
      });
    }

    const item = await prisma.purchaseOrderItem.findFirst({
      where: {
        id: itemId,
        purchaseOrder: {
          companyId: req.user.companyId,
          status: { in: ['DRAFT', 'PENDING_APPROVAL'] },
        },
      },
      include: {
        purchaseOrder: true,
      },
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'PO item not found or cannot be removed',
      });
    }

    if (item.receivedQuantity > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove item with received quantity',
      });
    }

    const description = item.description;

    await prisma.$transaction(async (tx) => {
      // Unlink material requests if any exist
      await tx.materialRequest.updateMany({
        where: { purchaseOrderItemId: itemId },
        data: {
          purchaseOrderId: null,
          purchaseOrderItemId: null,
          poCreated: false,
          poNumber: null,
        },
      });

      await tx.purchaseOrderItem.delete({
        where: { id: itemId },
      });

      // Update PO totals
      await calculatePOTotals(item.purchaseOrderId);
    });

    // Create history
    await createPOHistory(
      item.purchaseOrderId,
      req.user.userId,
      'UPDATED',
      item.purchaseOrder.status,
      item.purchaseOrder.status,
      { action: 'ITEM_REMOVED', itemId },
      `Removed item: ${description}`
    );

    res.json({
      success: true,
      message: 'PO item removed',
    });
  } catch (error) {
    console.error('Remove PO item error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const updateReceivedQuantity = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { receivedQuantity, notes } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update received quantity',
      });
    }

    const item = await prisma.purchaseOrderItem.findFirst({
      where: {
        id: itemId,
        purchaseOrder: {
          companyId: req.user.companyId,
          status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] },
        },
      },
      include: {
        purchaseOrder: true,
      },
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'PO item not found or cannot be received',
      });
    }

    if (receivedQuantity > item.pendingQuantity) {
      return res.status(400).json({
        success: false,
        message: `Cannot receive more than pending quantity: ${item.pendingQuantity}`,
      });
    }

    const newReceivedQuantity = item.receivedQuantity + receivedQuantity;
    const newPendingQuantity = item.quantity - newReceivedQuantity;
    const isClosed = newPendingQuantity === 0;

    const updatedItem = await prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseOrderItem.update({
        where: { id: itemId },
        data: {
          receivedQuantity: newReceivedQuantity,
          pendingQuantity: newPendingQuantity,
          isClosed,
        },
      });

      // Update corresponding Material Request if item is completely received
      if (isClosed) {
        await tx.materialRequest.updateMany({
          where: { purchaseOrderItemId: itemId },
          data: {
            status: 'DELIVERED',
            actualDelivery: new Date(),
          },
        });
      }

      // Update PO totals and status
      const totals = await calculatePOTotals(item.purchaseOrderId);

      let poStatus = item.purchaseOrder.status;
      if (totals.totalReceived === totals.totalQuantity) {
        poStatus = 'RECEIVED';
      } else if (totals.totalReceived > 0) {
        poStatus = 'PARTIALLY_RECEIVED';
      }

      if (poStatus !== item.purchaseOrder.status) {
        await tx.purchaseOrder.update({
          where: { id: item.purchaseOrderId },
          data: { status: poStatus },
        });

        // Cascade Delivered to ALL MRs if full PO is received
        if (poStatus === 'RECEIVED') {
          await tx.materialRequest.updateMany({
            where: { purchaseOrderId: item.purchaseOrderId },
            data: {
              status: 'DELIVERED',
              actualDelivery: new Date(),
            },
          });
        }
      }

      return { updated, poStatus };
    });

    // Create history
    await createPOHistory(
      item.purchaseOrderId,
      req.user.userId,
      'UPDATED',
      item.purchaseOrder.status,
      updatedItem.poStatus,
      { action: 'RECEIVED_QUANTITY_UPDATED', itemId, receivedQuantity },
      notes ||
        `Received ${receivedQuantity} ${item.unit} of ${item.description}`
    );

    res.json({
      success: true,
      message: 'Received quantity updated',
      data: updatedItem.updated,
    });
  } catch (error) {
    console.error('Update received quantity error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const closePOItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { notes } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to close PO items',
      });
    }

    const item = await prisma.purchaseOrderItem.findFirst({
      where: {
        id: itemId,
        purchaseOrder: {
          companyId: req.user.companyId,
        },
        isClosed: false,
      },
      include: {
        purchaseOrder: true,
      },
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'PO item not found or already closed',
      });
    }

    if (item.pendingQuantity > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot close item with pending quantity',
      });
    }

    const updatedItem = await prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseOrderItem.update({
        where: { id: itemId },
        data: { isClosed: true },
      });

      // Update corresponding Material Request since item is forcefully closed
      await tx.materialRequest.updateMany({
        where: { purchaseOrderItemId: itemId },
        data: {
          status: 'DELIVERED',
          actualDelivery: new Date(),
        },
      });

      return updated;
    });

    // Create history
    await createPOHistory(
      item.purchaseOrderId,
      req.user.userId,
      'UPDATED',
      item.purchaseOrder.status,
      item.purchaseOrder.status,
      { action: 'ITEM_CLOSED', itemId },
      notes || `Closed item: ${item.description}`
    );

    res.json({
      success: true,
      message: 'PO item closed',
      data: updatedItem,
    });
  } catch (error) {
    console.error('Close PO item error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// ==================== GOODS RECEIPT ====================

export const createGoodsReceipt = async (req, res) => {
  try {
    const {
      purchaseOrderId,
      receiptDate,
      deliveryChallanNo,
      vehicleNo,
      transporter,
      receivedAt,
      receivedFrom,
      notes,
      items,
    } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create goods receipts',
      });
    }

    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id: purchaseOrderId,
        companyId: req.user.companyId,
        status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] },
      },
      include: {
        items: true,
        project: true,
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found or cannot receive goods',
      });
    }

    // Generate GR number
    const year = new Date().getFullYear();
    const grCount = await prisma.goodsReceipt.count({
      where: {
        purchaseOrder: {
          companyId: req.user.companyId,
        },
        createdAt: {
          gte: new Date(year, 0, 1),
          lt: new Date(year + 1, 0, 1),
        },
      },
    });
    const grNumber = `GR-${year}-${String(grCount + 1).padStart(4, '0')}`;

    // Create goods receipt in transaction
    const result = await prisma.$transaction(
      async (tx) => {
        // Create GR
        const goodsReceipt = await tx.goodsReceipt.create({
          data: {
            grNumber,
            purchaseOrderId,
            projectId: po.projectId,
            receiptDate: receiptDate
              ? safeDate(receiptDate) || new Date()
              : new Date(),
            receivedById: req.user.userId,
            deliveryChallanNo,
            vehicleNo,
            transporter,
            receivedAt,
            receivedFrom,
            notes,
            createdById: req.user.userId,
          },
        });

        // Create GR items
        for (const item of items) {
          const poItem = po.items.find((i) => i.id === item.poItemId);
          if (!poItem) {
            throw new Error(`PO item not found: ${item.poItemId}`);
          }

          if (item.receivedQuantity > poItem.pendingQuantity) {
            throw new Error(
              `Cannot receive more than pending quantity for item: ${poItem.description}`
            );
          }

          await tx.goodsReceiptItem.create({
            data: {
              goodsReceiptId: goodsReceipt.id,
              poItemId: item.poItemId,
              receivedQuantity: item.receivedQuantity,
              acceptedQuantity: item.acceptedQuantity || item.receivedQuantity,
              rejectedQuantity: item.rejectedQuantity || 0,
              unit: poItem.unit,
              condition: item.condition,
              qualityRating: item.qualityRating,
              inspectionStatus: item.inspectionStatus || 'PENDING',
              inspectionNotes: item.inspectionNotes,
              batchNo: item.batchNo,
              serialNo: item.serialNo,
              manufacturingDate: item.manufacturingDate
                ? safeDate(item.manufacturingDate)
                : null,
              expiryDate: item.expiryDate ? safeDate(item.expiryDate) : null,
              storedLocation: item.storedLocation,
              binLocation: item.binLocation,
              notes: item.notes,
            },
          });

          // Update PO item
          const newReceivedQuantity =
            poItem.receivedQuantity + item.receivedQuantity;
          const newPendingQuantity = poItem.quantity - newReceivedQuantity;
          const isClosed = newPendingQuantity === 0;

          await tx.purchaseOrderItem.update({
            where: { id: item.poItemId },
            data: {
              receivedQuantity: newReceivedQuantity,
              pendingQuantity: newPendingQuantity,
              acceptedQuantity:
                poItem.acceptedQuantity +
                (item.acceptedQuantity || item.receivedQuantity),
              rejectedQuantity:
                poItem.rejectedQuantity + (item.rejectedQuantity || 0),
              isClosed,
            },
          });

          // Update MR status if this item is completely received
          if (isClosed) {
            await tx.materialRequest.updateMany({
              where: { purchaseOrderItemId: item.poItemId },
              data: {
                status: 'DELIVERED',
                actualDelivery: new Date(),
              },
            });
          }
        }

        // Update PO totals and status
        const totals = await calculatePOTotals(purchaseOrderId);

        let poStatus = po.status;
        if (totals.totalReceived === totals.totalQuantity) {
          poStatus = 'RECEIVED';
        } else if (totals.totalReceived > 0) {
          poStatus = 'PARTIALLY_RECEIVED';
        }

        await tx.purchaseOrder.update({
          where: { id: purchaseOrderId },
          data: { status: poStatus },
        });

        // Update ALL MRs if full PO is received
        if (poStatus === 'RECEIVED') {
          await tx.materialRequest.updateMany({
            where: { purchaseOrderId: purchaseOrderId },
            data: {
              status: 'DELIVERED',
              actualDelivery: new Date(),
            },
          });
        }

        // Create history
        await tx.purchaseOrderHistory.create({
          data: {
            purchaseOrderId,
            action: 'RECEIVED',
            fromStatus: po.status,
            toStatus: poStatus,
            performedById: req.user.userId,
            notes: `Goods receipt created: ${grNumber}`,
          },
        });

        return goodsReceipt;
      },
      { maxWait: 10000, timeout: 30000 }
    );

    res.status(201).json({
      success: true,
      message: 'Goods receipt created successfully',
      data: result,
    });
  } catch (error) {
    console.error('Create goods receipt error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
};

export const getGoodsReceiptById = async (req, res) => {
  try {
    const { receiptId } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view goods receipts',
      });
    }

    const receipt = await prisma.goodsReceipt.findFirst({
      where: {
        id: receiptId,
        purchaseOrder: {
          companyId: req.user.companyId,
        },
      },
      include: {
        purchaseOrder: {
          select: {
            id: true,
            poNumber: true,
            title: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
            projectId: true,
          },
        },
        receivedBy: {
          select: { id: true, name: true },
        },
        inspectedBy: {
          select: { id: true, name: true },
        },
        items: {
          include: {
            poItem: {
              include: {
                material: {
                  select: {
                    id: true,
                    name: true,
                    materialCode: true,
                  },
                },
              },
            },
            inspectedBy: {
              select: { id: true, name: true },
            },
            stockTransaction: true,
          },
        },
        documents: {
          include: {
            uploadedBy: {
              select: { id: true, name: true },
            },
          },
        },
        createdBy: {
          select: { id: true, name: true },
        },
      },
    });

    if (!receipt) {
      return res.status(404).json({
        success: false,
        message: 'Goods receipt not found',
      });
    }

    res.json({
      success: true,
      data: receipt,
    });
  } catch (error) {
    console.error('Get goods receipt error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getPOGoodsReceipts = async (req, res) => {
  try {
    const { poId } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view goods receipts',
      });
    }

    const receipts = await prisma.goodsReceipt.findMany({
      where: {
        purchaseOrderId: poId,
        purchaseOrder: {
          companyId: req.user.companyId,
        },
      },
      include: {
        receivedBy: {
          select: { id: true, name: true },
        },
        items: {
          include: {
            poItem: {
              select: {
                id: true,
                description: true,
                unit: true,
              },
            },
          },
        },
      },
      orderBy: { receiptDate: 'desc' },
    });

    res.json({
      success: true,
      data: receipts,
    });
  } catch (error) {
    console.error('Get PO goods receipts error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const quickReceivePO = async (req, res) => {
  try {
    const { poId } = req.params;
    const { receiptDate, deliveryChallanNo, notes } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to receive goods',
      });
    }

    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id: poId,
        companyId: req.user.companyId,
        status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] },
      },
      include: {
        items: {
          where: {
            pendingQuantity: { gt: 0 },
          },
        },
        project: true,
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found or cannot receive goods',
      });
    }

    if (po.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No pending items to receive',
      });
    }

    // Generate GR number
    const year = new Date().getFullYear();
    const grCount = await prisma.goodsReceipt.count({
      where: {
        purchaseOrder: {
          companyId: req.user.companyId,
        },
        createdAt: {
          gte: new Date(year, 0, 1),
          lt: new Date(year + 1, 0, 1),
        },
      },
    });
    const grNumber = `GR-${year}-${String(grCount + 1).padStart(4, '0')}`;

    // Create items for all pending items
    const items = po.items.map((item) => ({
      poItemId: item.id,
      receivedQuantity: item.pendingQuantity,
      acceptedQuantity: item.pendingQuantity,
      rejectedQuantity: 0,
      condition: 'Good',
      qualityRating: 'GOOD',
    }));

    // Create goods receipt
    const result = await prisma.$transaction(async (tx) => {
      // Create GR
      const goodsReceipt = await tx.goodsReceipt.create({
        data: {
          grNumber,
          purchaseOrderId: poId,
          projectId: po.projectId,
          receiptDate: receiptDate
            ? safeDate(receiptDate) || new Date()
            : new Date(),
          receivedById: req.user.userId,
          deliveryChallanNo,
          notes: notes || 'Quick receive all pending items',
          createdById: req.user.userId,
        },
      });

      // Create GR items and update PO items
      for (const item of items) {
        const poItem = po.items.find((i) => i.id === item.poItemId);

        await tx.goodsReceiptItem.create({
          data: {
            goodsReceiptId: goodsReceipt.id,
            poItemId: item.poItemId,
            receivedQuantity: item.receivedQuantity,
            acceptedQuantity: item.acceptedQuantity,
            unit: poItem.unit,
            condition: item.condition,
            qualityRating: item.qualityRating,
            inspectionStatus: 'PENDING',
          },
        });

        const newReceivedQuantity =
          poItem.receivedQuantity + item.receivedQuantity;
        const newPendingQuantity = poItem.quantity - newReceivedQuantity;
        const isClosed = newPendingQuantity === 0;

        await tx.purchaseOrderItem.update({
          where: { id: item.poItemId },
          data: {
            receivedQuantity: newReceivedQuantity,
            pendingQuantity: newPendingQuantity,
            acceptedQuantity: poItem.acceptedQuantity + item.acceptedQuantity,
            isClosed,
          },
        });

        if (isClosed) {
          await tx.materialRequest.updateMany({
            where: { purchaseOrderItemId: item.poItemId },
            data: {
              status: 'DELIVERED',
              actualDelivery: new Date(),
            },
          });
        }
      }

      // Update PO status
      const totals = await calculatePOTotals(poId);
      await tx.purchaseOrder.update({
        where: { id: poId },
        data: { status: 'RECEIVED' },
      });

      // Update MRs cascade
      await tx.materialRequest.updateMany({
        where: { purchaseOrderId: poId },
        data: {
          status: 'DELIVERED',
          actualDelivery: new Date(),
        },
      });

      // Create history
      await tx.purchaseOrderHistory.create({
        data: {
          purchaseOrderId: poId,
          action: 'RECEIVED',
          fromStatus: po.status,
          toStatus: 'RECEIVED',
          performedById: req.user.userId,
          notes: `Quick receive completed: ${grNumber}`,
        },
      });

      return goodsReceipt;
    });

    res.json({
      success: true,
      message: 'Quick receive completed successfully',
      data: result,
    });
  } catch (error) {
    console.error('Quick receive PO error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const acceptAllItems = async (req, res) => {
  try {
    const { receiptId } = req.params;
    const { qualityRating, notes } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update goods receipts',
      });
    }

    const receipt = await prisma.goodsReceipt.findFirst({
      where: {
        id: receiptId,
        purchaseOrder: {
          companyId: req.user.companyId,
        },
        inspectionStatus: 'PENDING',
      },
      include: {
        items: true,
        purchaseOrder: true,
      },
    });

    if (!receipt) {
      return res.status(404).json({
        success: false,
        message: 'Goods receipt not found or already inspected',
      });
    }

    const updatedReceipt = await prisma.$transaction(
      async (tx) => {
        // Update all items
        for (const item of receipt.items) {
          await tx.goodsReceiptItem.update({
            where: { id: item.id },
            data: {
              inspectionStatus: 'PASSED',
              qualityRating: qualityRating || 'GOOD',
              inspectedById: req.user.userId,
              inspectedAt: new Date(),
            },
          });
        }

        // Update receipt
        const updated = await tx.goodsReceipt.update({
          where: { id: receiptId },
          data: {
            inspectionStatus: 'PASSED',
            qualityCheckPassed: true,
            qualityRating: qualityRating || 'GOOD',
            qualityNotes: notes,
            inspectedById: req.user.userId,
            inspectedAt: new Date(),
          },
        });

        return updated;
      },
      { maxWait: 10000, timeout: 30000 }
    );

    res.json({
      success: true,
      message: 'All items accepted',
      data: updatedReceipt,
    });
  } catch (error) {
    console.error('Accept all items error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const rejectAllItems = async (req, res) => {
  try {
    const { receiptId } = req.params;
    const { rejectionReason, returnVoucherNo, notes } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update goods receipts',
      });
    }

    const receipt = await prisma.goodsReceipt.findFirst({
      where: {
        id: receiptId,
        purchaseOrder: {
          companyId: req.user.companyId,
        },
        inspectionStatus: 'PENDING',
      },
      include: {
        items: true,
        purchaseOrder: true,
      },
    });

    if (!receipt) {
      return res.status(404).json({
        success: false,
        message: 'Goods receipt not found or already inspected',
      });
    }

    const updatedReceipt = await prisma.$transaction(
      async (tx) => {
        // Update all items
        for (const item of receipt.items) {
          await tx.goodsReceiptItem.update({
            where: { id: item.id },
            data: {
              inspectionStatus: 'FAILED',
              rejectionReason,
              returnVoucherNo,
              returnedDate: new Date(),
              inspectedById: req.user.userId,
              inspectedAt: new Date(),
            },
          });

          // Reverse PO item received quantity
          const poItem = await tx.purchaseOrderItem.findUnique({
            where: { id: item.poItemId },
          });

          if (poItem) {
            const newReceivedQuantity =
              poItem.receivedQuantity - item.receivedQuantity;
            const newPendingQuantity = poItem.quantity - newReceivedQuantity;

            await tx.purchaseOrderItem.update({
              where: { id: item.poItemId },
              data: {
                receivedQuantity: newReceivedQuantity,
                pendingQuantity: newPendingQuantity,
                rejectedQuantity:
                  poItem.rejectedQuantity + item.receivedQuantity,
                isClosed: false,
              },
            });

            // If PO Item was reopened, revert MR to ORDERED
            if (newPendingQuantity > 0) {
              await tx.materialRequest.updateMany({
                where: {
                  purchaseOrderItemId: item.poItemId,
                  status: 'DELIVERED',
                },
                data: {
                  status: 'ORDERED',
                  actualDelivery: null,
                },
              });
            }
          }
        }

        // Update receipt
        const updated = await tx.goodsReceipt.update({
          where: { id: receiptId },
          data: {
            inspectionStatus: 'FAILED',
            qualityCheckPassed: false,
            qualityNotes: notes,
            isRejected: true,
            rejectionReason,
            returnVoucherNo,
            returnedDate: new Date(),
            inspectedById: req.user.userId,
            inspectedAt: new Date(),
          },
        });

        // Update PO status
        await calculatePOTotals(receipt.purchaseOrderId);

        // Verify PO status revert
        const poTotals = await tx.purchaseOrder.findUnique({
          where: { id: receipt.purchaseOrderId },
          select: { totalReceived: true, totalQuantity: true, status: true },
        });

        if (
          poTotals.totalReceived < poTotals.totalQuantity &&
          poTotals.status === 'RECEIVED'
        ) {
          await tx.purchaseOrder.update({
            where: { id: receipt.purchaseOrderId },
            data: { status: 'PARTIALLY_RECEIVED' },
          });
        }

        return updated;
      },
      { maxWait: 10000, timeout: 30000 }
    );

    res.json({
      success: true,
      message: 'All items rejected',
      data: updatedReceipt,
    });
  } catch (error) {
    console.error('Reject all items error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const updateStockFromReceipt = async (req, res) => {
  try {
    const { receiptId } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );
    if (!hasPermission)
      return res
        .status(403)
        .json({ success: false, message: 'Permission denied' });

    const receipt = await prisma.goodsReceipt.findFirst({
      where: {
        id: receiptId,
        purchaseOrder: { companyId: req.user.companyId },
        stockUpdated: false,
        inspectionStatus: 'PASSED',
      },
      include: {
        items: { include: { poItem: { include: { material: true } } } },
        purchaseOrder: true,
      },
    });

    if (!receipt)
      return res.status(404).json({
        success: false,
        message: 'Goods receipt not found or already processed',
      });

    const po = await prisma.purchaseOrder.findFirst({
      where: { id: receipt.purchaseOrderId, companyId: req.user.companyId },
      select: {
        id: true,
        poNumber: true,
        projectId: true,
        companyId: true,
        budgetTransactionId: true,
        status: true,
        currency: true,
      },
    });

    // Compute receipt value including proportional Tax for correct Budget decrement
    const receiptValue = receipt.items.reduce((sum, item) => {
      if (!item.poItem?.materialId || !item.acceptedQuantity) return sum;
      const lineTotal = item.acceptedQuantity * (item.poItem.unitPrice || 0);
      const taxPercent = item.poItem.taxPercent || 0;
      const lineTax = (lineTotal * taxPercent) / 100;
      return sum + lineTotal + lineTax;
    }, 0);

    // Wrapped in a transaction with extended timeout for batch updates
    await prisma.$transaction(
      async (tx) => {
        // 1. Process Stock & Inventory
        for (const item of receipt.items) {
          if (!item.poItem.materialId || item.acceptedQuantity <= 0) continue;

          const material = await tx.material.findUnique({
            where: { id: item.poItem.materialId },
          });
          if (!material) continue;

          let inventory = await tx.inventory.findFirst({
            where: {
              companyId: po.companyId,
              materialId: item.poItem.materialId,
              projectId: po.projectId,
              location: 'PROJECT',
            },
          });

          if (!inventory) {
            inventory = await tx.inventory.create({
              data: {
                companyId: po.companyId,
                materialId: item.poItem.materialId,
                projectId: po.projectId,
                location: 'PROJECT',
                quantityTotal: 0,
                quantityAvailable: 0,
                quantityUsed: 0,
                averageRate: 0,
                totalValue: 0,
              },
            });
          }

          const unitPrice = item.poItem.unitPrice || 0;
          const incomingValue = item.acceptedQuantity * unitPrice;
          const newTotalValue = inventory.totalValue + incomingValue;
          const newTotalQty =
            inventory.quantityAvailable + item.acceptedQuantity;
          const newAvgRate = newTotalQty > 0 ? newTotalValue / newTotalQty : 0;

          await tx.inventory.update({
            where: { id: inventory.id },
            data: {
              quantityAvailable: { increment: item.acceptedQuantity },
              quantityTotal: { increment: item.acceptedQuantity },
              totalValue: newTotalValue,
              averageRate: newAvgRate,
            },
          });

          await tx.materialBatch.create({
            data: {
              materialId: item.poItem.materialId,
              projectId: po.projectId,
              batchNumber:
                item.batchNo ||
                `${receipt.grNumber}-${item.id.substring(0, 6)}`,
              quantity: item.acceptedQuantity,
              unitPrice,
              purchaseDate: receipt.receiptDate,
              expiryDate: item.expiryDate,
            },
          });

          const previousStock = material.stockQuantity || 0;
          const newStock = previousStock + item.acceptedQuantity;

          await tx.stockTransaction.create({
            data: {
              materialId: item.poItem.materialId,
              transactionType: 'PURCHASE',
              quantity: item.acceptedQuantity,
              previousStock,
              newStock,
              projectId: po.projectId,
              referenceId: receiptId,
              referenceType: 'GOODS_RECEIPT',
              notes: `Stock update from GR: ${receipt.grNumber} (PO: ${po.poNumber})`,
              createdById: req.user.userId,
              goodsReceiptItemId: item.id,
            },
          });

          await tx.material.update({
            where: { id: item.poItem.materialId },
            data: { stockQuantity: newStock },
          });
        }

        await tx.goodsReceipt.update({
          where: { id: receiptId },
          data: { stockUpdated: true, stockUpdatedAt: new Date() },
        });

        // 2. Calculate New PO Status
        const poTotals = await calculatePOTotals(po.id);
        // Note: calculatePOTotals uses a separate db call, we recreate logic here using the TX to prevent locks.
        const poItems = await tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId: po.id },
        });

        let totalQty = 0;
        let totalRec = 0;
        let allClosed = true;
        poItems.forEach((i) => {
          totalQty += i.quantity;
          totalRec += i.receivedQuantity;
          if (!i.isClosed) allClosed = false;
        });

        let newPoStatus = po.status;
        if (totalRec >= totalQty || allClosed) newPoStatus = 'RECEIVED';
        else if (totalRec > 0) newPoStatus = 'PARTIALLY_RECEIVED';

        if (newPoStatus !== po.status) {
          await tx.purchaseOrder.update({
            where: { id: po.id },
            data: { status: newPoStatus },
          });
          if (newPoStatus === 'RECEIVED') {
            await tx.materialRequest.updateMany({
              where: { purchaseOrderId: po.id },
              data: { status: 'DELIVERED', actualDelivery: new Date() },
            });
          }
        }

        // 3. Process Budget Transactions (Using corrected expense deduction math)
        if (po.budgetTransactionId && receiptValue > 0) {
          const commitment = await tx.budgetTransaction.findUnique({
            where: { id: po.budgetTransactionId },
          });

          if (commitment && commitment.transactionType === 'COMMITMENT') {
            const expenseAmount = receiptValue;

            // Log Actual Disbursed Expense
            await tx.budgetTransaction.create({
              data: {
                transactionNo: `EXP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                budgetId: commitment.budgetId,
                categoryId: commitment.categoryId,
                transactionType: 'EXPENSE',
                status: 'DISBURSED',
                description: `Goods received against PO: ${po.poNumber} (GR: ${receipt.grNumber})`,
                amount: expenseAmount,
                taxAmount: 0,
                totalAmount: expenseAmount,
                referenceType: 'PURCHASE_ORDER',
                referenceId: po.id,
                referenceNo: po.poNumber,
                transactionDate: new Date(),
                disbursedDate: new Date(),
                createdById: req.user.userId,
              },
            });

            // Global Transaction Ledger
            await tx.transaction.create({
              data: {
                transactionNo: `TRX-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                projectId: po.projectId,
                companyId: po.companyId,
                type: 'EXPENSE',
                status: 'APPROVED',
                amount: expenseAmount,
                taxAmount: 0,
                totalAmount: expenseAmount,
                currency: po.currency || 'INR',
                transactionDate: new Date(),
                description: `Inventory stock received from PO: ${po.poNumber} (GR: ${receipt.grNumber})`,
                budgetId: commitment.budgetId,
                budgetCategoryId: commitment.categoryId,
                purchaseOrderId: po.id,
                sourceType: 'PURCHASE_ORDER',
                sourceId: receipt.id,
                requestedById: req.user.userId,
                approvedById: req.user.userId,
                approvedAt: new Date(),
              },
            });

            // Handle variances carefully!
            const currentCat = await tx.budgetCategoryAllocation.findUnique({
              where: { id: commitment.categoryId },
              select: { committedAmount: true },
            });

            const commToDeduct = Math.min(
              expenseAmount,
              commitment.committedAmount || 0
            );
            const extraFromRemaining = Math.max(
              0,
              expenseAmount - (commitment.committedAmount || 0)
            );

            let finalDeductComm = commToDeduct;
            let finalRemainingAdjust = -extraFromRemaining;

            // If the PO is closed/fully received, flush leftover commitment back to Remaining.
            if (newPoStatus === 'RECEIVED' || newPoStatus === 'CLOSED') {
              const residual = Math.max(
                0,
                (commitment.committedAmount || 0) - expenseAmount
              );
              finalDeductComm += residual;
              finalRemainingAdjust += residual;
            }

            // Safety check: Prevent negative committedAmount at category level
            const safeDeductComm = Math.min(
              finalDeductComm,
              currentCat ? currentCat.committedAmount : finalDeductComm
            );

            // Update Category
            await tx.budgetCategoryAllocation.update({
              where: { id: commitment.categoryId },
              data: {
                spentAmount: { increment: expenseAmount },
                committedAmount: { decrement: safeDeductComm },
                remainingAmount: { increment: finalRemainingAdjust },
              },
            });

            // Update original commitment to keep Ledger accurate
            const newCommittedAmount = Math.max(
              0,
              (commitment.committedAmount || 0) - expenseAmount
            );
            await tx.budgetTransaction.update({
              where: { id: commitment.id },
              data: {
                committedAmount:
                  newPoStatus === 'RECEIVED' || newPoStatus === 'CLOSED'
                    ? 0
                    : newCommittedAmount,
                status:
                  newPoStatus === 'RECEIVED' ||
                  newPoStatus === 'CLOSED' ||
                  newCommittedAmount === 0
                    ? 'DISBURSED'
                    : commitment.status,
              },
            });
          }
        }

        // Final update: Recalculate Budget Totals within transaction
        if (po.budgetId) {
          await recalculateBudgetSummary(po.budgetId, tx);
        }
      },
      { maxWait: 10000, timeout: 30000 }
    ); // Massively increased timeout

    res.json({
      success: true,
      message: 'Stock and Budget updated successfully',
    });
  } catch (error) {
    console.error('Update stock from receipt error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
};
// ==================== GOODS RECEIPT ITEMS ====================

export const getReceiptItems = async (req, res) => {
  try {
    const { receiptId } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view receipt items',
      });
    }

    const items = await prisma.goodsReceiptItem.findMany({
      where: {
        goodsReceiptId: receiptId,
        goodsReceipt: {
          purchaseOrder: {
            companyId: req.user.companyId,
          },
        },
      },
      include: {
        poItem: {
          include: {
            material: {
              select: {
                id: true,
                name: true,
                materialCode: true,
              },
            },
          },
        },
        inspectedBy: {
          select: { id: true, name: true },
        },
        stockTransaction: true,
      },
    });

    res.json({
      success: true,
      data: items,
    });
  } catch (error) {
    console.error('Get receipt items error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const addReceiptItem = async (req, res) => {
  try {
    const { receiptId } = req.params;
    const {
      poItemId,
      receivedQuantity,
      acceptedQuantity,
      rejectedQuantity,
      condition,
      qualityRating,
      inspectionStatus,
      inspectionNotes,
      batchNo,
      serialNo,
      manufacturingDate,
      expiryDate,
      storedLocation,
      binLocation,
      notes,
    } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to modify receipt items',
      });
    }

    const receipt = await prisma.goodsReceipt.findFirst({
      where: {
        id: receiptId,
        purchaseOrder: {
          companyId: req.user.companyId,
        },
        inspectionStatus: 'PENDING',
      },
      include: {
        purchaseOrder: true,
      },
    });

    if (!receipt) {
      return res.status(404).json({
        success: false,
        message: 'Goods receipt not found or already inspected',
      });
    }

    const poItem = await prisma.purchaseOrderItem.findFirst({
      where: {
        id: poItemId,
        purchaseOrderId: receipt.purchaseOrderId,
      },
    });

    if (!poItem) {
      return res.status(404).json({
        success: false,
        message: 'PO item not found',
      });
    }

    const existingItem = await prisma.goodsReceiptItem.findFirst({
      where: {
        goodsReceiptId: receiptId,
        poItemId,
      },
    });

    if (existingItem) {
      return res.status(400).json({
        success: false,
        message: 'Item already exists in this receipt',
      });
    }

    const item = await prisma.$transaction(async (tx) => {
      const newItem = await tx.goodsReceiptItem.create({
        data: {
          goodsReceiptId: receiptId,
          poItemId,
          receivedQuantity,
          acceptedQuantity: acceptedQuantity || receivedQuantity,
          rejectedQuantity: rejectedQuantity || 0,
          unit: poItem.unit,
          condition,
          qualityRating,
          inspectionStatus: inspectionStatus || 'PENDING',
          inspectionNotes,
          batchNo,
          serialNo,
          manufacturingDate: manufacturingDate
            ? safeDate(manufacturingDate)
            : null,
          expiryDate: expiryDate ? safeDate(expiryDate) : null,
          storedLocation,
          binLocation,
          notes,
        },
      });

      // Update PO item
      const newReceivedQuantity = poItem.receivedQuantity + receivedQuantity;
      const newPendingQuantity = poItem.quantity - newReceivedQuantity;
      const isClosed = newPendingQuantity === 0;

      await tx.purchaseOrderItem.update({
        where: { id: poItemId },
        data: {
          receivedQuantity: newReceivedQuantity,
          pendingQuantity: newPendingQuantity,
          acceptedQuantity:
            poItem.acceptedQuantity + (acceptedQuantity || receivedQuantity),
          rejectedQuantity: poItem.rejectedQuantity + (rejectedQuantity || 0),
          isClosed,
        },
      });

      if (isClosed) {
        await tx.materialRequest.updateMany({
          where: { purchaseOrderItemId: poItemId },
          data: {
            status: 'DELIVERED',
            actualDelivery: new Date(),
          },
        });
      }

      // Update PO totals
      await calculatePOTotals(receipt.purchaseOrderId);

      return newItem;
    });

    res.status(201).json({
      success: true,
      message: 'Receipt item added',
      data: item,
    });
  } catch (error) {
    console.error('Add receipt item error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const updateReceiptItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const {
      condition,
      qualityRating,
      inspectionStatus,
      inspectionNotes,
      batchNo,
      serialNo,
      manufacturingDate,
      expiryDate,
      storedLocation,
      binLocation,
      notes,
    } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update receipt items',
      });
    }

    const item = await prisma.goodsReceiptItem.findFirst({
      where: {
        id: itemId,
        goodsReceipt: {
          purchaseOrder: {
            companyId: req.user.companyId,
          },
          inspectionStatus: 'PENDING',
        },
      },
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Receipt item not found or already inspected',
      });
    }

    const updatedItem = await prisma.goodsReceiptItem.update({
      where: { id: itemId },
      data: {
        condition,
        qualityRating,
        inspectionStatus,
        inspectionNotes,
        batchNo,
        serialNo,
        manufacturingDate: manufacturingDate
          ? safeDate(manufacturingDate)
          : null,
        expiryDate: expiryDate ? safeDate(expiryDate) : null,
        storedLocation,
        binLocation,
        notes,
      },
    });

    res.json({
      success: true,
      message: 'Receipt item updated',
      data: updatedItem,
    });
  } catch (error) {
    console.error('Update receipt item error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const removeReceiptItem = async (req, res) => {
  try {
    const { itemId } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to remove receipt items',
      });
    }

    const item = await prisma.goodsReceiptItem.findFirst({
      where: {
        id: itemId,
        goodsReceipt: {
          purchaseOrder: {
            companyId: req.user.companyId,
          },
          inspectionStatus: 'PENDING',
        },
      },
      include: {
        goodsReceipt: true,
        poItem: true,
      },
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Receipt item not found or cannot be removed',
      });
    }

    await prisma.$transaction(async (tx) => {
      // Reverse PO item quantities
      const newReceivedQuantity =
        item.poItem.receivedQuantity - item.receivedQuantity;
      const newPendingQuantity = item.poItem.quantity - newReceivedQuantity;

      await tx.purchaseOrderItem.update({
        where: { id: item.poItemId },
        data: {
          receivedQuantity: newReceivedQuantity,
          pendingQuantity: newPendingQuantity,
          acceptedQuantity:
            item.poItem.acceptedQuantity - item.acceptedQuantity,
          rejectedQuantity:
            item.poItem.rejectedQuantity - item.rejectedQuantity,
          isClosed: false,
        },
      });

      // If PO Item was reopened, revert MR to ORDERED
      if (newPendingQuantity > 0) {
        await tx.materialRequest.updateMany({
          where: { purchaseOrderItemId: item.poItemId, status: 'DELIVERED' },
          data: {
            status: 'ORDERED',
            actualDelivery: null,
          },
        });
      }

      // Delete receipt item
      await tx.goodsReceiptItem.delete({
        where: { id: itemId },
      });

      // Update PO totals
      await calculatePOTotals(item.goodsReceipt.purchaseOrderId);
    });

    res.json({
      success: true,
      message: 'Receipt item removed',
    });
  } catch (error) {
    console.error('Remove receipt item error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const acceptReceiptItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { qualityRating, notes } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update receipt items',
      });
    }

    const item = await prisma.goodsReceiptItem.findFirst({
      where: {
        id: itemId,
        goodsReceipt: {
          purchaseOrder: {
            companyId: req.user.companyId,
          },
        },
        inspectionStatus: 'PENDING',
      },
      include: {
        goodsReceipt: true,
      },
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Receipt item not found or already inspected',
      });
    }

    const updatedItem = await prisma.goodsReceiptItem.update({
      where: { id: itemId },
      data: {
        inspectionStatus: 'PASSED',
        qualityRating: qualityRating || 'GOOD',
        inspectedById: req.user.userId,
        inspectedAt: new Date(),
      },
    });

    // Check if all items are inspected
    const pendingItems = await prisma.goodsReceiptItem.count({
      where: {
        goodsReceiptId: item.goodsReceiptId,
        inspectionStatus: 'PENDING',
      },
    });

    if (pendingItems === 0) {
      await prisma.goodsReceipt.update({
        where: { id: item.goodsReceiptId },
        data: {
          inspectionStatus: 'PASSED',
          qualityCheckPassed: true,
          inspectedById: req.user.userId,
          inspectedAt: new Date(),
        },
      });
    }

    res.json({
      success: true,
      message: 'Receipt item accepted',
      data: updatedItem,
    });
  } catch (error) {
    console.error('Accept receipt item error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const rejectReceiptItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { rejectionReason, returnVoucherNo } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update receipt items',
      });
    }

    const item = await prisma.goodsReceiptItem.findFirst({
      where: {
        id: itemId,
        goodsReceipt: {
          purchaseOrder: {
            companyId: req.user.companyId,
          },
        },
        inspectionStatus: 'PENDING',
      },
      include: {
        goodsReceipt: true,
        poItem: true,
      },
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Receipt item not found or already inspected',
      });
    }

    await prisma.$transaction(async (tx) => {
      // Update receipt item
      await tx.goodsReceiptItem.update({
        where: { id: itemId },
        data: {
          inspectionStatus: 'FAILED',
          rejectionReason,
          returnVoucherNo,
          returnedDate: new Date(),
          inspectedById: req.user.userId,
          inspectedAt: new Date(),
        },
      });

      // Reverse PO item quantities
      const newReceivedQuantity =
        item.poItem.receivedQuantity - item.receivedQuantity;
      const newPendingQuantity = item.poItem.quantity - newReceivedQuantity;

      await tx.purchaseOrderItem.update({
        where: { id: item.poItemId },
        data: {
          receivedQuantity: newReceivedQuantity,
          pendingQuantity: newPendingQuantity,
          rejectedQuantity:
            item.poItem.rejectedQuantity + item.receivedQuantity,
          isClosed: false,
        },
      });

      // If PO Item was reopened, revert MR to ORDERED
      if (newPendingQuantity > 0) {
        await tx.materialRequest.updateMany({
          where: { purchaseOrderItemId: item.poItemId, status: 'DELIVERED' },
          data: {
            status: 'ORDERED',
            actualDelivery: null,
          },
        });
      }

      // Update PO totals
      await calculatePOTotals(item.goodsReceipt.purchaseOrderId);
    });

    // Check if all items are inspected
    const pendingItems = await prisma.goodsReceiptItem.count({
      where: {
        goodsReceiptId: item.goodsReceiptId,
        inspectionStatus: 'PENDING',
      },
    });

    if (pendingItems === 0) {
      const rejectedItems = await prisma.goodsReceiptItem.count({
        where: {
          goodsReceiptId: item.goodsReceiptId,
          inspectionStatus: 'FAILED',
        },
      });

      await prisma.goodsReceipt.update({
        where: { id: item.goodsReceiptId },
        data: {
          inspectionStatus:
            rejectedItems === item.goodsReceipt.items?.length
              ? 'FAILED'
              : 'PARTIALLY_ACCEPTED',
          qualityCheckPassed: false,
          inspectedById: req.user.userId,
          inspectedAt: new Date(),
        },
      });
    }

    res.json({
      success: true,
      message: 'Receipt item rejected',
    });
  } catch (error) {
    console.error('Reject receipt item error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const returnReceiptItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { returnQuantity, returnReason, returnVoucherNo } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to return items',
      });
    }

    const item = await prisma.goodsReceiptItem.findFirst({
      where: {
        id: itemId,
        goodsReceipt: {
          purchaseOrder: {
            companyId: req.user.companyId,
          },
        },
      },
      include: {
        goodsReceipt: true,
        poItem: true,
      },
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Receipt item not found',
      });
    }

    if (returnQuantity > item.acceptedQuantity) {
      return res.status(400).json({
        success: false,
        message: `Cannot return more than accepted quantity: ${item.acceptedQuantity}`,
      });
    }

    await prisma.$transaction(async (tx) => {
      // Update receipt item
      await tx.goodsReceiptItem.update({
        where: { id: itemId },
        data: {
          returnedQuantity: item.returnedQuantity + returnQuantity,
          returnVoucherNo,
          returnedDate: new Date(),
        },
      });

      // Update PO item
      await tx.purchaseOrderItem.update({
        where: { id: item.poItemId },
        data: {
          returnedQuantity: item.poItem.returnedQuantity + returnQuantity,
        },
      });

      // Update stock if already added
      if (item.goodsReceipt.stockUpdated && item.poItem.materialId) {
        const material = await tx.material.findUnique({
          where: { id: item.poItem.materialId },
        });

        if (material) {
          const newStock = (material.stockQuantity || 0) - returnQuantity;

          await tx.stockTransaction.create({
            data: {
              materialId: item.poItem.materialId,
              transactionType: 'RETURN',
              quantity: returnQuantity,
              previousStock: material.stockQuantity || 0,
              newStock,
              projectId: item.goodsReceipt.projectId,
              referenceId: item.goodsReceiptId,
              referenceType: 'GOODS_RETURN',
              notes: `Return from GR: ${item.goodsReceipt.grNumber}, Reason: ${returnReason}`,
              createdById: req.user.userId,
            },
          });

          await tx.material.update({
            where: { id: item.poItem.materialId },
            data: {
              stockQuantity: newStock,
            },
          });
        }
      }
    });

    res.json({
      success: true,
      message: 'Item returned successfully',
    });
  } catch (error) {
    console.error('Return receipt item error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// ==================== PURCHASE ORDER PAYMENTS ====================

export const createPOPayment = async (req, res) => {
  try {
    const {
      purchaseOrderId,
      amount,
      paymentDate,
      paymentMethod,
      transactionId,
      referenceNo,
      paymentType,
      paymentOrder,
      bankName,
      bankAccount,
      bankIfsc,
      notes,
    } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create payments',
      });
    }

    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id: purchaseOrderId,
        companyId: req.user.companyId,
        status: {
          in: ['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED'],
        },
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found or cannot accept payments',
      });
    }

    // Generate payment number
    const year = new Date().getFullYear();
    const paymentCount = await prisma.purchaseOrderPayment.count({
      where: {
        purchaseOrder: {
          companyId: req.user.companyId,
        },
        createdAt: {
          gte: new Date(year, 0, 1),
          lt: new Date(year + 1, 0, 1),
        },
      },
    });
    const paymentNo = `POP-${year}-${String(paymentCount + 1).padStart(4, '0')}`;

    const payment = await prisma.purchaseOrderPayment.create({
      data: {
        paymentNo,
        purchaseOrderId,
        amount,
        paymentDate: paymentDate
          ? safeDate(paymentDate) || new Date()
          : new Date(),
        paymentMethod,
        transactionId,
        referenceNo,
        paymentType: paymentType || 'PARTIAL',
        paymentOrder,
        bankName,
        bankAccount,
        bankIfsc,
        notes,
        createdById: req.user.userId,
      },
    });

    // Update PO payment summary
    const payments = await prisma.purchaseOrderPayment.aggregate({
      where: { purchaseOrderId },
      _sum: { amount: true },
    });

    const totalPaid = payments._sum.amount || 0;
    const totalDue = po.totalAmount - totalPaid;
    const paymentPercent = (totalPaid / po.totalAmount) * 100;

    let poStatus = po.status;
    if (totalPaid >= po.totalAmount) {
      poStatus = 'PAID';
    } else if (totalPaid > 0) {
      poStatus = 'PARTIALLY_PAID';
    }

    await prisma.purchaseOrder.update({
      where: { id: purchaseOrderId },
      data: {
        totalPaid,
        totalDue,
        paymentPercent,
        status: poStatus,
      },
    });

    // Create history
    await createPOHistory(
      purchaseOrderId,
      req.user.userId,
      'PAID',
      po.status,
      poStatus,
      { paymentId: payment.id, amount },
      notes || `Payment recorded: ${amount}`
    );

    // Recalculate budget if linked
    if (po.budgetId) {
      await recalculateBudgetSummary(po.budgetId);
    }

    res.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      data: payment,
    });
  } catch (error) {
    console.error('Create PO payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getPOPaymentById = async (req, res) => {
  try {
    const { paymentId } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view payments',
      });
    }

    const payment = await prisma.purchaseOrderPayment.findFirst({
      where: {
        id: paymentId,
        purchaseOrder: {
          companyId: req.user.companyId,
        },
      },
      include: {
        purchaseOrder: {
          select: {
            id: true,
            poNumber: true,
            title: true,
            totalAmount: true,
          },
        },
        createdBy: {
          select: { id: true, name: true },
        },
        approvedBy: {
          select: { id: true, name: true },
        },
        budgetTransaction: {
          select: {
            id: true,
            transactionNo: true,
          },
        },
      },
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    res.json({
      success: true,
      data: payment,
    });
  } catch (error) {
    console.error('Get PO payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getPOPayments = async (req, res) => {
  try {
    const { poId } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view payments',
      });
    }

    const payments = await prisma.purchaseOrderPayment.findMany({
      where: {
        purchaseOrderId: poId,
        purchaseOrder: {
          companyId: req.user.companyId,
        },
      },
      include: {
        createdBy: {
          select: { id: true, name: true },
        },
        approvedBy: {
          select: { id: true, name: true },
        },
      },
      orderBy: { paymentDate: 'desc' },
    });

    res.json({
      success: true,
      data: payments,
    });
  } catch (error) {
    console.error('Get PO payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const recordAdvancePayment = async (req, res) => {
  try {
    const { poId } = req.params;
    const {
      amount,
      paymentDate,
      paymentMethod,
      transactionId,
      referenceNo,
      bankName,
      bankAccount,
      bankIfsc,
      notes,
    } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to record payments',
      });
    }

    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id: poId,
        companyId: req.user.companyId,
        status: { in: ['APPROVED', 'ORDERED'] },
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found',
      });
    }

    if (po.advancePaid) {
      return res.status(400).json({
        success: false,
        message: 'Advance payment already recorded for this PO',
      });
    }

    // Generate payment number
    const year = new Date().getFullYear();
    const paymentCount = await prisma.purchaseOrderPayment.count({
      where: {
        purchaseOrder: {
          companyId: req.user.companyId,
        },
        createdAt: {
          gte: new Date(year, 0, 1),
          lt: new Date(year + 1, 0, 1),
        },
      },
    });
    const paymentNo = `POP-${year}-${String(paymentCount + 1).padStart(4, '0')}`;

    const payment = await prisma.$transaction(async (tx) => {
      const newPayment = await tx.purchaseOrderPayment.create({
        data: {
          paymentNo,
          purchaseOrderId: poId,
          amount,
          paymentDate: paymentDate
            ? safeDate(paymentDate) || new Date()
            : new Date(),
          paymentMethod,
          transactionId,
          referenceNo,
          paymentType: 'ADVANCE',
          paymentOrder: 1,
          bankName,
          bankAccount,
          bankIfsc,
          notes,
          createdById: req.user.userId,
        },
      });

      await tx.purchaseOrder.update({
        where: { id: poId },
        data: {
          advancePaid: true,
          advancePaidDate: new Date(),
          advancePaymentId: newPayment.id,
          totalPaid: amount,
          totalDue: po.totalAmount - amount,
          paymentPercent: (amount / po.totalAmount) * 100,
          status: 'PARTIALLY_PAID',
        },
      });

      // Create history
      await tx.purchaseOrderHistory.create({
        data: {
          purchaseOrderId: poId,
          action: 'PAID',
          fromStatus: po.status,
          toStatus: 'PARTIALLY_PAID',
          performedById: req.user.userId,
          notes: `Advance payment recorded: ${amount}`,
        },
      });

      if (po.budgetId) {
        await recalculateBudgetSummary(po.budgetId, tx);
      }

      return newPayment;
    });

    res.status(201).json({
      success: true,
      message: 'Advance payment recorded',
      data: payment,
    });
  } catch (error) {
    console.error('Record advance payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const recordFinalPayment = async (req, res) => {
  try {
    const { poId } = req.params;
    const {
      amount,
      paymentDate,
      paymentMethod,
      transactionId,
      referenceNo,
      bankName,
      bankAccount,
      bankIfsc,
      notes,
    } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to record payments',
      });
    }

    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id: poId,
        companyId: req.user.companyId,
        status: { in: ['PARTIALLY_PAID', 'RECEIVED'] },
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found',
      });
    }

    const remainingAmount = po.totalAmount - (po.totalPaid || 0);

    if (amount > remainingAmount) {
      return res.status(400).json({
        success: false,
        message: `Amount exceeds remaining balance: ${remainingAmount}`,
      });
    }

    // Generate payment number
    const year = new Date().getFullYear();
    const paymentCount = await prisma.purchaseOrderPayment.count({
      where: {
        purchaseOrder: {
          companyId: req.user.companyId,
        },
        createdAt: {
          gte: new Date(year, 0, 1),
          lt: new Date(year + 1, 0, 1),
        },
      },
    });
    const paymentNo = `POP-${year}-${String(paymentCount + 1).padStart(4, '0')}`;

    const paymentOrder =
      (await prisma.purchaseOrderPayment.count({
        where: { purchaseOrderId: poId },
      })) + 1;

    const payment = await prisma.$transaction(async (tx) => {
      const newPayment = await tx.purchaseOrderPayment.create({
        data: {
          paymentNo,
          purchaseOrderId: poId,
          amount,
          paymentDate: paymentDate
            ? safeDate(paymentDate) || new Date()
            : new Date(),
          paymentMethod,
          transactionId,
          referenceNo,
          paymentType: paymentOrder === 1 ? 'FINAL' : 'PARTIAL',
          paymentOrder,
          bankName,
          bankAccount,
          bankIfsc,
          notes,
          createdById: req.user.userId,
        },
      });

      const totalPaid = (po.totalPaid || 0) + amount;
      const totalDue = po.totalAmount - totalPaid;
      const paymentPercent = (totalPaid / po.totalAmount) * 100;

      let poStatus = po.status;
      if (totalPaid >= po.totalAmount) {
        poStatus = 'PAID';
      }

      await tx.purchaseOrder.update({
        where: { id: poId },
        data: {
          totalPaid,
          totalDue,
          paymentPercent,
          status: poStatus,
        },
      });

      // Create history
      await tx.purchaseOrderHistory.create({
        data: {
          purchaseOrderId: poId,
          action: 'PAID',
          fromStatus: po.status,
          toStatus: poStatus,
          performedById: req.user.userId,
          notes: `Payment recorded: ${amount}`,
        },
      });

      return newPayment;
    });

    res.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      data: payment,
    });
  } catch (error) {
    console.error('Record final payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const approvePOPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { approvalNotes } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_APPROVE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to approve payments',
      });
    }

    const payment = await prisma.purchaseOrderPayment.findFirst({
      where: {
        id: paymentId,
        purchaseOrder: {
          companyId: req.user.companyId,
        },
        status: 'PENDING',
      },
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found or already processed',
      });
    }

    const approvedPayment = await prisma.purchaseOrderPayment.update({
      where: { id: paymentId },
      data: {
        status: 'PAID',
        approvedById: req.user.userId,
        approvedAt: new Date(),
        approvalNotes,
      },
    });

    // If PO has budget, recalculate
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: approvedPayment.purchaseOrderId },
      select: { budgetId: true },
    });
    if (po?.budgetId) {
      await recalculateBudgetSummary(po.budgetId);
    }

    res.json({
      success: true,
      message: 'Payment approved',
      data: approvedPayment,
    });
  } catch (error) {
    console.error('Approve PO payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// ==================== PURCHASE ORDER DOCUMENTS ====================

export const getPODocuments = async (req, res) => {
  try {
    const { poId } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view documents',
      });
    }

    const documents = await prisma.purchaseOrderDocument.findMany({
      where: {
        purchaseOrderId: poId,
        purchaseOrder: {
          companyId: req.user.companyId,
        },
      },
      include: {
        uploadedBy: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: documents,
    });
  } catch (error) {
    console.error('Get PO documents error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const uploadPODocument = async (req, res) => {
  try {
    const { poId } = req.params;
    const { title, description, documentType, fileUrl, fileType, fileSize } =
      req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to upload documents',
      });
    }

    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id: poId,
        companyId: req.user.companyId,
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found',
      });
    }

    const document = await prisma.purchaseOrderDocument.create({
      data: {
        purchaseOrderId: poId,
        title,
        description,
        documentType,
        fileUrl,
        fileType,
        fileSize: fileSize ? parseInt(fileSize) : null,
        uploadedById: req.user.userId,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Document uploaded successfully',
      data: document,
    });
  } catch (error) {
    console.error('Upload PO document error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const deletePODocument = async (req, res) => {
  try {
    const { documentId } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete documents',
      });
    }

    const document = await prisma.purchaseOrderDocument.findFirst({
      where: {
        id: documentId,
        purchaseOrder: {
          companyId: req.user.companyId,
        },
      },
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    await prisma.purchaseOrderDocument.delete({
      where: { id: documentId },
    });

    res.json({
      success: true,
      message: 'Document deleted successfully',
    });
  } catch (error) {
    console.error('Delete PO document error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// ==================== PURCHASE ORDER COMMENTS ====================

export const getPOComments = async (req, res) => {
  try {
    const { poId } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view comments',
      });
    }

    const comments = await prisma.purchaseOrderComment.findMany({
      where: {
        purchaseOrderId: poId,
        purchaseOrder: {
          companyId: req.user.companyId,
        },
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            profilePicture: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: comments,
    });
  } catch (error) {
    console.error('Get PO comments error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const addPOComment = async (req, res) => {
  try {
    const { poId } = req.params;
    const { content, isInternal } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to add comments',
      });
    }

    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id: poId,
        companyId: req.user.companyId,
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found',
      });
    }

    const comment = await prisma.purchaseOrderComment.create({
      data: {
        purchaseOrderId: poId,
        content,
        isInternal: isInternal || false,
        createdById: req.user.userId,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            profilePicture: true,
          },
        },
      },
    });

    res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      data: comment,
    });
  } catch (error) {
    console.error('Add PO comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const updatePOComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const { content } = req.body;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update comments',
      });
    }

    const comment = await prisma.purchaseOrderComment.findFirst({
      where: {
        id: commentId,
        createdById: req.user.userId,
        purchaseOrder: {
          companyId: req.user.companyId,
        },
      },
    });

    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found or you do not have permission to update it',
      });
    }

    const updatedComment = await prisma.purchaseOrderComment.update({
      where: { id: commentId },
      data: { content },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            profilePicture: true,
          },
        },
      },
    });

    res.json({
      success: true,
      message: 'Comment updated successfully',
      data: updatedComment,
    });
  } catch (error) {
    console.error('Update PO comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const deletePOComment = async (req, res) => {
  try {
    const { commentId } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete comments',
      });
    }

    const comment = await prisma.purchaseOrderComment.findFirst({
      where: {
        id: commentId,
        createdById: req.user.userId,
        purchaseOrder: {
          companyId: req.user.companyId,
        },
      },
    });

    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found or you do not have permission to delete it',
      });
    }

    await prisma.purchaseOrderComment.delete({
      where: { id: commentId },
    });

    res.json({
      success: true,
      message: 'Comment deleted successfully',
    });
  } catch (error) {
    console.error('Delete PO comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// ==================== PURCHASE ORDER HISTORY ====================

export const getPOHistory = async (req, res) => {
  try {
    const { poId } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view PO history',
      });
    }

    const history = await prisma.purchaseOrderHistory.findMany({
      where: {
        purchaseOrderId: poId,
        purchaseOrder: {
          companyId: req.user.companyId,
        },
      },
      include: {
        performedBy: {
          select: {
            id: true,
            name: true,
            profilePicture: true,
          },
        },
      },
      orderBy: { performedAt: 'desc' },
    });

    res.json({
      success: true,
      data: history,
    });
  } catch (error) {
    console.error('Get PO history error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getPOTimeline = async (req, res) => {
  try {
    const { poId } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view PO timeline',
      });
    }

    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id: poId,
        companyId: req.user.companyId,
      },
      select: {
        createdAt: true,
        requestedAt: true,
        approvedAt: true,
        orderedAt: true,
        actualDelivery: true,
        closedAt: true,
        cancelledAt: true,
        status: true,
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found',
      });
    }

    // Get history for additional timeline events
    const history = await prisma.purchaseOrderHistory.findMany({
      where: {
        purchaseOrderId: poId,
      },
      select: {
        action: true,
        performedAt: true,
        performedBy: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { performedAt: 'asc' },
    });

    // Build timeline with key events
    const timeline = [
      {
        event: 'PO Created',
        date: po.createdAt,
        status: 'DRAFT',
      },
      ...history.map((h) => ({
        event: h.action,
        date: h.performedAt,
        performedBy: h.performedBy?.name,
      })),
    ];

    if (po.requestedAt) {
      timeline.push({
        event: 'Submitted for Approval',
        date: po.requestedAt,
      });
    }

    if (po.approvedAt) {
      timeline.push({
        event: 'Approved',
        date: po.approvedAt,
      });
    }

    if (po.orderedAt) {
      timeline.push({
        event: 'Ordered',
        date: po.orderedAt,
      });
    }

    if (po.actualDelivery) {
      timeline.push({
        event: 'Delivered',
        date: po.actualDelivery,
      });
    }

    if (po.closedAt) {
      timeline.push({
        event: 'Closed',
        date: po.closedAt,
      });
    }

    if (po.cancelledAt) {
      timeline.push({
        event: 'Cancelled',
        date: po.cancelledAt,
      });
    }

    // Sort by date
    timeline.sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({
      success: true,
      data: timeline,
    });
  } catch (error) {
    console.error('Get PO timeline error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// ==================== APPROVALS ====================

export const getPendingPOApprovals = async (req, res) => {
  try {
    const { page = 1, limit = 10, projectId } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_APPROVE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view pending approvals',
      });
    }

    const where = {
      companyId: req.user.companyId,
      status: 'PENDING_APPROVAL',
    };

    if (projectId) {
      where.projectId = projectId;
    }

    const [pos, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: {
          project: {
            select: {
              id: true,
              name: true,
              projectId: true,
            },
          },
          supplier: {
            select: {
              id: true,
              name: true,
              supplierCode: true,
            },
          },
          requestedBy: {
            select: {
              id: true,
              name: true,
            },
          },
          items: {
            select: {
              id: true,
              description: true,
              quantity: true,
              unit: true,
              unitPrice: true,
              totalPrice: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { requestedAt: 'asc' },
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    res.json({
      success: true,
      data: pos,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get pending PO approvals error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// ==================== AUDIT ====================

export const getPOAuditTrail = async (req, res) => {
  try {
    const { poId } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view audit trail',
      });
    }

    // Get audit logs
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        entityType: 'PURCHASE_ORDER',
        entityId: poId,
        companyId: req.user.companyId,
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

    // Get PO history
    const history = await prisma.purchaseOrderHistory.findMany({
      where: {
        purchaseOrderId: poId,
      },
      include: {
        performedBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { performedAt: 'desc' },
    });

    // Get payment history
    const payments = await prisma.purchaseOrderPayment.findMany({
      where: {
        purchaseOrderId: poId,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
          },
        },
        approvedBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Get receipt history
    const receipts = await prisma.goodsReceipt.findMany({
      where: {
        purchaseOrderId: poId,
      },
      include: {
        receivedBy: {
          select: {
            id: true,
            name: true,
          },
        },
        inspectedBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    const auditTrail = {
      auditLogs,
      statusHistory: history,
      payments,
      receipts,
    };

    res.json({
      success: true,
      data: auditTrail,
    });
  } catch (error) {
    console.error('Get PO audit trail error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// ==================== SEARCH ====================

export const searchPurchaseOrders = async (req, res) => {
  try {
    const {
      q = '',
      page = 1,
      limit = 10,
      status,
      type,
      projectId,
      supplierId,
      fromDate,
      toDate,
      minAmount,
      maxAmount,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to search purchase orders',
      });
    }

    const where = {
      companyId: req.user.companyId,
      OR: [
        { poNumber: { contains: q, mode: 'insensitive' } },
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { supplierName: { contains: q, mode: 'insensitive' } },
        { notes: { contains: q, mode: 'insensitive' } },
        { terms: { contains: q, mode: 'insensitive' } },
      ],
    };

    if (status) where.status = status;
    if (type) where.type = type;
    if (projectId) where.projectId = projectId;
    if (supplierId) where.supplierId = supplierId;

    if (fromDate || toDate) {
      where.orderDate = {};
      const from = safeDate(fromDate);
      const to = safeDate(toDate);
      if (from) where.orderDate.gte = from;
      if (to) where.orderDate.lte = to;
    }

    if (minAmount || maxAmount) {
      where.totalAmount = {};
      if (minAmount) where.totalAmount.gte = parseFloat(minAmount);
      if (maxAmount) where.totalAmount.lte = parseFloat(maxAmount);
    }

    const [pos, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: {
          project: {
            select: {
              id: true,
              name: true,
              projectId: true,
            },
          },
          supplier: {
            select: {
              id: true,
              name: true,
              supplierCode: true,
            },
          },
          items: {
            take: 5,
            select: {
              id: true,
              description: true,
              quantity: true,
              unit: true,
            },
          },
          _count: {
            select: {
              items: true,
              receipts: true,
              payments: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    // Add search relevance score (basic implementation)
    const resultsWithScore = pos.map((po) => {
      let score = 0;
      const searchLower = q.toLowerCase();

      if (po.poNumber.toLowerCase().includes(searchLower)) score += 10;
      if (po.title.toLowerCase().includes(searchLower)) score += 5;
      if (po.supplierName?.toLowerCase().includes(searchLower)) score += 3;
      if (po.description?.toLowerCase().includes(searchLower)) score += 2;

      return { ...po, relevanceScore: score };
    });

    // Sort by relevance score
    resultsWithScore.sort((a, b) => b.relevanceScore - a.relevanceScore);

    res.json({
      success: true,
      data: resultsWithScore,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Search purchase orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// ==================== PDF GENERATION ====================

export const downloadPurchaseOrderPDF = async (req, res) => {
  try {
    const { id } = req.params;

    // Check permissions
    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to download purchase orders',
      });
    }

    // Fetch PO with all related data
    const po = await prisma.purchaseOrder.findFirst({
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
          },
        },
        supplier: true,
        items: {
          include: {
            material: {
              select: {
                id: true,
                name: true,
                materialCode: true,
              },
            },
          },
          orderBy: {
            lineNo: 'asc',
          },
        },
        company: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        approvedBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found',
      });
    }

    // Create PDF generator instance
    const PDFGenerator = (await import('../services/pdfGenerator.service.js'))
      .default;
    const generator = new PDFGenerator();

    // Generate PDF
    const doc = await generator.generatePurchaseOrderPDF(po);

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="PO-${po.poNumber}.pdf"`
    );

    // Pipe PDF to response
    doc.pipe(res);
    doc.end();

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'PO_PDF_DOWNLOADED',
        entityType: 'PURCHASE_ORDER',
        entityId: id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });
  } catch (error) {
    console.error('Download PO PDF error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
};

// Optional: Generate PDF and return as base64 for preview
export const previewPurchaseOrderPDF = async (req, res) => {
  try {
    const { id } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied',
      });
    }

    const po = await prisma.purchaseOrder.findFirst({
      where: { id, companyId: req.user.companyId },
      include: {
        project: true,
        supplier: true,
        items: {
          include: {
            material: true,
          },
          orderBy: { lineNo: 'asc' },
        },
        company: true,
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found',
      });
    }

    // Generate PDF
    const PDFGenerator = (await import('../services/pdfGenerator.service.js'))
      .default;
    const generator = new PDFGenerator();
    const doc = await generator.generatePurchaseOrderPDF(po);

    // Collect PDF chunks
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));

    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      const base64PDF = pdfBuffer.toString('base64');

      res.json({
        success: true,
        data: {
          pdf: base64PDF,
          filename: `PO-${po.poNumber}.pdf`,
        },
      });
    });

    doc.end();
  } catch (error) {
    console.error('Preview PO PDF error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Bulk download multiple POs as ZIP
export const downloadMultiplePOsPDF = async (req, res) => {
  try {
    const { poIds } = req.body;

    if (!poIds || !Array.isArray(poIds) || poIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an array of PO IDs',
      });
    }

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied',
      });
    }

    // Fetch all POs
    const pos = await prisma.purchaseOrder.findMany({
      where: {
        id: { in: poIds },
        companyId: req.user.companyId,
      },
      include: {
        project: true,
        supplier: true,
        items: {
          include: {
            material: true,
          },
          orderBy: { lineNo: 'asc' },
        },
        company: true,
      },
    });

    if (pos.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No purchase orders found',
      });
    }

    // Create a zip file
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const PDFGenerator = (await import('../services/pdfGenerator.service.js'))
      .default;

    // Generate PDF for each PO and add to zip
    for (const po of pos) {
      const generator = new PDFGenerator();
      const doc = await generator.generatePurchaseOrderPDF(po);

      // Collect PDF chunks
      const chunks = [];
      await new Promise((resolve, reject) => {
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', resolve);
        doc.on('error', reject);
        doc.end();
      });

      const pdfBuffer = Buffer.concat(chunks);
      zip.file(`PO-${po.poNumber}.pdf`, pdfBuffer);
    }

    // Generate zip file
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    // Send zip file
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="purchase-orders.zip"'
    );
    res.send(zipBuffer);

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'PO_BULK_DOWNLOAD',
        entityType: 'PURCHASE_ORDER',
        entityId: 'bulk',
        newData: { count: pos.length, poIds },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });
  } catch (error) {
    console.error('Bulk download POs error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// GRN PDF Download
export const downloadGRNPDF = async (req, res) => {
  try {
    const { id: receiptId } = req.params;

    // Check permissions
    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to download goods receipts',
      });
    }

    // Fetch GRN with all related data
    const receipt = await prisma.goodsReceipt.findFirst({
      where: {
        id: receiptId,
        purchaseOrder: {
          companyId: req.user.companyId,
        },
      },
      include: {
        project: true,
        purchaseOrder: {
          include: {
            supplier: true,
            company: true,
          },
        },
        items: {
          include: {
            poItem: {
              include: {
                material: true,
              },
            },
          },
        },
      },
    });

    if (!receipt) {
      return res.status(404).json({
        success: false,
        message: 'Goods receipt not found',
      });
    }

    // Create PDF generator instance
    const PDFGenerator = (await import('../services/pdfGenerator.service.js'))
      .default;
    const generator = new PDFGenerator();

    // Generate PDF
    const doc = await generator.generateGoodsReceiptPDF(receipt);

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="GRN-${receipt.grNumber}.pdf"`
    );

    // Pipe PDF to response
    doc.pipe(res);
    doc.end();

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'GRN_PDF_DOWNLOADED',
        entityType: 'GOODS_RECEIPT',
        entityId: receiptId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });
  } catch (error) {
    console.error('Download GRN PDF error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
};

// GRN PDF Preview
export const previewGRNPDF = async (req, res) => {
  try {
    const { id: receiptId } = req.params;

    const hasPermission = await checkPOPermission(
      req.user.userId,
      req.user.companyId,
      'PO_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied',
      });
    }

    const receipt = await prisma.goodsReceipt.findFirst({
      where: {
        id: receiptId,
        purchaseOrder: {
          companyId: req.user.companyId,
        },
      },
      include: {
        project: true,
        purchaseOrder: {
          include: {
            supplier: true,
            company: true,
          },
        },
        items: {
          include: {
            poItem: {
              include: {
                material: true,
              },
            },
          },
        },
      },
    });

    if (!receipt) {
      return res.status(404).json({
        success: false,
        message: 'Goods receipt not found',
      });
    }

    // Generate PDF
    const PDFGenerator = (await import('../services/pdfGenerator.service.js'))
      .default;
    const generator = new PDFGenerator();
    const doc = await generator.generateGoodsReceiptPDF(receipt);

    // Collect PDF chunks
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));

    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      const base64PDF = pdfBuffer.toString('base64');

      res.json({
        success: true,
        data: {
          pdf: base64PDF,
          filename: `GRN-${receipt.grNumber}.pdf`,
        },
      });
    });

    doc.end();
  } catch (error) {
    console.error('Preview GRN PDF error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
