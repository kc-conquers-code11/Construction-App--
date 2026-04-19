import prisma from '../config/database.js';

class MaterialService {
  // Check if material stock is sufficient
  async checkStockAvailability(materialId, requiredQuantity) {
    const material = await prisma.material.findUnique({
      where: { id: materialId },
      select: {
        id: true,
        name: true,
        stockQuantity: true,
        minimumStock: true,
        unit: true,
      },
    });

    if (!material) {
      throw new Error('Material not found');
    }

    const availableStock = material.stockQuantity || 0;
    const minimumStock = material.minimumStock || 10;

    const stockCheck = {
      materialId: material.id,
      materialName: material.name,
      availableStock,
      requiredQuantity,
      unit: material.unit,
      isAvailable: availableStock >= requiredQuantity,
      shortage: Math.max(0, requiredQuantity - availableStock),
      isBelowMinimum: availableStock <= minimumStock,
      willBeCritical: availableStock - requiredQuantity <= minimumStock * 0.2, // 20% of minimum
      stockAfterConsumption: availableStock - requiredQuantity,
    };

    return stockCheck;
  }

  // Update material stock with transaction
  async updateStockWithTransaction(data) {
    const {
      materialId,
      quantity,
      transactionType,
      referenceId,
      referenceType,
      notes,
      userId,
      projectId,
    } = data;

    return await prisma.$transaction(async (tx) => {
      // Get current material
      const material = await tx.material.findUnique({
        where: { id: materialId },
      });

      if (!material) {
        throw new Error('Material not found');
      }

      const previousStock = material.stockQuantity || 0;
      let newStock;

      // Calculate new stock based on transaction type
      switch (transactionType) {
        case 'PURCHASE':
        case 'RETURN':
        case 'ADJUSTMENT_ADD':
          newStock = previousStock + quantity;
          break;
        case 'CONSUMPTION':
        case 'ADJUSTMENT_REMOVE':
          newStock = previousStock - quantity;
          if (newStock < 0) {
            throw new Error('Insufficient stock');
          }
          break;
        default:
          throw new Error('Invalid transaction type');
      }

      // Update material stock
      const updatedMaterial = await tx.material.update({
        where: { id: materialId },
        data: { stockQuantity: newStock },
      });

      // Create stock transaction record
      const stockTransaction = await tx.stockTransaction.create({
        data: {
          materialId,
          transactionType,
          quantity,
          previousStock,
          newStock,
          referenceId,
          referenceType,
          notes,
          createdById: userId,
          projectId,
        },
      });

      // Check and create stock alert if needed
      let stockAlert = null;
      const minimumStock = material.minimumStock || 10;

      if (newStock <= minimumStock) {
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
      }

      return {
        updatedMaterial,
        stockTransaction,
        stockAlert,
        previousStock,
        newStock,
      };
    });
  }

  // Consume material from DPR
  async consumeMaterialFromDPR(data) {
    const { dprId, materialId, quantity, unit, remarks, userId } = data;

    return await prisma.$transaction(async (tx) => {
      // Get DPR
      const dpr = await tx.dailyProgressReport.findUnique({
        where: { id: dprId },
        include: { project: true },
      });

      if (!dpr) {
        throw new Error('DPR not found');
      }

      // Get material
      const material = await tx.material.findUnique({
        where: { id: materialId },
      });

      if (!material) {
        throw new Error('Material not found');
      }

      // Check stock availability
      const availableStock = material.stockQuantity || 0;
      if (quantity > availableStock) {
        throw new Error(
          `Insufficient stock. Available: ${availableStock} ${material.unit}`
        );
      }

      // Update material stock
      const newStock = availableStock - quantity;
      await tx.material.update({
        where: { id: materialId },
        data: { stockQuantity: newStock },
      });

      // Create stock transaction
      await tx.stockTransaction.create({
        data: {
          materialId,
          transactionType: 'CONSUMPTION',
          quantity,
          previousStock: availableStock,
          newStock,
          referenceId: dprId,
          referenceType: 'DPR',
          notes: `Consumed in DPR: ${dpr.reportNo} - ${remarks || ''}`,
          createdById: userId,
          projectId: dpr.projectId,
        },
      });

      // Create material consumption record
      const consumption = await tx.materialConsumption.create({
        data: {
          dprId,
          materialId,
          quantity,
          unit: unit || material.unit,
          remarks,
          consumedById: userId,
        },
      });

      // Update DPR materialsUsed field
      const materialUsageText = `${material.name}: ${quantity} ${unit || material.unit}`;
      const updatedMaterialsUsed = dpr.materialsUsed
        ? `${dpr.materialsUsed}, ${materialUsageText}`
        : materialUsageText;

      await tx.dailyProgressReport.update({
        where: { id: dprId },
        data: {
          materialsUsed: updatedMaterialsUsed,
        },
      });

      // Check for stock alerts
      const minimumStock = material.minimumStock || 10;
      if (newStock <= minimumStock) {
        const alertType = newStock <= 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK';
        const message =
          newStock <= 0
            ? `${material.name} is out of stock after consumption in DPR ${dpr.reportNo}`
            : `${material.name} stock is low (${newStock} ${material.unit}) after consumption in DPR ${dpr.reportNo}`;

        await tx.stockAlert.create({
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
      }

      return {
        consumption,
        material,
        stockUpdate: {
          previousStock: availableStock,
          newStock,
          consumed: quantity,
        },
      };
    });
  }

  // Deliver material request and update stock
  async deliverMaterialRequest(requestId, userId, supplier, expectedDelivery) {
    return await prisma.$transaction(async (tx) => {
      // Get material request
      const request = await tx.materialRequest.findUnique({
        where: { id: requestId },
        include: {
          material: true,
          project: true,
        },
      });

      if (!request) {
        throw new Error('Material request not found');
      }

      if (!request.materialId) {
        throw new Error('Material request does not have a material reference');
      }

      if (request.status === 'DELIVERED') {
        throw new Error('Material request is already delivered');
      }

      // Update request status
      const updatedRequest = await tx.materialRequest.update({
        where: { id: requestId },
        data: {
          status: 'DELIVERED',
          actualDelivery: new Date(),
          orderedById: userId,
          orderedAt: new Date(),
          supplier: supplier || request.supplier,
          expectedDelivery: expectedDelivery
            ? new Date(expectedDelivery)
            : request.expectedDelivery,
        },
      });

      // Get current material stock
      const material = await tx.material.findUnique({
        where: { id: request.materialId },
      });

      const previousStock = material.stockQuantity || 0;
      const newStock = previousStock + request.quantity;

      // Update material stock
      await tx.material.update({
        where: { id: request.materialId },
        data: {
          stockQuantity: newStock,
          supplier: supplier || material.supplier,
        },
      });

      // Create stock transaction
      await tx.stockTransaction.create({
        data: {
          materialId: request.materialId,
          transactionType: 'PURCHASE',
          quantity: request.quantity,
          previousStock,
          newStock,
          referenceId: requestId,
          referenceType: 'MATERIAL_REQUEST',
          notes: `Delivered via request: ${request.requestNo}`,
          createdById: userId,
          projectId: request.projectId,
        },
      });

      // Check and resolve stock alerts
      const alerts = await tx.stockAlert.findMany({
        where: {
          materialId: request.materialId,
          isResolved: false,
          alertType: { in: ['LOW_STOCK', 'OUT_OF_STOCK'] },
        },
      });

      for (const alert of alerts) {
        if (newStock > alert.threshold) {
          await tx.stockAlert.update({
            where: { id: alert.id },
            data: {
              isResolved: true,
              resolvedAt: new Date(),
              resolvedById: userId,
              resolutionNotes:
                'Stock replenished via material request delivery',
            },
          });
        }
      }

      return {
        request: updatedRequest,
        stockUpdate: {
          previousStock,
          newStock,
          added: request.quantity,
        },
      };
    });
  }

  // Get material statistics
  async getMaterialStatistics(companyId, projectId = null) {
    const where = {
      companyId,
    };

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
      activeAlerts,
    ] = await Promise.all([
      prisma.material.count({ where }),
      prisma.material.count({
        where: {
          ...where,
          stockQuantity: {
            lte: prisma.material.fields.minimumStock,
            gt: 0,
          },
        },
      }),
      prisma.material.count({
        where: {
          ...where,
          stockQuantity: 0,
        },
      }),
      prisma.material.aggregate({
        where,
        _sum: {
          stockQuantity: true,
        },
      }),
      prisma.stockTransaction.findMany({
        where: {
          material: {
            companyId,
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
      prisma.stockAlert.findMany({
        where: {
          material: {
            companyId,
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

    return {
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
      activeAlerts,
    };
  }
}

export default new MaterialService();
