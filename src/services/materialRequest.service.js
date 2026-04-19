import prisma from '../config/database.js';

class MaterialRequestService {
  // Generate material request number
  async generateRequestNo(companyId) {
    const settings = await prisma.companySettings.findUnique({
      where: { companyId },
    });

    const prefix = settings?.materialPrefix || 'MAT';
    const year = new Date().getFullYear().toString().slice(-2);
    const month = (new Date().getMonth() + 1).toString().padStart(2, '0');

    // Get latest request
    const latestRequest = await prisma.materialRequest.findFirst({
      where: {
        requestNo: {
          startsWith: `${prefix}${year}${month}`,
        },
      },
      orderBy: { requestNo: 'desc' },
      select: { requestNo: true },
    });

    let serial = 1;
    if (latestRequest && latestRequest.requestNo) {
      const lastSerial = parseInt(latestRequest.requestNo.slice(-4)) || 0;
      serial = lastSerial + 1;
    }

    return `${prefix}${year}${month}${serial.toString().padStart(4, '0')}`;
  }

  // Create material request with stock check
  async createMaterialRequest(data) {
    const {
      projectId,
      materialId,
      materialName,
      quantity,
      unit,
      purpose,
      urgency,
      expectedDelivery,
      supplier,
      userId,
      companyId,
    } = data;

    // Check if project exists
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        companyId,
      },
    });

    if (!project) {
      throw new Error('Project not found');
    }

    let material = null;
    let stockCheck = null;

    // If materialId provided, check stock
    if (materialId) {
      material = await prisma.material.findFirst({
        where: {
          id: materialId,
          companyId,
        },
      });

      if (!material) {
        throw new Error('Material not found');
      }

      // Check stock availability
      const availableStock = material.stockQuantity || 0;
      const minimumStock = material.minimumStock || 10;

      stockCheck = {
        availableStock,
        requestedQuantity: quantity,
        minimumStock,
        isAvailable: availableStock >= quantity,
        shortage: Math.max(0, quantity - availableStock),
        isBelowMinimum: availableStock < minimumStock,
      };

      // Don't allow request if stock is available
      if (stockCheck.isAvailable) {
        throw new Error(
          'Material is available in stock. Use existing stock instead of requesting.'
        );
      }
    }

    // Generate request number
    const requestNo = await this.generateRequestNo(companyId);

    // Create request
    const request = await prisma.materialRequest.create({
      data: {
        requestNo,
        projectId,
        materialId: materialId || null,
        materialName:
          materialName || (material ? material.name : 'New Material'),
        quantity,
        unit: unit || (material ? material.unit : 'nos'),
        purpose,
        urgency,
        requestedById: userId,
        status: 'REQUESTED',
        supplier: supplier || null,
        expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : null,
      },
    });

    // Send notifications to approvers
    await this.sendApproverNotifications(request, project, companyId);

    return {
      request,
      stockCheck,
    };
  }

  // Send notifications to approvers
  async sendApproverNotifications(request, project, companyId) {
    const approvers = await prisma.user.findMany({
      where: {
        companyId,
        isActive: true,
        role: {
          rolePermissions: {
            some: {
              permission: {
                code: 'MATERIAL_APPROVE',
              },
            },
          },
        },
      },
      select: { id: true, name: true },
    });

    const notifications = approvers.map((approver) => ({
      userId: approver.id,
      title: 'New Material Request',
      message: `New material request ${request.requestNo} created for project: ${project.name}`,
      type: 'MATERIAL_REQUEST',
      relatedId: request.id,
    }));

    if (notifications.length > 0) {
      await prisma.notification.createMany({
        data: notifications,
      });
    }
  }

  // Get material request statistics
  async getRequestStatistics(
    companyId,
    projectId = null,
    startDate = null,
    endDate = null
  ) {
    const where = {
      project: {
        companyId,
      },
    };

    if (projectId) {
      where.projectId = projectId;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
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
        _sum: {
          quantity: true,
        },
      }),
      prisma.materialRequest.groupBy({
        by: ['urgency'],
        where,
        _count: true,
      }),
      prisma.materialRequest.count({ where }),
      prisma.materialRequest.aggregate({
        where,
        _sum: {
          quantity: true,
        },
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
          project: {
            select: {
              id: true,
              name: true,
            },
          },
          material: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      byStatus: requestsByStatus.reduce((acc, item) => {
        acc[item.status] = {
          count: item._count,
          quantity: item._sum.quantity,
        };
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
  }
}

export default new MaterialRequestService();
