// src/controllers/client.controller.js
import prisma from '../config/database.js';

// Helper function to check client permissions
const checkClientPermission = async (userId, companyId, permissionCode) => {
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

// Create Client
export const createClient = async (req, res) => {
  try {
    const { companyName, contactPerson, email, phone, gstNumber, address } =
      req.body;

    // Check CLIENT_CREATE permission
    const hasPermission = await checkClientPermission(
      req.user.userId,
      req.user.companyId,
      'CLIENT_CREATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create clients',
      });
    }

    // Check if client already exists in the company (by email or phone)
    const existingClient = await prisma.client.findFirst({
      where: {
        OR: [{ email: email || '' }, { phone }],
        companyId: req.user.companyId,
      },
    });

    if (existingClient) {
      return res.status(400).json({
        success: false,
        message: 'Client with similar details already exists in your company',
      });
    }

    // Create client
    const client = await prisma.client.create({
      data: {
        companyName,
        contactPerson,
        email: email || null,
        phone,
        gstNumber: gstNumber || null,
        address: address || null,
        companyId: req.user.companyId,
        createdById: req.user.userId,
        isActive: true,
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'CLIENT_CREATED',
        entityType: 'CLIENT',
        entityId: client.id,
        newData: { companyName, contactPerson, phone },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message: 'Client created successfully',
      data: client,
    });
  } catch (error) {
    console.error('Create client error:', error);

    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'Client with similar details already exists',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get All Clients
export const getAllClients = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', isActive } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check CLIENT_READ permission
    const hasPermission = await checkClientPermission(
      req.user.userId,
      req.user.companyId,
      'CLIENT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view clients',
      });
    }

    const where = {
      companyId: req.user.companyId,
    };

    // Add search filter
    if (search) {
      where.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Add status filter
    if (isActive === 'true' || isActive === 'false') {
      where.isActive = isActive === 'true';
    }

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          _count: {
            select: {
              projects: true,
              invoices: true,
              payments: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.client.count({ where }),
    ]);

    // Format response
    const formattedClients = clients.map((client) => ({
      id: client.id,
      companyName: client.companyName,
      contactPerson: client.contactPerson,
      email: client.email,
      phone: client.phone,
      gstNumber: client.gstNumber,
      address: client.address,
      isActive: client.isActive,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
      createdBy: client.createdBy,
      stats: {
        projects: client._count.projects,
        invoices: client._count.invoices,
        payments: client._count.payments,
      },
    }));

    res.json({
      success: true,
      data: formattedClients,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Client by ID
export const getClientById = async (req, res) => {
  try {
    const { id } = req.params;

    // Check CLIENT_READ permission
    const hasPermission = await checkClientPermission(
      req.user.userId,
      req.user.companyId,
      'CLIENT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view client details',
      });
    }

    const client = await prisma.client.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        projects: {
          select: {
            id: true,
            name: true,
            status: true,
            startDate: true,
            estimatedEndDate: true,
          },
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        invoices: {
          select: {
            id: true,
            invoiceNo: true,
            totalAmount: true,
            status: true,
            issueDate: true,
            dueDate: true,
          },
          take: 10,
          orderBy: { issueDate: 'desc' },
        },
        payments: {
          select: {
            id: true,
            paymentNo: true,
            amount: true,
            paymentDate: true,
            paymentMethod: true,
          },
          take: 10,
          orderBy: { paymentDate: 'desc' },
        },
        _count: {
          select: {
            projects: true,
            invoices: true,
            payments: true,
          },
        },
      },
    });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found',
      });
    }

    res.json({
      success: true,
      data: client,
    });
  } catch (error) {
    console.error('Get client error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update Client
export const updateClient = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Check CLIENT_UPDATE permission
    const hasPermission = await checkClientPermission(
      req.user.userId,
      req.user.companyId,
      'CLIENT_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update clients',
      });
    }

    // Check if client exists and belongs to company
    const client = await prisma.client.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found',
      });
    }

    // Check for duplicate email/phone if updating
    if (updates.email || updates.phone) {
      const existingClient = await prisma.client.findFirst({
        where: {
          OR: [
            ...(updates.email ? [{ email: updates.email }] : []),
            ...(updates.phone ? [{ phone: updates.phone }] : []),
          ],
          companyId: req.user.companyId,
          id: { not: id },
        },
      });

      if (existingClient) {
        return res.status(400).json({
          success: false,
          message: 'Client with similar details already exists in your company',
        });
      }
    }

    const updatedClient = await prisma.client.update({
      where: { id },
      data: updates,
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'CLIENT_UPDATED',
        entityType: 'CLIENT',
        entityId: id,
        oldData: client,
        newData: updatedClient,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Client updated successfully',
      data: updatedClient,
    });
  } catch (error) {
    console.error('Update client error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Delete Client (Soft delete)
export const deleteClient = async (req, res) => {
  try {
    const { id } = req.params;

    // Check CLIENT_DELETE permission
    const hasPermission = await checkClientPermission(
      req.user.userId,
      req.user.companyId,
      'CLIENT_DELETE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete clients',
      });
    }

    // Check if client exists and belongs to company
    const client = await prisma.client.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
      include: {
        _count: {
          select: {
            projects: true,
            invoices: true,
            payments: true,
          },
        },
      },
    });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found',
      });
    }

    // Check if client has related data
    const hasRelatedData =
      client._count.projects > 0 ||
      client._count.invoices > 0 ||
      client._count.payments > 0;

    if (hasRelatedData) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete client with related data. Deactivate instead.',
      });
    }

    await prisma.client.delete({
      where: { id },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'CLIENT_DELETED',
        entityType: 'CLIENT',
        entityId: id,
        oldData: client,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Client deleted successfully',
    });
  } catch (error) {
    console.error('Delete client error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Toggle Client Status (Activate/Deactivate)
export const toggleClientStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive, reason } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isActive must be a boolean',
      });
    }

    // Check CLIENT_UPDATE permission
    const hasPermission = await checkClientPermission(
      req.user.userId,
      req.user.companyId,
      'CLIENT_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update client status',
      });
    }

    // Check if client exists and belongs to company
    const client = await prisma.client.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found',
      });
    }

    const updatedClient = await prisma.client.update({
      where: { id },
      data: { isActive },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: isActive ? 'CLIENT_ACTIVATED' : 'CLIENT_DEACTIVATED',
        entityType: 'CLIENT',
        entityId: id,
        oldData: { isActive: client.isActive },
        newData: { isActive },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: `Client ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: {
        id: updatedClient.id,
        companyName: updatedClient.companyName,
        isActive: updatedClient.isActive,
      },
    });
  } catch (error) {
    console.error('Toggle client status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Client Statistics
export const getClientStatistics = async (req, res) => {
  try {
    const { id } = req.params;

    // Check CLIENT_READ permission
    const hasPermission = await checkClientPermission(
      req.user.userId,
      req.user.companyId,
      'CLIENT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view client statistics',
      });
    }

    const client = await prisma.client.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found',
      });
    }

    const [
      projectStats,
      invoiceStats,
      paymentStats,
      totalSpent,
      activeProjects,
    ] = await Promise.all([
      // Project statistics
      prisma.project.groupBy({
        by: ['status'],
        where: { clientId: id },
        _count: true,
      }),

      // Invoice statistics
      prisma.invoice.groupBy({
        by: ['status'],
        where: { clientId: id },
        _count: true,
        _sum: {
          totalAmount: true,
        },
      }),

      // Payment statistics
      prisma.payment.aggregate({
        where: { clientId: id },
        _sum: {
          amount: true,
        },
        _avg: {
          amount: true,
        },
      }),

      // Total amount spent by client
      prisma.invoice.aggregate({
        where: {
          clientId: id,
          status: { in: ['PAID', 'PARTIALLY_PAID'] },
        },
        _sum: {
          totalAmount: true,
        },
      }),

      // Active projects count
      prisma.project.count({
        where: {
          clientId: id,
          status: { in: ['PLANNING', 'ONGOING'] },
        },
      }),
    ]);

    const statistics = {
      projects: {
        byStatus: projectStats.reduce((acc, item) => {
          acc[item.status] = item._count;
          return acc;
        }, {}),
        total: projectStats.reduce((sum, item) => sum + item._count, 0),
        active: activeProjects,
      },
      invoices: {
        byStatus: invoiceStats.reduce((acc, item) => {
          acc[item.status] = {
            count: item._count,
            amount: item._sum.totalAmount,
          };
          return acc;
        }, {}),
        totalAmount: invoiceStats.reduce(
          (sum, item) => sum + (item._sum.totalAmount || 0),
          0
        ),
      },
      payments: {
        totalAmount: paymentStats._sum.amount || 0,
        averagePayment: paymentStats._avg.amount || 0,
      },
      financials: {
        totalSpent: totalSpent._sum.totalAmount || 0,
        outstandingAmount:
          (invoiceStats.find((i) => i.status === 'ISSUED')?._sum.totalAmount ||
            0) +
          (invoiceStats.find((i) => i.status === 'PARTIALLY_PAID')?._sum
            .totalAmount || 0),
      },
    };

    res.json({
      success: true,
      data: statistics,
    });
  } catch (error) {
    console.error('Get client statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Client Projects
export const getClientProjects = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check CLIENT_READ permission
    const hasPermission = await checkClientPermission(
      req.user.userId,
      req.user.companyId,
      'CLIENT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view client projects',
      });
    }

    const client = await prisma.client.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found',
      });
    }

    const where = {
      clientId: id,
      companyId: req.user.companyId,
    };

    if (status) {
      where.status = status;
    }

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        include: {
          _count: {
            select: {
              tasks: true,
              expenses: true,
              materialRequests: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.project.count({ where }),
    ]);

    // Format projects
    const formattedProjects = projects.map((project) => ({
      id: project.id,
      projectId: project.projectId,
      name: project.name,
      status: project.status,
      priority: project.priority,
      progress: project.progress,
      estimatedBudget: project.estimatedBudget,
      startDate: project.startDate,
      estimatedEndDate: project.estimatedEndDate,
      stats: {
        tasks: project._count.tasks,
        expenses: project._count.expenses,
        materialRequests: project._count.materialRequests,
      },
    }));

    res.json({
      success: true,
      data: formattedProjects,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get client projects error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// FIXED: Get Client Invoices
export const getClientInvoices = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check CLIENT_READ permission
    const hasPermission = await checkClientPermission(
      req.user.userId,
      req.user.companyId,
      'CLIENT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view client invoices',
      });
    }

    const client = await prisma.client.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found',
      });
    }

    // FIXED: Get invoices through project relation
    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where: {
          clientId: id,
          project: {
            companyId: req.user.companyId,
          },
          ...(status && { status }),
        },
        include: {
          project: {
            select: {
              id: true,
              name: true,
              projectId: true,
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
        orderBy: { issueDate: 'desc' },
      }),
      prisma.invoice.count({
        where: {
          clientId: id,
          project: {
            companyId: req.user.companyId,
          },
          ...(status && { status }),
        },
      }),
    ]);

    res.json({
      success: true,
      data: invoices,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get client invoices error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// FIXED: Get Client Payments
export const getClientPayments = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10, paymentMethod } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check CLIENT_READ permission
    const hasPermission = await checkClientPermission(
      req.user.userId,
      req.user.companyId,
      'CLIENT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view client payments',
      });
    }

    const client = await prisma.client.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found',
      });
    }

    // FIXED: Get payments through invoice -> project relation
    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where: {
          clientId: id,
          invoice: {
            project: {
              companyId: req.user.companyId,
            },
          },
          ...(paymentMethod && { paymentMethod }),
        },
        include: {
          invoice: {
            select: {
              id: true,
              invoiceNo: true,
              totalAmount: true,
            },
          },
          receivedBy: {
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
        },
        skip,
        take: parseInt(limit),
        orderBy: { paymentDate: 'desc' },
      }),
      prisma.payment.count({
        where: {
          clientId: id,
          invoice: {
            project: {
              companyId: req.user.companyId,
            },
          },
          ...(paymentMethod && { paymentMethod }),
        },
      }),
    ]);

    res.json({
      success: true,
      data: payments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get client payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
