// src/controllers/subcontractor.controller.js
import prisma from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';

// Helper function to check subcontractor permissions
const checkSubcontractorPermission = async (
  userId,
  companyId,
  permissionCode
) => {
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

// Helper to generate contractor ID
const generateContractorId = async (companyId, prefix = 'SC') => {
  const settings = await prisma.companySettings.findUnique({
    where: { companyId },
  });

  const contractorPrefix = prefix;
  const year = new Date().getFullYear().toString().slice(-2);
  const month = (new Date().getMonth() + 1).toString().padStart(2, '0');

  // Get the latest contractor for this company to increment serial
  const latestContractor = await prisma.contractor.findFirst({
    where: {
      companyId,
      contractorId: {
        startsWith: `${contractorPrefix}${year}${month}`,
      },
    },
    orderBy: { contractorId: 'desc' },
    select: { contractorId: true },
  });

  let serial = 1;
  if (latestContractor && latestContractor.contractorId) {
    const lastSerial = parseInt(latestContractor.contractorId.slice(-4)) || 0;
    serial = lastSerial + 1;
  }

  return `${contractorPrefix}${year}${month}${serial.toString().padStart(4, '0')}`;
};

// Create Subcontractor
export const createSubcontractor = async (req, res) => {
  try {
    // Check CONTRACTOR_CREATE permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_CREATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create subcontractors',
      });
    }

    const {
      name,
      type,
      workTypes,
      contactPerson,
      email,
      phone,
      altPhone,
      address,
      registrationNumber,
      gstNumber,
      panNumber,
      aadharNumber,
      bankName,
      bankAccount,
      bankIfsc,
      bankBranch,
      maxWorkers,
      maxMachines,
      hourlyRate,
      dailyRate,
      isVerified,
    } = req.body;

    // Check if phone or email already exists in company
    const existingContractor = await prisma.contractor.findFirst({
      where: {
        companyId: req.user.companyId,
        OR: [{ phone }, ...(email ? [{ email }] : [])],
      },
    });

    if (existingContractor) {
      return res.status(400).json({
        success: false,
        message:
          'Contractor with this phone or email already exists in your company',
      });
    }

    // Generate contractor ID
    const contractorId = await generateContractorId(req.user.companyId);

    // Create subcontractor
    const subcontractor = await prisma.contractor.create({
      data: {
        companyId: req.user.companyId,
        contractorId,
        name,
        type,
        workTypes,
        contactPerson,
        email,
        phone,
        altPhone,
        address,
        registrationNumber,
        gstNumber,
        panNumber,
        aadharNumber,
        bankName,
        bankAccount,
        bankIfsc,
        bankBranch,
        maxWorkers: maxWorkers ? parseInt(maxWorkers) : 10,
        maxMachines: maxMachines ? parseInt(maxMachines) : 5,
        hourlyRate: hourlyRate ? parseFloat(hourlyRate) : null,
        dailyRate: dailyRate ? parseFloat(dailyRate) : null,
        isVerified: isVerified === true || isVerified === 'true',
        status: 'ACTIVE',
        createdById: req.user.userId,
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'CONTRACTOR_CREATED',
        entityType: 'CONTRACTOR',
        entityId: subcontractor.id,
        newData: {
          contractorId: subcontractor.contractorId,
          name: subcontractor.name,
          type: subcontractor.type,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message: 'Subcontractor created successfully',
      data: subcontractor,
    });
  } catch (error) {
    console.error('Create subcontractor error:', error);

    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'Duplicate entry detected',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get All Subcontractors
export const getAllSubcontractors = async (req, res) => {
  try {
    // Check CONTRACTOR_READ permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view subcontractors',
      });
    }

    const {
      page = 1,
      limit = 10,
      search = '',
      type,
      status,
      workType,
      verified,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      companyId: req.user.companyId,
    };

    // Add search filter
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { contractorId: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Add type filter
    if (type) {
      where.type = type;
    }

    // Add status filter
    if (status) {
      where.status = status;
    }

    // Add work type filter
    if (workType) {
      where.workTypes = {
        has: workType,
      };
    }

    // Add verified filter
    if (verified !== undefined) {
      where.isVerified = verified === 'true' || verified === true;
    }

    const [subcontractors, total] = await Promise.all([
      prisma.contractor.findMany({
        where,
        include: {
          _count: {
            select: {
              workers: true,
              projects: true,
              assignments: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.contractor.count({ where }),
    ]);
    console.log('Total subcontractors found:', total);

    // Format response with additional stats
    const formattedSubcontractors = subcontractors.map((contractor) => ({
      ...contractor,
      stats: {
        totalWorkers: contractor._count.workers,
        totalProjects: contractor._count.projects,
        totalAssignments: contractor._count.assignments,
        completionRate:
          contractor.totalProjects > 0
            ? (contractor.completedProjects / contractor.totalProjects) * 100
            : 0,
      },
    }));

    res.json({
      success: true,
      data: formattedSubcontractors,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get subcontractors error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Subcontractor by ID
export const getSubcontractorById = async (req, res) => {
  try {
    const { id } = req.params;

    // Check CONTRACTOR_READ permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view subcontractor details',
      });
    }

    const subcontractor = await prisma.contractor.findFirst({
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
            phone: true,
          },
        },
        workers: {
          where: {
            isActive: true,
          },
          include: {
            currentAssignment: {
              include: {
                contractorProject: {
                  include: {
                    project: {
                      select: {
                        id: true,
                        name: true,
                        projectId: true,
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        projects: {
          include: {
            project: {
              select: {
                id: true,
                name: true,
                projectId: true,
                status: true,
              },
            },
            assignments: {
              include: {
                contractorWorker: {
                  select: {
                    id: true,
                    name: true,
                    skill: true,
                  },
                },
              },
            },
            payments: {
              orderBy: { paymentDate: 'desc' },
              take: 5,
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        reviews: {
          include: {
            project: {
              select: {
                id: true,
                name: true,
              },
            },
            reviewedBy: {
              select: {
                id: true,
                name: true,
                designation: true,
              },
            },
          },
          orderBy: { reviewedAt: 'desc' },
        },
        _count: {
          select: {
            workers: true,
            projects: true,
            assignments: true,
            payments: true,
            reviews: true,
            documents: true,
          },
        },
      },
    });

    if (!subcontractor) {
      return res.status(404).json({
        success: false,
        message: 'Subcontractor not found',
      });
    }

    // Calculate financial summary
    const totalPayments = await prisma.contractorPayment.aggregate({
      where: {
        contractorId: id,
        status: 'PAID',
      },
      _sum: {
        amount: true,
      },
    });

    const pendingPayments = await prisma.contractorPayment.aggregate({
      where: {
        contractorId: id,
        status: 'PENDING',
      },
      _sum: {
        amount: true,
      },
    });

    const financialSummary = {
      totalPaid: totalPayments._sum.amount || 0,
      pendingAmount: pendingPayments._sum.amount || 0,
      totalContractValue: subcontractor.projects.reduce(
        (sum, project) => sum + project.contractAmount,
        0
      ),
    };

    res.json({
      success: true,
      data: {
        ...subcontractor,
        financialSummary,
      },
    });
  } catch (error) {
    console.error('Get subcontractor error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update Subcontractor
export const updateSubcontractor = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Check CONTRACTOR_UPDATE permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update subcontractors',
      });
    }

    // Check if subcontractor exists and belongs to company
    const subcontractor = await prisma.contractor.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!subcontractor) {
      return res.status(404).json({
        success: false,
        message: 'Subcontractor not found',
      });
    }

    // Prevent updating blacklisted status without permission
    if (updates.status === 'BLACKLISTED') {
      const hasBlacklistPermission = await checkSubcontractorPermission(
        req.user.userId,
        req.user.companyId,
        'CONTRACTOR_BLACKLIST'
      );

      if (!hasBlacklistPermission) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to blacklist subcontractors',
        });
      }

      // Set blacklisted date
      updates.blacklistedAt = new Date();
    }

    // Update subcontractor
    const updatedSubcontractor = await prisma.contractor.update({
      where: { id },
      data: updates,
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'CONTRACTOR_UPDATED',
        entityType: 'CONTRACTOR',
        entityId: id,
        oldData: subcontractor,
        newData: updatedSubcontractor,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Subcontractor updated successfully',
      data: updatedSubcontractor,
    });
  } catch (error) {
    console.error('Update subcontractor error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Delete Subcontractor
export const deleteSubcontractor = async (req, res) => {
  try {
    const { id } = req.params;

    // Check CONTRACTOR_DELETE permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_DELETE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete subcontractors',
      });
    }

    // Check if subcontractor exists and belongs to company
    const subcontractor = await prisma.contractor.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!subcontractor) {
      return res.status(404).json({
        success: false,
        message: 'Subcontractor not found',
      });
    }

    // Check if subcontractor has active projects
    const activeProjects = await prisma.contractorProject.count({
      where: {
        contractorId: id,
        status: { not: 'COMPLETED' },
      },
    });

    if (activeProjects > 0) {
      return res.status(400).json({
        success: false,
        message:
          'Cannot delete subcontractor with active projects. Please complete or cancel projects first.',
      });
    }

    // Start transaction to delete related records
    await prisma.$transaction(async (tx) => {
      // Delete related records in order
      await tx.contractorAssignment.deleteMany({
        where: {
          contractorProject: {
            contractorId: id,
          },
        },
      });

      await tx.contractorPayment.deleteMany({
        where: { contractorId: id },
      });

      await tx.contractorReview.deleteMany({
        where: { contractorId: id },
      });

      await tx.contractorDocument.deleteMany({
        where: { contractorId: id },
      });

      await tx.contractorWorker.deleteMany({
        where: { contractorId: id },
      });

      await tx.contractorProject.deleteMany({
        where: { contractorId: id },
      });

      // Delete subcontractor
      await tx.contractor.delete({
        where: { id },
      });
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'CONTRACTOR_DELETED',
        entityType: 'CONTRACTOR',
        entityId: id,
        oldData: subcontractor,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Subcontractor deleted successfully',
    });
  } catch (error) {
    console.error('Delete subcontractor error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Verify Subcontractor
export const verifySubcontractor = async (req, res) => {
  try {
    const { id } = req.params;
    const { verificationNotes, isVerified } = req.body;

    // Check CONTRACTOR_VERIFY permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_VERIFY'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to verify subcontractors',
      });
    }

    // Check if subcontractor exists and belongs to company
    const subcontractor = await prisma.contractor.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!subcontractor) {
      return res.status(404).json({
        success: false,
        message: 'Subcontractor not found',
      });
    }

    const updatedSubcontractor = await prisma.contractor.update({
      where: { id },
      data: {
        isVerified: isVerified === true || isVerified === 'true',
        verificationNotes,
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'CONTRACTOR_VERIFIED',
        entityType: 'CONTRACTOR',
        entityId: id,
        oldData: { isVerified: subcontractor.isVerified },
        newData: { isVerified: updatedSubcontractor.isVerified },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: `Subcontractor ${updatedSubcontractor.isVerified ? 'verified' : 'unverified'} successfully`,
      data: updatedSubcontractor,
    });
  } catch (error) {
    console.error('Verify subcontractor error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Blacklist Subcontractor
export const blacklistSubcontractor = async (req, res) => {
  try {
    const { id } = req.params;
    const { blacklistReason } = req.body;

    // Check CONTRACTOR_BLACKLIST permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_BLACKLIST'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to blacklist subcontractors',
      });
    }

    // Check if subcontractor exists and belongs to company
    const subcontractor = await prisma.contractor.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!subcontractor) {
      return res.status(404).json({
        success: false,
        message: 'Subcontractor not found',
      });
    }

    // Check if subcontractor has active projects
    const activeProjects = await prisma.contractorProject.count({
      where: {
        contractorId: id,
        status: { not: 'COMPLETED' },
      },
    });

    if (activeProjects > 0) {
      return res.status(400).json({
        success: false,
        message:
          'Cannot blacklist subcontractor with active projects. Please complete or cancel projects first.',
      });
    }

    const updatedSubcontractor = await prisma.contractor.update({
      where: { id },
      data: {
        status: 'BLACKLISTED',
        blacklistReason,
        blacklistedAt: new Date(),
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'CONTRACTOR_BLACKLISTED',
        entityType: 'CONTRACTOR',
        entityId: id,
        oldData: { status: subcontractor.status },
        newData: { status: updatedSubcontractor.status },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Subcontractor blacklisted successfully',
      data: updatedSubcontractor,
    });
  } catch (error) {
    console.error('Blacklist subcontractor error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Unblacklist Subcontractor
export const unblacklistSubcontractor = async (req, res) => {
  try {
    const { id } = req.params;

    // Check CONTRACTOR_BLACKLIST permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_BLACKLIST'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message:
          'You do not have permission to manage blacklisted subcontractors',
      });
    }

    // Check if subcontractor exists and belongs to company
    const subcontractor = await prisma.contractor.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        status: 'BLACKLISTED',
      },
    });

    if (!subcontractor) {
      return res.status(404).json({
        success: false,
        message: 'Blacklisted subcontractor not found',
      });
    }

    const updatedSubcontractor = await prisma.contractor.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        blacklistReason: null,
        blacklistedAt: null,
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'CONTRACTOR_UNBLACKLISTED',
        entityType: 'CONTRACTOR',
        entityId: id,
        oldData: { status: subcontractor.status },
        newData: { status: updatedSubcontractor.status },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Subcontractor removed from blacklist successfully',
      data: updatedSubcontractor,
    });
  } catch (error) {
    console.error('Unblacklist subcontractor error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Subcontractor Statistics
export const getSubcontractorStatistics = async (req, res) => {
  try {
    // Check CONTRACTOR_READ permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view subcontractor statistics',
      });
    }

    const [
      totalSubcontractors,
      activeSubcontractors,
      blacklistedSubcontractors,
      verifiedSubcontractors,
      byType,
      byStatus,
      recentSubcontractors,
      topPerformers,
    ] = await Promise.all([
      // Total subcontractors
      prisma.contractor.count({
        where: { companyId: req.user.companyId },
      }),

      // Active subcontractors
      prisma.contractor.count({
        where: {
          companyId: req.user.companyId,
          status: 'ACTIVE',
        },
      }),

      // Blacklisted subcontractors
      prisma.contractor.count({
        where: {
          companyId: req.user.companyId,
          status: 'BLACKLISTED',
        },
      }),

      // Verified subcontractors
      prisma.contractor.count({
        where: {
          companyId: req.user.companyId,
          isVerified: true,
        },
      }),

      // Subcontractors by type
      prisma.contractor.groupBy({
        by: ['type'],
        where: { companyId: req.user.companyId },
        _count: true,
      }),

      // Subcontractors by status
      prisma.contractor.groupBy({
        by: ['status'],
        where: { companyId: req.user.companyId },
        _count: true,
      }),

      // Recent subcontractors (last 7)
      prisma.contractor.findMany({
        where: { companyId: req.user.companyId },
        include: {
          _count: {
            select: {
              projects: true,
              workers: true,
            },
          },
        },
        take: 7,
        orderBy: { createdAt: 'desc' },
      }),

      // Top performers by rating
      prisma.contractor.findMany({
        where: {
          companyId: req.user.companyId,
          rating: { not: null },
        },
        orderBy: { rating: 'desc' },
        take: 5,
        select: {
          id: true,
          name: true,
          rating: true,
          totalProjects: true,
          completedProjects: true,
          type: true,
        },
      }),
    ]);

    const statistics = {
      overview: {
        total: totalSubcontractors,
        active: activeSubcontractors,
        blacklisted: blacklistedSubcontractors,
        verified: verifiedSubcontractors,
      },
      byType: byType.reduce((acc, item) => {
        acc[item.type] = item._count;
        return acc;
      }, {}),
      byStatus: byStatus.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {}),
      recent: recentSubcontractors,
      topPerformers,
    };

    res.json({
      success: true,
      data: statistics,
    });
  } catch (error) {
    console.error('Get subcontractor statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Subcontractors by Work Type
export const getSubcontractorsByWorkType = async (req, res) => {
  try {
    const { workType } = req.params;

    // Check CONTRACTOR_READ permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view subcontractors',
      });
    }

    const subcontractors = await prisma.contractor.findMany({
      where: {
        companyId: req.user.companyId,
        workTypes: {
          has: workType,
        },
        status: 'ACTIVE',
      },
      include: {
        _count: {
          select: {
            workers: true,
            projects: {
              where: {
                workType: workType,
              },
            },
          },
        },
      },
      orderBy: { rating: 'desc' },
    });

    res.json({
      success: true,
      data: subcontractors,
      workType,
      total: subcontractors.length,
    });
  } catch (error) {
    console.error('Get subcontractors by work type error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Add these functions to your existing subcontractor controller

// Add Contractor Worker
// Add Subcontractor Worker
export const addSubcontractorWorker = async (req, res) => {
  try {
    const { subcontractorId } = req.params; // Changed from contractorId to subcontractorId
    const {
      name,
      phone,
      aadharNumber,
      skillSet,
      experience,
      wageType,
      wageRate,
      alternatePhone,
      dateOfBirth,
      emergencyContact,
      emergencyPhone,
      notes,
    } = req.body;

    // Check CONTRACTOR_WORKER_CREATE permission (keeping same permission name for consistency)
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_WORKER_CREATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to add subcontractor workers',
      });
    }

    // Check if subcontractor exists and belongs to company
    const subcontractor = await prisma.contractor.findFirst({
      where: {
        id: subcontractorId,
        companyId: req.user.companyId,
      },
    });

    if (!subcontractor) {
      return res.status(404).json({
        success: false,
        message: 'Subcontractor not found',
      });
    }

    // Check max workers limit
    if (subcontractor.maxWorkers) {
      const currentWorkersCount = await prisma.subcontractorWorker.count({
        where: {
          contractorId: subcontractorId,
          isActive: true,
        },
      });

      if (currentWorkersCount >= subcontractor.maxWorkers) {
        return res.status(400).json({
          success: false,
          message: `Maximum workers limit (${subcontractor.maxWorkers}) reached for this subcontractor`,
        });
      }
    }

    // Check if worker with same phone already exists for this subcontractor
    if (phone) {
      const existingWorker = await prisma.subcontractorWorker.findFirst({
        where: {
          contractorId: subcontractorId,
          phone,
        },
      });

      if (existingWorker) {
        return res.status(400).json({
          success: false,
          message:
            'Worker with this phone already exists for this subcontractor',
        });
      }
    }

    // Check if worker with same aadhar number exists
    if (aadharNumber) {
      const existingAadhar = await prisma.subcontractorWorker.findFirst({
        where: {
          contractorId: subcontractorId,
          aadharNumber,
        },
      });

      if (existingAadhar) {
        return res.status(400).json({
          success: false,
          message:
            'Worker with this Aadhar number already exists for this subcontractor',
        });
      }
    }

    // Generate worker ID
    const workerId = `SW-${Date.now().toString().slice(-8)}-${Math.floor(Math.random() * 1000)}`;

    // Create worker using SubcontractorWorker model
    const worker = await prisma.subcontractorWorker.create({
      data: {
        contractorId: subcontractorId,
        workerId,
        name,
        phone,
        alternatePhone,
        aadharNumber,
        skillSet: Array.isArray(skillSet)
          ? skillSet
          : skillSet
            ? [skillSet]
            : [],
        experience: experience ? parseInt(experience) : null,
        wageType: wageType || 'DAILY',
        wageRate: parseFloat(wageRate),
        overtimeRate: 1.5, // Default overtime rate
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        emergencyContact,
        emergencyPhone,
        notes,
        isAvailable: true,
        isActive: true,
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'SUBCONTRACTOR_WORKER_CREATED',
        entityType: 'SUBCONTRACTOR_WORKER',
        entityId: worker.id,
        newData: {
          workerId: worker.workerId,
          name: worker.name,
          skillSet: worker.skillSet,
          wageRate: worker.wageRate,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message: 'Subcontractor worker added successfully',
      data: worker,
    });
  } catch (error) {
    console.error('Add subcontractor worker error:', error);

    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'Duplicate entry detected',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Subcontractor Workers
export const getSubcontractorWorkers = async (req, res) => {
  try {
    const { subcontractorId } = req.params; // Changed from contractorId to subcontractorId
    const { page = 1, limit = 10, search = '', status, skill } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check CONTRACTOR_WORKER_READ permission (keeping same permission name for consistency)
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_WORKER_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view subcontractor workers',
      });
    }

    // Check if subcontractor exists and belongs to company
    const subcontractor = await prisma.contractor.findFirst({
      where: {
        id: subcontractorId,
        companyId: req.user.companyId,
      },
    });

    if (!subcontractor) {
      return res.status(404).json({
        success: false,
        message: 'Subcontractor not found',
      });
    }

    const where = {
      contractorId: subcontractorId,
    };

    // Add search filter
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { workerId: { contains: search, mode: 'insensitive' } },
        { aadharNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Add skill filter
    if (skill) {
      where.skillSet = {
        has: skill,
      };
    }

    // Add status filter
    if (status === 'active') {
      where.isActive = true;
    } else if (status === 'inactive') {
      where.isActive = false;
    } else if (status === 'available') {
      where.isAvailable = true;
      where.isActive = true;
    } else if (status === 'assigned') {
      where.isAvailable = false;
      where.isActive = true;
    }

    const [workers, total] = await Promise.all([
      prisma.subcontractorWorker.findMany({
        where,
        include: {
          contractor: {
            select: {
              id: true,
              name: true,
              contractorId: true,
            },
          },
          currentAssignment: {
            include: {
              contractorProject: {
                include: {
                  project: {
                    select: {
                      id: true,
                      name: true,
                      projectId: true,
                      location: true,
                    },
                  },
                },
              },
            },
          },
          _count: {
            select: {
              attendances: true,
              subtaskAssignments: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { name: 'asc' },
      }),
      prisma.subcontractorWorker.count({ where }),
    ]);

    // Get today's attendance for each worker
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const workersWithAttendance = await Promise.all(
      workers.map(async (worker) => {
        const todayAttendance = await prisma.workerAttendance.findFirst({
          where: {
            workerType: 'SUBCONTRACTOR',
            subcontractorWorkerId: worker.id,
            date: {
              gte: today,
              lt: tomorrow,
            },
          },
          select: {
            id: true,
            status: true,
            checkInTime: true,
            checkOutTime: true,
            totalHours: true,
            project: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });

        // Calculate stats
        const totalAttendances = worker._count.attendances;
        const presentAttendances = await prisma.workerAttendance.count({
          where: {
            workerType: 'SUBCONTRACTOR',
            subcontractorWorkerId: worker.id,
            status: 'PRESENT',
          },
        });

        return {
          ...worker,
          todayAttendance,
          stats: {
            totalAttendances,
            presentAttendances,
            attendanceRate:
              totalAttendances > 0
                ? Math.round((presentAttendances / totalAttendances) * 100)
                : 0,
          },
        };
      })
    );

    res.json({
      success: true,
      data: workersWithAttendance,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get subcontractor workers error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Create Contractor Project
export const createContractorProject = async (req, res) => {
  try {
    const { contractorId, projectId } = req.params;
    const {
      title,
      description,
      workType,
      scopeOfWork,
      terms,
      startDate,
      endDate,
      estimatedDuration,
      contractAmount,
      advanceAmount,
      retentionAmount,
      paymentTerms,
    } = req.body;

    // Check CONTRACTOR_PROJECT_CREATE permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_PROJECT_CREATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create contractor projects',
      });
    }

    // Check if contractor exists and belongs to company
    const contractor = await prisma.contractor.findFirst({
      where: {
        id: contractorId,
        companyId: req.user.companyId,
      },
    });

    if (!contractor) {
      return res.status(404).json({
        success: false,
        message: 'Contractor not found',
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

    // Check if contractor is already assigned to this project
    const existingAssignment = await prisma.contractorProject.findFirst({
      where: {
        projectId,
        contractorId,
      },
    });

    if (existingAssignment) {
      return res.status(400).json({
        success: false,
        message: 'Contractor is already assigned to this project',
      });
    }

    // Check if contractor has the required work type
    if (!contractor.workTypes.includes(workType)) {
      return res.status(400).json({
        success: false,
        message: `Contractor does not have ${workType} in their work types`,
      });
    }

    // Generate project code
    const projectCode = `SC-PROJ-${Date.now().toString().slice(-6)}`;

    // Create contractor project
    const contractorProject = await prisma.contractorProject.create({
      data: {
        companyId: req.user.companyId,
        projectId,
        contractorId,
        projectCode,
        title,
        description,
        workType,
        scopeOfWork,
        terms,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        estimatedDuration: estimatedDuration
          ? parseInt(estimatedDuration)
          : null,
        contractAmount: parseFloat(contractAmount),
        advanceAmount: advanceAmount ? parseFloat(advanceAmount) : 0,
        retentionAmount: retentionAmount ? parseFloat(retentionAmount) : 0,
        paymentTerms,
        status: 'TODO',
        progress: 0,
        isCompleted: false,
        createdById: req.user.userId,
      },
    });

    // Update contractor stats
    await prisma.contractor.update({
      where: { id: contractorId },
      data: {
        totalProjects: { increment: 1 },
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'CONTRACTOR_PROJECT_CREATED',
        entityType: 'CONTRACTOR_PROJECT',
        entityId: contractorProject.id,
        newData: {
          projectCode: contractorProject.projectCode,
          title: contractorProject.title,
          contractAmount: contractorProject.contractAmount,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message: 'Contractor project created successfully',
      data: contractorProject,
    });
  } catch (error) {
    console.error('Create contractor project error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Create Work Assignment
export const createWorkAssignment = async (req, res) => {
  try {
    const { contractorProjectId } = req.params;
    const {
      contractorWorkerId,
      assignmentDate,
      startDate,
      endDate,
      workDescription,
      location,
      supervisorId,
      estimatedHours,
    } = req.body;

    // Check CONTRACTOR_ASSIGNMENT_CREATE permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_ASSIGNMENT_CREATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create work assignments',
      });
    }

    // Check if contractor project exists
    const contractorProject = await prisma.contractorProject.findFirst({
      where: {
        id: contractorProjectId,
        companyId: req.user.companyId,
      },
      include: {
        contractor: true,
      },
    });

    if (!contractorProject) {
      return res.status(404).json({
        success: false,
        message: 'Contractor project not found',
      });
    }

    // Check if worker belongs to this contractor
    const worker = await prisma.contractorWorker.findFirst({
      where: {
        id: contractorWorkerId,
        contractorId: contractorProject.contractorId,
        isActive: true,
      },
    });

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found or not active',
      });
    }

    // Check if worker is already assigned on this date
    const existingAssignment = await prisma.contractorAssignment.findFirst({
      where: {
        contractorWorkerId,
        assignmentDate: new Date(assignmentDate),
      },
    });

    if (existingAssignment) {
      return res.status(400).json({
        success: false,
        message: 'Worker is already assigned on this date',
      });
    }

    // Check supervisor if provided
    if (supervisorId) {
      const supervisor = await prisma.user.findFirst({
        where: {
          id: supervisorId,
          companyId: req.user.companyId,
        },
      });

      if (!supervisor) {
        return res.status(404).json({
          success: false,
          message: 'Supervisor not found',
        });
      }
    }

    // Calculate wage amount if estimated hours provided
    let wageAmount = null;
    if (estimatedHours && worker.wageRate) {
      if (worker.wageType === 'HOURLY') {
        wageAmount = worker.wageRate * estimatedHours;
      } else if (worker.wageType === 'DAILY') {
        wageAmount = worker.wageRate; // Daily rate regardless of hours
      }
    }

    // Create assignment
    const assignment = await prisma.contractorAssignment.create({
      data: {
        contractorProjectId,
        contractorWorkerId,
        assignmentDate: new Date(assignmentDate),
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        workDescription,
        location,
        supervisorId,
        estimatedHours: estimatedHours ? parseFloat(estimatedHours) : null,
        wageAmount,
        status: 'TODO',
        isCompleted: false,
        isVerified: false,
      },
    });

    // Update worker availability
    await prisma.contractorWorker.update({
      where: { id: contractorWorkerId },
      data: {
        isAvailable: false,
        currentAssignmentId: assignment.id,
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'CONTRACTOR_ASSIGNMENT_CREATED',
        entityType: 'CONTRACTOR_ASSIGNMENT',
        entityId: assignment.id,
        newData: {
          assignmentDate: assignment.assignmentDate,
          workerId: worker.id,
          workerName: worker.name,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message: 'Work assignment created successfully',
      data: assignment,
    });
  } catch (error) {
    console.error('Create work assignment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Verify Work Completion
export const verifyWorkCompletion = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { actualHours, completionNotes, isCompleted, verificationNotes } =
      req.body;

    // Check CONTRACTOR_ASSIGNMENT_VERIFY permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_ASSIGNMENT_VERIFY'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to verify work completion',
      });
    }

    // Check if assignment exists
    const assignment = await prisma.contractorAssignment.findFirst({
      where: {
        id: assignmentId,
        contractorProject: {
          companyId: req.user.companyId,
        },
      },
      include: {
        contractorWorker: true,
        contractorProject: true,
      },
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found',
      });
    }

    // Calculate final wage amount if actual hours provided
    let wageAmount = assignment.wageAmount;
    if (actualHours && assignment.contractorWorker.wageRate) {
      if (assignment.contractorWorker.wageType === 'HOURLY') {
        wageAmount = assignment.contractorWorker.wageRate * actualHours;
      }
    }

    // Update assignment
    const updatedAssignment = await prisma.contractorAssignment.update({
      where: { id: assignmentId },
      data: {
        actualHours: actualHours
          ? parseFloat(actualHours)
          : assignment.actualHours,
        wageAmount,
        status: isCompleted ? 'COMPLETED' : assignment.status,
        isCompleted: isCompleted === true || isCompleted === 'true',
        completedAt: isCompleted ? new Date() : assignment.completedAt,
        completionNotes,
        isVerified: true,
        verifiedById: req.user.userId,
        verificationNotes,
      },
    });

    // Update worker availability if work is completed
    if (isCompleted) {
      await prisma.contractorWorker.update({
        where: { id: assignment.contractorWorkerId },
        data: {
          isAvailable: true,
          currentAssignmentId: null,
        },
      });
    }

    // Update contractor project progress
    if (isCompleted) {
      // Calculate progress based on completed assignments
      const totalAssignments = await prisma.contractorAssignment.count({
        where: {
          contractorProjectId: assignment.contractorProjectId,
        },
      });

      const completedAssignments = await prisma.contractorAssignment.count({
        where: {
          contractorProjectId: assignment.contractorProjectId,
          isCompleted: true,
        },
      });

      const progress =
        totalAssignments > 0
          ? Math.round((completedAssignments / totalAssignments) * 100)
          : 0;

      await prisma.contractorProject.update({
        where: { id: assignment.contractorProjectId },
        data: {
          progress,
          isCompleted: progress === 100,
          completedAt: progress === 100 ? new Date() : null,
          status: progress === 100 ? 'COMPLETED' : 'IN_PROGRESS',
        },
      });

      // Update contractor completed projects count
      if (progress === 100) {
        await prisma.contractor.update({
          where: { id: assignment.contractorProject.contractorId },
          data: {
            completedProjects: { increment: 1 },
          },
        });
      }
    }

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'WORK_COMPLETION_VERIFIED',
        entityType: 'CONTRACTOR_ASSIGNMENT',
        entityId: assignmentId,
        oldData: {
          isCompleted: assignment.isCompleted,
          isVerified: assignment.isVerified,
        },
        newData: {
          isCompleted: updatedAssignment.isCompleted,
          isVerified: updatedAssignment.isVerified,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Work completion verified successfully',
      data: updatedAssignment,
    });
  } catch (error) {
    console.error('Verify work completion error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Create Contractor Payment
export const createContractorPayment = async (req, res) => {
  try {
    const { contractorProjectId } = req.params;
    const {
      amount,
      paymentDate,
      paymentMethod,
      description,
      periodFrom,
      periodTo,
      reference,
      transactionId,
    } = req.body;

    // Check CONTRACTOR_PAYMENT_CREATE permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_PAYMENT_CREATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create contractor payments',
      });
    }

    // Check if contractor project exists
    const contractorProject = await prisma.contractorProject.findFirst({
      where: {
        id: contractorProjectId,
        companyId: req.user.companyId,
      },
      include: {
        contractor: true,
        project: true,
      },
    });

    if (!contractorProject) {
      return res.status(404).json({
        success: false,
        message: 'Contractor project not found',
      });
    }

    // Generate payment number
    const paymentNo = `SC-PAY-${Date.now().toString().slice(-8)}`;

    // Calculate total payments made so far
    const totalPayments = await prisma.contractorPayment.aggregate({
      where: {
        contractorProjectId,
        status: 'PAID',
      },
      _sum: {
        amount: true,
      },
    });

    const totalPaid = totalPayments._sum.amount || 0;
    const remainingAmount = contractorProject.contractAmount - totalPaid;

    // Check if payment amount exceeds remaining amount
    if (amount > remainingAmount) {
      return res.status(400).json({
        success: false,
        message: `Payment amount exceeds remaining amount. Remaining: ${remainingAmount}`,
      });
    }

    // Create payment
    const payment = await prisma.contractorPayment.create({
      data: {
        contractorProjectId,
        contractorId: contractorProject.contractorId,
        paymentNo,
        reference,
        amount: parseFloat(amount),
        paymentDate: new Date(paymentDate),
        paymentMethod,
        description,
        periodFrom: periodFrom ? new Date(periodFrom) : null,
        periodTo: periodTo ? new Date(periodTo) : null,
        transactionId,
        status: 'PENDING',
        isProcessed: false,
        createdById: req.user.userId,
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'CONTRACTOR_PAYMENT_CREATED',
        entityType: 'CONTRACTOR_PAYMENT',
        entityId: payment.id,
        newData: {
          paymentNo: payment.paymentNo,
          amount: payment.amount,
          contractorName: contractorProject.contractor.name,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message: 'Contractor payment created successfully',
      data: payment,
      paymentSummary: {
        totalContractAmount: contractorProject.contractAmount,
        totalPaidSoFar: totalPaid,
        thisPayment: amount,
        remainingAfterPayment: remainingAmount - amount,
      },
    });
  } catch (error) {
    console.error('Create contractor payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Approve Contractor Payment
export const approveContractorPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { isProcessed } = req.body;

    // Check CONTRACTOR_PAYMENT_APPROVE permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_PAYMENT_APPROVE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to approve contractor payments',
      });
    }

    // Check if payment exists
    const payment = await prisma.contractorPayment.findFirst({
      where: {
        id: paymentId,
        contractorProject: {
          companyId: req.user.companyId,
        },
      },
      include: {
        contractor: true,
        contractorProject: true,
      },
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    // Update payment
    const updatedPayment = await prisma.contractorPayment.update({
      where: { id: paymentId },
      data: {
        status: isProcessed ? 'PAID' : payment.status,
        isProcessed: isProcessed === true || isProcessed === 'true',
        processedAt: isProcessed ? new Date() : payment.processedAt,
        approvedById: req.user.userId,
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'CONTRACTOR_PAYMENT_APPROVED',
        entityType: 'CONTRACTOR_PAYMENT',
        entityId: paymentId,
        oldData: {
          status: payment.status,
          isProcessed: payment.isProcessed,
        },
        newData: {
          status: updatedPayment.status,
          isProcessed: updatedPayment.isProcessed,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    // Send notification to payment creator
    if (payment.createdById && payment.createdById !== req.user.userId) {
      await prisma.notification.create({
        data: {
          userId: payment.createdById,
          title: 'Payment Approved',
          message: `Payment ${payment.paymentNo} for ${payment.contractor.name} has been approved`,
          type: 'PAYMENT',
          relatedId: paymentId,
        },
      });
    }

    res.json({
      success: true,
      message: `Payment ${isProcessed ? 'approved and marked as processed' : 'status updated'}`,
      data: updatedPayment,
    });
  } catch (error) {
    console.error('Approve contractor payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Process Contractor Payment (Finance department)
export const processContractorPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { transactionId, invoiceCopy, receiptCopy } = req.body;

    // Check CONTRACTOR_PAYMENT_PROCESS permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_PAYMENT_PROCESS'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to process contractor payments',
      });
    }

    // Check if payment exists and is approved
    const payment = await prisma.contractorPayment.findFirst({
      where: {
        id: paymentId,
        contractorProject: {
          companyId: req.user.companyId,
        },
        status: 'PAID',
      },
      include: {
        contractor: true,
      },
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found or not approved for processing',
      });
    }

    // Update payment with processing details
    const updatedPayment = await prisma.contractorPayment.update({
      where: { id: paymentId },
      data: {
        transactionId: transactionId || payment.transactionId,
        invoiceCopy,
        receiptCopy,
        isProcessed: true,
        processedAt: new Date(),
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'CONTRACTOR_PAYMENT_PROCESSED',
        entityType: 'CONTRACTOR_PAYMENT',
        entityId: paymentId,
        newData: {
          transactionId: updatedPayment.transactionId,
          processedAt: updatedPayment.processedAt,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Payment processed successfully',
      data: updatedPayment,
    });
  } catch (error) {
    console.error('Process contractor payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Contractor Payments
export const getContractorPayments = async (req, res) => {
  try {
    const { contractorId } = req.params;
    const { page = 1, limit = 10, status, startDate, endDate } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check CONTRACTOR_PAYMENT_READ permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_PAYMENT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view contractor payments',
      });
    }

    // Check if contractor exists
    const contractor = await prisma.contractor.findFirst({
      where: {
        id: contractorId,
        companyId: req.user.companyId,
      },
    });

    if (!contractor) {
      return res.status(404).json({
        success: false,
        message: 'Contractor not found',
      });
    }

    const where = {
      contractorId,
    };

    // Add status filter
    if (status) {
      where.status = status;
    }

    // Add date range filter
    if (startDate || endDate) {
      where.paymentDate = {};
      if (startDate) where.paymentDate.gte = new Date(startDate);
      if (endDate) where.paymentDate.lte = new Date(endDate);
    }

    const [payments, total] = await Promise.all([
      prisma.contractorPayment.findMany({
        where,
        include: {
          contractorProject: {
            include: {
              project: {
                select: {
                  id: true,
                  name: true,
                  projectId: true,
                },
              },
            },
          },
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
              email: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { paymentDate: 'desc' },
      }),
      prisma.contractorPayment.count({ where }),
    ]);

    // Calculate financial summary
    const summary = await prisma.contractorPayment.aggregate({
      where: {
        contractorId,
      },
      _sum: {
        amount: true,
      },
      _count: true,
    });

    const byStatus = await prisma.contractorPayment.groupBy({
      by: ['status'],
      where: {
        contractorId,
      },
      _sum: {
        amount: true,
      },
      _count: true,
    });

    const statusSummary = byStatus.reduce((acc, item) => {
      acc[item.status] = {
        amount: item._sum.amount || 0,
        count: item._count,
      };
      return acc;
    }, {});

    res.json({
      success: true,
      data: payments,
      summary: {
        totalAmount: summary._sum.amount || 0,
        totalCount: summary._count,
        byStatus: statusSummary,
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get contractor payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Create Contractor Review
export const createContractorReview = async (req, res) => {
  try {
    const { contractorId, projectId } = req.params;
    const {
      rating,
      quality,
      timeliness,
      communication,
      safety,
      title,
      review,
      pros,
      cons,
    } = req.body;

    // Check CONTRACTOR_REVIEW_CREATE permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_REVIEW_CREATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create contractor reviews',
      });
    }

    // Check if contractor exists
    const contractor = await prisma.contractor.findFirst({
      where: {
        id: contractorId,
        companyId: req.user.companyId,
      },
    });

    if (!contractor) {
      return res.status(404).json({
        success: false,
        message: 'Contractor not found',
      });
    }

    // Check if project exists
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

    // Check if contractor worked on this project
    const contractorProject = await prisma.contractorProject.findFirst({
      where: {
        contractorId,
        projectId,
        status: 'COMPLETED',
      },
    });

    if (!contractorProject) {
      return res.status(400).json({
        success: false,
        message: 'Contractor has not completed work on this project',
      });
    }

    // Check if user already reviewed this contractor for this project
    const existingReview = await prisma.contractorReview.findFirst({
      where: {
        contractorId,
        projectId,
        reviewedById: req.user.userId,
      },
    });

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: 'You have already reviewed this contractor for this project',
      });
    }

    // Create review
    const contractorReview = await prisma.contractorReview.create({
      data: {
        contractorId,
        projectId,
        rating: parseInt(rating),
        quality: quality ? parseInt(quality) : null,
        timeliness: timeliness ? parseInt(timeliness) : null,
        communication: communication ? parseInt(communication) : null,
        safety: safety ? parseInt(safety) : null,
        title,
        review,
        pros: pros || [],
        cons: cons || [],
        reviewedById: req.user.userId,
        isApproved: false, // Needs approval from manager
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'CONTRACTOR_REVIEW_CREATED',
        entityType: 'CONTRACTOR_REVIEW',
        entityId: contractorReview.id,
        newData: {
          rating: contractorReview.rating,
          contractorName: contractor.name,
          projectName: project.name,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message: 'Contractor review created successfully. Waiting for approval.',
      data: contractorReview,
    });
  } catch (error) {
    console.error('Create contractor review error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Approve Contractor Review
export const approveContractorReview = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { isApproved } = req.body;

    // Check CONTRACTOR_REVIEW_APPROVE permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_REVIEW_APPROVE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to approve contractor reviews',
      });
    }

    // Check if review exists
    const review = await prisma.contractorReview.findFirst({
      where: {
        id: reviewId,
        project: {
          companyId: req.user.companyId,
        },
      },
      include: {
        contractor: true,
        project: true,
      },
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found',
      });
    }

    // Update review
    const updatedReview = await prisma.contractorReview.update({
      where: { id: reviewId },
      data: {
        isApproved: isApproved === true || isApproved === 'true',
        approvedById: req.user.userId,
      },
    });

    // If approved, update contractor rating
    if (isApproved && !review.isApproved) {
      // Get all approved reviews for this contractor
      const approvedReviews = await prisma.contractorReview.findMany({
        where: {
          contractorId: review.contractorId,
          isApproved: true,
          rating: { not: null },
        },
        select: {
          rating: true,
          quality: true,
          timeliness: true,
          communication: true,
          safety: true,
        },
      });

      if (approvedReviews.length > 0) {
        // Calculate average ratings
        const avgRating =
          approvedReviews.reduce((sum, r) => sum + r.rating, 0) /
          approvedReviews.length;

        // Calculate other metrics if available
        const qualityReviews = approvedReviews.filter(
          (r) => r.quality !== null
        );
        const avgQuality =
          qualityReviews.length > 0
            ? qualityReviews.reduce((sum, r) => sum + r.quality, 0) /
              qualityReviews.length
            : null;

        const timelinessReviews = approvedReviews.filter(
          (r) => r.timeliness !== null
        );
        const avgTimeliness =
          timelinessReviews.length > 0
            ? timelinessReviews.reduce((sum, r) => sum + r.timeliness, 0) /
              timelinessReviews.length
            : null;

        const communicationReviews = approvedReviews.filter(
          (r) => r.communication !== null
        );
        const avgCommunication =
          communicationReviews.length > 0
            ? communicationReviews.reduce(
                (sum, r) => sum + r.communication,
                0
              ) / communicationReviews.length
            : null;

        const safetyReviews = approvedReviews.filter((r) => r.safety !== null);
        const avgSafety =
          safetyReviews.length > 0
            ? safetyReviews.reduce((sum, r) => sum + r.safety, 0) /
              safetyReviews.length
            : null;

        // Update contractor with new ratings
        await prisma.contractor.update({
          where: { id: review.contractorId },
          data: {
            rating: parseFloat(avgRating.toFixed(1)),
          },
        });
      }
    }

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'CONTRACTOR_REVIEW_APPROVED',
        entityType: 'CONTRACTOR_REVIEW',
        entityId: reviewId,
        oldData: { isApproved: review.isApproved },
        newData: { isApproved: updatedReview.isApproved },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    // Notify the reviewer
    if (review.reviewedById !== req.user.userId) {
      await prisma.notification.create({
        data: {
          userId: review.reviewedById,
          title: 'Review Approved',
          message: `Your review for ${review.contractor.name} has been ${isApproved ? 'approved' : 'rejected'}`,
          type: 'REVIEW',
          relatedId: reviewId,
        },
      });
    }

    res.json({
      success: true,
      message: `Review ${isApproved ? 'approved' : 'rejected'} successfully`,
      data: updatedReview,
    });
  } catch (error) {
    console.error('Approve contractor review error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Contractor Projects
export const getContractorProjectsByContractorId = async (req, res) => {
  try {
    const { contractorId } = req.params;
    const {
      page = 1,
      limit = 10,
      search = '',
      status,
      workType,
      startDate,
      endDate,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check CONTRACTOR_PROJECT_READ permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_PROJECT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view contractor projects',
      });
    }

    // Check if contractor exists
    const contractor = await prisma.contractor.findFirst({
      where: {
        id: contractorId,
        companyId: req.user.companyId,
      },
    });

    if (!contractor) {
      return res.status(404).json({
        success: false,
        message: 'Contractor not found',
      });
    }

    const where = {
      contractorId,
    };

    // Add search filter
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { projectCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Add status filter
    if (status) {
      where.status = status;
    }

    // Add work type filter
    if (workType) {
      where.workType = workType;
    }

    // Add date range filter
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [projects, total] = await Promise.all([
      prisma.contractorProject.findMany({
        where,
        include: {
          project: {
            select: {
              id: true,
              name: true,
              projectId: true,
              location: true,
            },
          },
          assignments: {
            include: {
              contractorWorker: {
                select: {
                  id: true,
                  name: true,
                  skill: true,
                },
              },
            },
          },
          payments: {
            orderBy: { paymentDate: 'desc' },
            take: 3,
          },
          _count: {
            select: {
              assignments: true,
              payments: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.contractorProject.count({ where }),
    ]);

    // Calculate project statistics
    const stats = await prisma.contractorProject.aggregate({
      where: {
        contractorId,
      },
      _sum: {
        contractAmount: true,
      },
      _count: true,
    });

    const statusStats = await prisma.contractorProject.groupBy({
      by: ['status'],
      where: {
        contractorId,
      },
      _sum: {
        contractAmount: true,
      },
      _count: true,
    });

    const statusSummary = statusStats.reduce((acc, item) => {
      acc[item.status] = {
        amount: item._sum.contractAmount || 0,
        count: item._count,
      };
      return acc;
    }, {});

    res.json({
      success: true,
      data: projects,
      summary: {
        totalAmount: stats._sum.contractAmount || 0,
        totalCount: stats._count,
        byStatus: statusSummary,
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get contractor projects error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getContractorProjectsByProjectId = async (req, res) => {
  try {
    const { projectId } = req.params;
    const {
      page = 1,
      limit = 10,
      search = '',
      status,
      workType,
      startDate,
      endDate,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check CONTRACTOR_PROJECT_READ permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_PROJECT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view contractor projects',
      });
    }

    // Check if contractor exists
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        companyId: req.user.companyId,
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Contractor not found',
      });
    }

    const where = {
      projectId: projectId,
    };

    // Add search filter
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { projectCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Add status filter
    if (status) {
      where.status = status;
    }

    // Add work type filter
    if (workType) {
      where.workType = workType;
    }

    // Add date range filter
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [projects, total] = await Promise.all([
      prisma.contractorProject.findMany({
        where,
        include: {
          contractor: {
            select: {
              id: true,
              name: true,
              contactPerson: true,
              type: true,
            },
          },
          project: {
            select: {
              id: true,
              name: true,
              projectId: true,
              location: true,
            },
          },
          assignments: {
            include: {
              contractorWorker: {
                select: {
                  id: true,
                  name: true,
                  skill: true,
                },
              },
            },
          },
          payments: {
            orderBy: { paymentDate: 'desc' },
            take: 3,
          },
          _count: {
            select: {
              assignments: true,
              payments: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.contractorProject.count({ where }),
    ]);

    // Calculate project statistics
    const stats = await prisma.contractorProject.aggregate({
      where: {
        projectId: projectId,
      },
      _sum: {
        contractAmount: true,
      },
      _count: true,
    });

    const statusStats = await prisma.contractorProject.groupBy({
      by: ['status'],
      where: {
        projectId: projectId,
      },
      _sum: {
        contractAmount: true,
      },
      _count: true,
    });

    const statusSummary = statusStats.reduce((acc, item) => {
      acc[item.status] = {
        amount: item._sum.contractAmount || 0,
        count: item._count,
      };
      return acc;
    }, {});

    res.json({
      success: true,
      data: projects,
      summary: {
        totalAmount: stats._sum.contractAmount || 0,
        totalCount: stats._count,
        byStatus: statusSummary,
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get contractor projects error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Contractor Project by ID (Simplified - searches by contractor project ID only)
export const getContractorProjectById = async (req, res) => {
  try {
    const { contractorProjectId } = req.params;

    console.log(
      'DEBUG: Getting contractor project by ID:',
      contractorProjectId
    );
    console.log('DEBUG: User company ID:', req.user.companyId);

    // Check CONTRACTOR_PROJECT_READ permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_PROJECT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message:
          'You do not have permission to view contractor project details',
      });
    }

    // Search by contractor project ID
    const contractorProject = await prisma.contractorProject.findFirst({
      where: {
        id: contractorProjectId, // This searches by contractor project's own ID
        companyId: req.user.companyId,
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            projectId: true,
            location: true,
            description: true,
            client: {
              select: {
                id: true,
                companyName: true,
                contactPerson: true,
              },
            },
          },
        },
        contractor: {
          select: {
            id: true,
            name: true,
            contactPerson: true,
            phone: true,
            email: true,
            rating: true,
          },
        },
        assignments: {
          include: {
            contractorWorker: {
              select: {
                id: true,
                name: true,
                skill: true,
                wageType: true,
                wageRate: true,
              },
            },
            supervisor: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: { assignmentDate: 'desc' },
        },
        payments: {
          include: {
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
                email: true,
              },
            },
          },
          orderBy: { paymentDate: 'desc' },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        _count: {
          select: {
            assignments: true,
            payments: true,
          },
        },
      },
    });

    console.log(
      'DEBUG: Contractor project found:',
      contractorProject ? 'Yes' : 'No'
    );

    if (!contractorProject) {
      // Add helpful debug information
      console.log('DEBUG: Available contractor project IDs for this company:');
      const availableIds = await prisma.contractorProject.findMany({
        where: {
          companyId: req.user.companyId,
        },
        select: {
          id: true,
          project: {
            select: {
              name: true,
            },
          },
        },
        take: 5,
      });
      console.log(availableIds);

      return res.status(404).json({
        success: false,
        message:
          'Contractor project not found. Please ensure you are using the correct contractor project ID.',
        hint: 'This endpoint expects a contractor project ID, not a main project ID.',
      });
    }

    // Calculate financial summary
    const paidPayments = await prisma.contractorPayment.aggregate({
      where: {
        contractorProjectId: contractorProject.id,
        status: 'PAID',
      },
      _sum: {
        amount: true,
      },
    });

    const pendingPayments = await prisma.contractorPayment.aggregate({
      where: {
        contractorProjectId: contractorProject.id,
        status: 'PENDING',
      },
      _sum: {
        amount: true,
      },
    });

    // Calculate assignment summary
    const totalAssignments = contractorProject._count.assignments;
    const completedAssignments = contractorProject.assignments.filter(
      (assignment) => assignment.isCompleted
    ).length;
    const activeWorkers = contractorProject.assignments.filter(
      (assignment) => !assignment.isCompleted
    ).length;

    // Calculate total wage cost
    const totalWageCost = contractorProject.assignments.reduce(
      (sum, assignment) => sum + (assignment.wageAmount || 0),
      0
    );

    const summary = {
      financial: {
        totalContractAmount: contractorProject.contractAmount,
        totalPaid: paidPayments._sum.amount || 0,
        totalPending: pendingPayments._sum.amount || 0,
        advanceAmount: contractorProject.advanceAmount,
        retentionAmount: contractorProject.retentionAmount,
        balanceAmount:
          contractorProject.contractAmount -
          (paidPayments._sum.amount || 0) -
          contractorProject.retentionAmount,
      },
      assignments: {
        total: totalAssignments,
        completed: completedAssignments,
        active: activeWorkers,
        completionRate:
          totalAssignments > 0
            ? Math.round((completedAssignments / totalAssignments) * 100)
            : 0,
        totalWageCost,
      },
    };

    res.json({
      success: true,
      data: {
        ...contractorProject,
        summary,
      },
    });
  } catch (error) {
    console.error('Get contractor project by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

// Get Contractor Assignments
export const getContractorAssignments = async (req, res) => {
  try {
    const { contractorProjectId } = req.params;
    const {
      page = 1,
      limit = 10,
      search = '',
      status,
      startDate,
      endDate,
      workerId,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check CONTRACTOR_ASSIGNMENT_READ permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_ASSIGNMENT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view contractor assignments',
      });
    }

    // Check if contractor project exists
    const contractorProject = await prisma.contractorProject.findFirst({
      where: {
        id: contractorProjectId,
        companyId: req.user.companyId,
      },
    });

    if (!contractorProject) {
      return res.status(404).json({
        success: false,
        message: 'Contractor project not found',
      });
    }

    const where = {
      contractorProjectId,
    };

    // Add search filter
    if (search) {
      where.OR = [
        { workDescription: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
        {
          contractorWorker: {
            name: { contains: search, mode: 'insensitive' },
          },
        },
      ];
    }

    // Add status filter
    if (status) {
      where.status = status;
    } else if (status === 'completed') {
      where.isCompleted = true;
    } else if (status === 'active') {
      where.isCompleted = false;
    }

    // Add worker filter
    if (workerId) {
      where.contractorWorkerId = workerId;
    }

    // Add date range filter
    if (startDate || endDate) {
      where.assignmentDate = {};
      if (startDate) where.assignmentDate.gte = new Date(startDate);
      if (endDate) where.assignmentDate.lte = new Date(endDate);
    }

    const [assignments, total] = await Promise.all([
      prisma.contractorAssignment.findMany({
        where,
        include: {
          contractorWorker: {
            select: {
              id: true,
              name: true,
              skill: true,
              experience: true,
              wageType: true,
              wageRate: true,
            },
          },
          contractorProject: {
            include: {
              project: {
                select: {
                  id: true,
                  name: true,
                  projectId: true,
                },
              },
            },
          },
          supervisor: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          verifiedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { assignmentDate: 'desc' },
      }),
      prisma.contractorAssignment.count({ where }),
    ]);

    // Calculate assignment statistics
    const stats = await prisma.contractorAssignment.aggregate({
      where: {
        contractorProjectId,
      },
      _sum: {
        estimatedHours: true,
        actualHours: true,
        wageAmount: true,
      },
      _count: true,
    });

    const statusStats = await prisma.contractorAssignment.groupBy({
      by: ['status'],
      where: {
        contractorProjectId,
      },
      _sum: {
        wageAmount: true,
      },
      _count: true,
    });

    const verificationStats = await prisma.contractorAssignment.groupBy({
      by: ['isVerified'],
      where: {
        contractorProjectId,
      },
      _count: true,
    });

    const summary = {
      totalAssignments: stats._count,
      totalEstimatedHours: stats._sum.estimatedHours || 0,
      totalActualHours: stats._sum.actualHours || 0,
      totalWageCost: stats._sum.wageAmount || 0,
      byStatus: statusStats.reduce((acc, item) => {
        acc[item.status] = {
          wageAmount: item._sum.wageAmount || 0,
          count: item._count,
        };
        return acc;
      }, {}),
      byVerification: verificationStats.reduce((acc, item) => {
        acc[item.isVerified ? 'verified' : 'unverified'] = item._count;
        return acc;
      }, {}),
    };

    res.json({
      success: true,
      data: assignments,
      summary,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get contractor assignments error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Assignment by ID
export const getAssignmentById = async (req, res) => {
  try {
    const { assignmentId } = req.params;

    console.log('DEBUG: Getting assignment by ID:', assignmentId);

    // Check CONTRACTOR_ASSIGNMENT_READ permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_ASSIGNMENT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view assignment details',
      });
    }

    const assignment = await prisma.contractorAssignment.findFirst({
      where: {
        id: assignmentId,
        contractorProject: {
          companyId: req.user.companyId,
        },
      },
      include: {
        contractorWorker: {
          select: {
            id: true,
            name: true,
            phone: true,
            aadharNumber: true,
            skill: true,
            experience: true,
            wageType: true,
            wageRate: true,
            isAvailable: true,
          },
        },
        contractorProject: {
          include: {
            project: {
              select: {
                id: true,
                name: true,
                projectId: true,
                location: true,
              },
            },
            contractor: {
              select: {
                id: true,
                name: true,
                phone: true,
                contactPerson: true,
              },
            },
          },
        },
        supervisor: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            designation: true,
          },
        },
        verifiedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            designation: true,
          },
        },
      },
    });

    console.log('DEBUG: Assignment found:', assignment ? 'Yes' : 'No');

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found',
      });
    }

    // Get related attendance if any
    // FIXED: The Attendance model uses 'userId' not 'workerId'
    // const attendance = await prisma.attendance.findFirst({
    //   where: {
    //     userId: assignment.contractorWorkerId, // Changed from workerId to userId
    //     date: assignment.assignmentDate,
    //   },
    //   select: {
    //     id: true,
    //     checkInTime: true,
    //     checkOutTime: true,
    //     totalHours: true,
    //     status: true,
    //     notes: true,
    //   },
    // });

    // Get previous assignments for the same worker
    const previousAssignments = await prisma.contractorAssignment.findMany({
      where: {
        contractorWorkerId: assignment.contractorWorkerId,
        id: { not: assignmentId },
        isCompleted: true,
      },
      include: {
        contractorProject: {
          include: {
            project: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      take: 5,
      orderBy: { assignmentDate: 'desc' },
    });

    res.json({
      success: true,
      data: {
        ...assignment,
        // attendance,
        workerHistory: {
          previousAssignments,
          totalCompleted: previousAssignments.length,
        },
      },
    });
  } catch (error) {
    console.error('Get assignment by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message, // Added for debugging
    });
  }
};

// Get All Projects with Subcontractors
export const getAllProjectsWithSubcontractors = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      projectStatus,
      contractorStatus,
      startDate,
      endDate,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    console.log('DEBUG: Getting all projects with subcontractors');
    console.log('DEBUG: Query params:', {
      page,
      limit,
      search,
      projectStatus,
      contractorStatus,
    });

    // Check PROJECT_READ and CONTRACTOR_PROJECT_READ permissions
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'PROJECT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view projects',
      });
    }

    const where = {
      companyId: req.user.companyId,
    };

    // Add search filter
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { projectId: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Add project status filter
    if (projectStatus) {
      where.status = projectStatus;
    }

    // Add date range filter
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        include: {
          client: {
            select: {
              id: true,
              companyName: true, // FIXED: Changed from 'name' to 'companyName'
              contactPerson: true,
            },
          },
          // contractorProjects: {
          //   where: contractorStatus ? { status: contractorStatus } : undefined,
          //   include: {
          //     contractor: {
          //       select: {
          //         id: true,
          //         name: true,
          //         type: true,
          //         rating: true,
          //         isVerified: true,
          //         status: true,
          //       },
          //     },
          //     assignments: {
          //       include: {
          //         contractorWorker: {
          //           select: {
          //             id: true,
          //             name: true,
          //             skill: true,
          //           },
          //         },
          //       },
          //     },
          //     _count: {
          //       select: {
          //         assignments: true,
          //         payments: true,
          //       },
          //     },
          //   },
          // },
          // _count: {
          //   select: {
          //     contractorProjects: true,
          //   },
          // },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.project.count({ where }),
    ]);

    console.log('DEBUG: Total projects found:', total);

    // Calculate project statistics
    const stats = await prisma.contractorProject.groupBy({
      by: ['status'],
      where: {
        project: {
          companyId: req.user.companyId,
        },
      },
      _sum: {
        contractAmount: true,
      },
      _count: true,
    });

    const statusSummary = stats.reduce((acc, item) => {
      acc[item.status] = {
        amount: item._sum.contractAmount || 0,
        count: item._count,
      };
      return acc;
    }, {});

    // Calculate total statistics
    const totalStats = await prisma.contractorProject.aggregate({
      where: {
        project: {
          companyId: req.user.companyId,
        },
      },
      _sum: {
        contractAmount: true,
      },
      _count: true,
    });

    res.json({
      success: true,
      data: projects,
      summary: {
        totalProjects: total,
        // totalContractorProjects: totalStats._count,
        totalContractValue: totalStats._sum.contractAmount || 0,
        byStatus: statusSummary,
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get all projects with subcontractors error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message, // Added for debugging
    });
  }
};

// Get Dashboard Statistics
export const getSubcontractorDashboardStats = async (req, res) => {
  try {
    // Check CONTRACTOR_READ permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view dashboard statistics',
      });
    }

    const [
      // Basic counts
      totalSubcontractors,
      totalWorkers,
      totalProjects,
      totalAssignments,

      // Financial stats
      totalContractValue,
      totalPaymentsPaid,
      totalPaymentsPending,

      // Active stats
      activeAssignments,
      activeWorkersToday,

      // Performance stats
      projectsCompletedThisMonth,
      averageRating,

      // Recent activities
      recentAssignments,
      recentPayments,
      recentProjects,
    ] = await Promise.all([
      // Basic counts
      prisma.contractor.count({
        where: { companyId: req.user.companyId },
      }),
      prisma.subcontractorWorker.count({
        where: {
          contractor: { companyId: req.user.companyId },
          isActive: true,
        },
      }),
      prisma.contractorProject.count({
        where: { companyId: req.user.companyId },
      }),
      prisma.contractorAssignment.count({
        where: {
          contractorProject: { companyId: req.user.companyId },
        },
      }),

      // Financial stats
      prisma.contractorProject.aggregate({
        where: { companyId: req.user.companyId },
        _sum: { contractAmount: true },
      }),
      prisma.contractorPayment.aggregate({
        where: {
          contractorProject: { companyId: req.user.companyId },
          status: 'PAID',
        },
        _sum: { amount: true },
      }),
      prisma.contractorPayment.aggregate({
        where: {
          contractorProject: { companyId: req.user.companyId },
          status: 'PENDING',
        },
        _sum: { amount: true },
      }),

      // Active stats
      prisma.contractorAssignment.count({
        where: {
          contractorProject: { companyId: req.user.companyId },
          isCompleted: false,
          assignmentDate: { lte: new Date() },
        },
      }),
      prisma.contractorAssignment.count({
        where: {
          contractorProject: { companyId: req.user.companyId },
          assignmentDate: new Date(),
          isCompleted: false,
        },
      }),

      // Performance stats
      prisma.contractorProject.count({
        where: {
          companyId: req.user.companyId,
          status: 'COMPLETED',
          completedAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      }),
      prisma.contractor.aggregate({
        where: {
          companyId: req.user.companyId,
          rating: { not: null },
        },
        _avg: { rating: true },
      }),

      // Recent activities
      prisma.contractorAssignment.findMany({
        where: {
          contractorProject: { companyId: req.user.companyId },
        },
        include: {
          contractorWorker: {
            select: { name: true, skill: true },
          },
          contractorProject: {
            include: {
              project: { select: { name: true } },
            },
          },
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.contractorPayment.findMany({
        where: {
          contractorProject: { companyId: req.user.companyId },
        },
        include: {
          contractor: { select: { name: true } },
          contractorProject: {
            include: {
              project: { select: { name: true } },
            },
          },
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.contractorProject.findMany({
        where: { companyId: req.user.companyId },
        include: {
          contractor: { select: { name: true, type: true } },
          project: { select: { name: true } },
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const stats = {
      overview: {
        subcontractors: totalSubcontractors,
        workers: totalWorkers,
        projects: totalProjects,
        assignments: totalAssignments,
      },
      financial: {
        totalContractValue: totalContractValue._sum.contractAmount || 0,
        totalPaid: totalPaymentsPaid._sum.amount || 0,
        totalPending: totalPaymentsPending._sum.amount || 0,
        utilizationRate:
          totalContractValue._sum.contractAmount > 0
            ? Math.round(
                ((totalPaymentsPaid._sum.amount || 0) /
                  totalContractValue._sum.contractAmount) *
                  100
              )
            : 0,
      },
      active: {
        activeAssignments,
        activeWorkersToday,
        completionRate:
          totalAssignments > 0
            ? Math.round(
                ((totalAssignments - activeAssignments) / totalAssignments) *
                  100
              )
            : 0,
      },
      performance: {
        projectsCompletedThisMonth,
        averageRating: parseFloat((averageRating._avg.rating || 0).toFixed(1)),
      },
      recentActivities: {
        assignments: recentAssignments,
        payments: recentPayments,
        projects: recentProjects,
      },
    };

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Get subcontractor dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update Contractor Project
export const updateContractorProjectById = async (req, res) => {
  try {
    const { contractorProjectId } = req.params;
    const updates = req.body;

    console.log('DEBUG: Updating contractor project ID:', contractorProjectId);
    console.log('DEBUG: Update data:', updates);

    // Check CONTRACTOR_PROJECT_UPDATE permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_PROJECT_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update contractor projects',
      });
    }

    // Check if contractor project exists
    const contractorProject = await prisma.contractorProject.findFirst({
      where: {
        id: contractorProjectId,
        companyId: req.user.companyId,
      },
      include: {
        project: true,
        contractor: true,
      },
    });

    if (!contractorProject) {
      return res.status(404).json({
        success: false,
        message: 'Contractor project not found',
      });
    }

    // Check if project is completed
    if (contractorProject.status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update completed contractor project',
      });
    }

    // Prepare update data
    const updateData = {};

    // Basic info updates
    if (updates.title !== undefined) updateData.title = updates.title;
    if (updates.description !== undefined)
      updateData.description = updates.description;
    if (updates.workType !== undefined) {
      // Validate work type against contractor's work types
      const contractor = await prisma.contractor.findFirst({
        where: { id: contractorProject.contractorId },
        select: { workTypes: true },
      });

      if (!contractor.workTypes.includes(updates.workType)) {
        return res.status(400).json({
          success: false,
          message: `Contractor does not have ${updates.workType} in their work types`,
          availableWorkTypes: contractor.workTypes,
        });
      }
      updateData.workType = updates.workType;
    }
    if (updates.scopeOfWork !== undefined)
      updateData.scopeOfWork = updates.scopeOfWork;
    if (updates.terms !== undefined) updateData.terms = updates.terms;

    // Date updates with validation
    if (updates.startDate) {
      const startDate = new Date(updates.startDate);
      if (isNaN(startDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid start date format',
        });
      }
      updateData.startDate = startDate;
    }

    if (updates.endDate) {
      const endDate = new Date(updates.endDate);
      if (isNaN(endDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid end date format',
        });
      }

      // Ensure end date is after start date
      const startDate = updateData.startDate || contractorProject.startDate;
      if (endDate < startDate) {
        return res.status(400).json({
          success: false,
          message: 'End date cannot be before start date',
        });
      }
      updateData.endDate = endDate;
    }

    // Duration update
    if (updates.estimatedDuration !== undefined) {
      updateData.estimatedDuration = parseInt(updates.estimatedDuration);
    }

    // Financial updates
    if (updates.contractAmount !== undefined) {
      const contractAmount = parseFloat(updates.contractAmount);

      // Check if there are existing payments
      const totalPayments = await prisma.contractorPayment.aggregate({
        where: {
          contractorProjectId,
          status: 'PAID',
        },
        _sum: {
          amount: true,
        },
      });

      const totalPaid = totalPayments._sum.amount || 0;

      // Cannot reduce contract amount below already paid amount
      if (contractAmount < totalPaid) {
        return res.status(400).json({
          success: false,
          message: `Cannot reduce contract amount below already paid amount (₹${totalPaid})`,
          minimumAmount: totalPaid,
        });
      }

      updateData.contractAmount = contractAmount;
    }

    if (updates.advanceAmount !== undefined) {
      const advanceAmount = parseFloat(updates.advanceAmount);
      const contractAmount =
        updateData.contractAmount || contractorProject.contractAmount;

      // Advance cannot exceed contract amount
      if (advanceAmount > contractAmount) {
        return res.status(400).json({
          success: false,
          message: 'Advance amount cannot exceed contract amount',
          maximumAdvance: contractAmount,
        });
      }

      updateData.advanceAmount = advanceAmount;
    }

    if (updates.retentionAmount !== undefined) {
      const retentionAmount = parseFloat(updates.retentionAmount);
      const contractAmount =
        updateData.contractAmount || contractorProject.contractAmount;

      // Retention should be reasonable (typically 5-10%)
      if (retentionAmount > contractAmount * 0.15) {
        // 15% max
        return res.status(400).json({
          success: false,
          message: 'Retention amount should not exceed 15% of contract amount',
          maximumRetention: contractAmount * 0.15,
        });
      }

      updateData.retentionAmount = retentionAmount;
    }

    // Payment terms
    if (updates.paymentTerms !== undefined)
      updateData.paymentTerms = updates.paymentTerms;

    // Status updates with validation
    if (updates.status !== undefined) {
      // Validate status transition
      const validTransitions = {
        TODO: ['IN_PROGRESS'],
        IN_PROGRESS: ['REVIEW', 'COMPLETED'],
        REVIEW: ['COMPLETED', 'IN_PROGRESS'],
        COMPLETED: [], // Cannot change from completed
      };

      if (contractorProject.status === 'COMPLETED') {
        return res.status(400).json({
          success: false,
          message: 'Cannot change status of completed project',
        });
      }

      if (
        !validTransitions[contractorProject.status]?.includes(updates.status)
      ) {
        return res.status(400).json({
          success: false,
          message: `Invalid status transition from ${contractorProject.status} to ${updates.status}`,
          allowedTransitions: validTransitions[contractorProject.status],
        });
      }

      updateData.status = updates.status;

      // Handle completion
      if (updates.status === 'COMPLETED') {
        updateData.isCompleted = true;
        updateData.completedAt = new Date();

        // Auto-calculate progress to 100%
        updateData.progress = 100;

        // Update contractor's completed projects count
        await prisma.contractor.update({
          where: { id: contractorProject.contractorId },
          data: {
            completedProjects: { increment: 1 },
          },
        });
      }
    }

    // Progress update
    if (updates.progress !== undefined) {
      const progress = parseInt(updates.progress);
      if (progress < 0 || progress > 100) {
        return res.status(400).json({
          success: false,
          message: 'Progress must be between 0 and 100',
        });
      }
      updateData.progress = progress;

      // Auto-update status based on progress
      if (progress === 100) {
        updateData.status = 'COMPLETED';
        updateData.isCompleted = true;
        updateData.completedAt = new Date();

        // Update contractor's completed projects count
        await prisma.contractor.update({
          where: { id: contractorProject.contractorId },
          data: {
            completedProjects: { increment: 1 },
          },
        });
      } else if (progress > 0 && progress < 100) {
        updateData.status = 'IN_PROGRESS';
      }
    }

    // Ratings
    if (updates.qualityRating !== undefined) {
      const qualityRating = parseFloat(updates.qualityRating);
      if (qualityRating < 0 || qualityRating > 5) {
        return res.status(400).json({
          success: false,
          message: 'Quality rating must be between 0 and 5',
        });
      }
      updateData.qualityRating = qualityRating;
    }

    if (updates.safetyRating !== undefined) {
      const safetyRating = parseFloat(updates.safetyRating);
      if (safetyRating < 0 || safetyRating > 5) {
        return res.status(400).json({
          success: false,
          message: 'Safety rating must be between 0 and 5',
        });
      }
      updateData.safetyRating = safetyRating;
    }

    // Completion notes
    if (updates.completionNotes !== undefined) {
      updateData.completionNotes = updates.completionNotes;
    }

    // Update the contractor project
    const updatedContractorProject = await prisma.contractorProject.update({
      where: { id: contractorProjectId },
      data: updateData,
      include: {
        project: {
          select: {
            id: true,
            name: true,
            projectId: true,
            location: true,
          },
        },
        contractor: {
          select: {
            id: true,
            name: true,
            contactPerson: true,
            phone: true,
            rating: true,
          },
        },
      },
    });

    // Update main project budget if contract amount changed
    if (updates.contractAmount !== undefined) {
      // Calculate total contract amount for all contractor projects
      const contractorProjects = await prisma.contractorProject.findMany({
        where: {
          projectId: contractorProject.projectId,
          companyId: req.user.companyId,
        },
        select: {
          contractAmount: true,
        },
      });

      const totalContractorBudget = contractorProjects.reduce(
        (sum, cp) => sum + cp.contractAmount,
        0
      );

      // Update main project's actual budget
      await prisma.project.update({
        where: { id: contractorProject.projectId },
        data: {
          actualBudget: totalContractorBudget,
        },
      });
    }

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'CONTRACTOR_PROJECT_UPDATED',
        entityType: 'CONTRACTOR_PROJECT',
        entityId: contractorProjectId,
        oldData: {
          title: contractorProject.title,
          contractAmount: contractorProject.contractAmount,
          status: contractorProject.status,
          progress: contractorProject.progress,
        },
        newData: {
          title: updatedContractorProject.title,
          contractAmount: updatedContractorProject.contractAmount,
          status: updatedContractorProject.status,
          progress: updatedContractorProject.progress,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Contractor project updated successfully',
      data: updatedContractorProject,
    });
  } catch (error) {
    console.error('Update contractor project error:', error);

    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'Duplicate entry detected',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

// Delete Contractor Project
export const deleteContractorProjectById = async (req, res) => {
  try {
    const { contractorProjectId } = req.params;

    console.log('DEBUG: Deleting contractor project ID:', contractorProjectId);

    // Check CONTRACTOR_PROJECT_DELETE permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_PROJECT_DELETE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete contractor projects',
      });
    }

    // Check if contractor project exists
    const contractorProject = await prisma.contractorProject.findFirst({
      where: {
        id: contractorProjectId,
        companyId: req.user.companyId,
      },
      include: {
        contractor: true,
        project: true,
      },
    });

    if (!contractorProject) {
      return res.status(404).json({
        success: false,
        message: 'Contractor project not found',
      });
    }

    // Check if there are active assignments
    const activeAssignments = await prisma.contractorAssignment.count({
      where: {
        contractorProjectId,
        isCompleted: false,
      },
    });

    if (activeAssignments > 0) {
      return res.status(400).json({
        success: false,
        message:
          'Cannot delete contractor project with active assignments. Complete or cancel assignments first.',
        activeAssignments,
      });
    }

    // Check if there are pending payments
    const pendingPayments = await prisma.contractorPayment.count({
      where: {
        contractorProjectId,
        status: 'PENDING',
      },
    });

    if (pendingPayments > 0) {
      return res.status(400).json({
        success: false,
        message:
          'Cannot delete contractor project with pending payments. Process payments first.',
        pendingPayments,
      });
    }

    // Start transaction to delete related records
    await prisma.$transaction(async (tx) => {
      // Delete assignments
      await tx.contractorAssignment.deleteMany({
        where: { contractorProjectId },
      });

      // Delete payments
      await tx.contractorPayment.deleteMany({
        where: { contractorProjectId },
      });

      // Delete documents
      await tx.contractorDocument.deleteMany({
        where: { contractorProjectId },
      });

      // Delete the contractor project
      await tx.contractorProject.delete({
        where: { id: contractorProjectId },
      });

      // Update contractor stats
      await tx.contractor.update({
        where: { id: contractorProject.contractorId },
        data: {
          totalProjects: { decrement: 1 },
          completedProjects:
            contractorProject.status === 'COMPLETED'
              ? { decrement: 1 }
              : undefined,
        },
      });

      // Update main project budget
      const remainingProjects = await tx.contractorProject.findMany({
        where: {
          projectId: contractorProject.projectId,
          companyId: req.user.companyId,
        },
        select: {
          contractAmount: true,
        },
      });

      const totalContractorBudget = remainingProjects.reduce(
        (sum, cp) => sum + cp.contractAmount,
        0
      );

      await tx.project.update({
        where: { id: contractorProject.projectId },
        data: {
          actualBudget: totalContractorBudget,
        },
      });
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'CONTRACTOR_PROJECT_DELETED',
        entityType: 'CONTRACTOR_PROJECT',
        entityId: contractorProjectId,
        oldData: {
          projectCode: contractorProject.projectCode,
          title: contractorProject.title,
          contractAmount: contractorProject.contractAmount,
          contractorName: contractorProject.contractor.name,
          projectName: contractorProject.project.name,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Contractor project deleted successfully',
    });
  } catch (error) {
    console.error('Delete contractor project error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

export const getSubcontractorWorkersForAttendance = async (req, res) => {
  try {
    const { contractorId, projectId } = req.query;

    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_WORKER_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view contractor workers',
      });
    }

    const where = {
      isActive: true,
      isAvailable: true,
    };

    if (contractorId) {
      where.contractorId = contractorId;
      where.contractor = {
        companyId: req.user.companyId,
      };
    }

    // FIXED: Query through the 'contractorAssignments' relation
    if (projectId) {
      where.contractorAssignments = {
        some: {
          contractorProject: {
            projectId,
            status: { not: 'COMPLETED' },
          },
          isCompleted: false, // Ensure we check active assignments
        },
      };
    }

    const workers = await prisma.subcontractorWorker.findMany({
      where,
      select: {
        id: true,
        workerId: true,
        name: true,
        skillSet: true,
        wageType: true,
        wageRate: true,
        overtimeRate: true,
        isAvailable: true,
        contractor: {
          select: {
            id: true,
            name: true,
            contractorId: true,
          },
        },
        currentAssignment: {
          select: {
            id: true,
            assignmentDate: true,
            contractorProject: {
              select: {
                project: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
        _count: {
          select: {
            attendances: {
              where: {
                date: {
                  gte: new Date(new Date().setHours(0, 0, 0, 0)),
                },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Get today's attendance for each worker
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const workersWithAttendance = await Promise.all(
      workers.map(async (worker) => {
        const todayAttendance = await prisma.workerAttendance.findFirst({
          where: {
            workerType: 'SUBCONTRACTOR',
            subcontractorWorkerId: worker.id,
            date: {
              gte: today,
              lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
            },
          },
          select: {
            id: true,
            status: true,
            checkInTime: true,
            checkOutTime: true,
            totalHours: true,
          },
        });

        return {
          ...worker,
          todayAttendance,
        };
      })
    );

    res.json({
      success: true,
      data: workersWithAttendance,
      count: workersWithAttendance.length,
    });
  } catch (error) {
    console.error('Get subcontractor workers for attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Subcontractor Worker Details
// Get Subcontractor Worker Details
export const getSubcontractorWorkerDetails = async (req, res) => {
  try {
    const { workerId } = req.params;

    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_WORKER_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view contractor worker details',
      });
    }

    // First, check if this is a ContractorWorker or SubcontractorWorker
    // Based on your schema, we need to check both models
    let worker = null;
    let workerType = null;

    // Try ContractorWorker first
    worker = await prisma.contractorWorker.findFirst({
      where: {
        id: workerId,
        contractor: {
          companyId: req.user.companyId,
        },
      },
      include: {
        contractor: {
          select: {
            id: true,
            name: true,
            contractorId: true,
            contactPerson: true,
            phone: true,
            rating: true,
          },
        },
        currentAssignment: {
          include: {
            contractorProject: {
              include: {
                project: {
                  select: {
                    id: true,
                    name: true,
                    projectId: true,
                    status: true,
                  },
                },
              },
            },
          },
        },
        _count: {
          select: {
            ContractorAssignment: true,
          },
        },
      },
    });

    if (worker) {
      workerType = 'CONTRACTOR';

      // Get attendances for ContractorWorker
      // Note: Based on your schema, ContractorWorker might not have direct attendances
      // You might need to query WorkerAttendance with subcontractorWorkerId
      const attendances = await prisma.workerAttendance.findMany({
        where: {
          workerType: 'SUBCONTRACTOR',
          subcontractorWorkerId: workerId,
        },
        include: {
          project: {
            select: {
              id: true,
              name: true,
            },
          },
          subtaskAssignment: {
            select: {
              id: true,
              subtask: {
                select: {
                  description: true,
                },
              },
            },
          },
        },
        orderBy: { date: 'desc' },
        take: 30,
      });

      // Get subtask assignments for ContractorWorker
      const subtaskAssignments = await prisma.subtaskAssignment.findMany({
        where: {
          workerType: 'SUBCONTRACTOR',
          subcontractorWorkerId: workerId,
        },
        include: {
          subtask: {
            select: {
              description: true,
            },
          },
          task: {
            select: {
              id: true,
              title: true,
            },
          },
          project: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      // Get count of subtask assignments
      const subtaskAssignmentsCount = await prisma.subtaskAssignment.count({
        where: {
          workerType: 'SUBCONTRACTOR',
          subcontractorWorkerId: workerId,
        },
      });

      // Calculate attendance statistics
      const totalDays = attendances.length;
      const presentDays = attendances.filter(
        (a) => a.status === 'PRESENT'
      ).length;
      const totalHours = attendances.reduce(
        (sum, a) => sum + (a.totalHours || 0),
        0
      );
      const totalEarnings = attendances.reduce(
        (sum, a) => sum + (a.totalPayable || 0),
        0
      );

      // Format the response
      const formattedWorker = {
        ...worker,
        attendances,
        subtaskAssignments,
        _count: {
          ...worker._count,
          attendances: attendances.length,
          subtaskAssignments: subtaskAssignmentsCount,
        },
        statistics: {
          totalDays,
          presentDays,
          attendanceRate: totalDays > 0 ? (presentDays / totalDays) * 100 : 0,
          totalHours: parseFloat(totalHours.toFixed(2)),
          totalEarnings: parseFloat(totalEarnings.toFixed(2)),
        },
      };

      return res.json({
        success: true,
        data: formattedWorker,
      });
    }

    // If not found in ContractorWorker, try SubcontractorWorker
    const subWorker = await prisma.subcontractorWorker.findFirst({
      where: {
        id: workerId,
        contractor: {
          companyId: req.user.companyId,
        },
      },
      include: {
        contractor: {
          select: {
            id: true,
            name: true,
            contractorId: true,
            contactPerson: true,
            phone: true,
            rating: true,
          },
        },
        currentAssignment: {
          include: {
            contractorProject: {
              include: {
                project: {
                  select: {
                    id: true,
                    name: true,
                    projectId: true,
                    status: true,
                  },
                },
              },
            },
          },
        },
        attendances: {
          include: {
            project: {
              select: {
                id: true,
                name: true,
              },
            },
            subtaskAssignment: {
              select: {
                id: true,
                subtask: {
                  select: {
                    description: true,
                  },
                },
              },
            },
          },
          orderBy: { date: 'desc' },
          take: 30,
        },
        subtaskAssignments: {
          include: {
            subtask: {
              select: {
                description: true,
              },
            },
            task: {
              select: {
                id: true,
                title: true,
              },
            },
            project: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        _count: {
          select: {
            attendances: true,
            subtaskAssignments: true,
          },
        },
      },
    });

    if (!subWorker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found',
      });
    }

    // Calculate attendance statistics for SubcontractorWorker
    const totalDays = subWorker.attendances.length;
    const presentDays = subWorker.attendances.filter(
      (a) => a.status === 'PRESENT'
    ).length;
    const totalHours = subWorker.attendances.reduce(
      (sum, a) => sum + (a.totalHours || 0),
      0
    );
    const totalEarnings = subWorker.attendances.reduce(
      (sum, a) => sum + (a.totalPayable || 0),
      0
    );

    const formattedSubWorker = {
      ...subWorker,
      statistics: {
        totalDays,
        presentDays,
        attendanceRate: totalDays > 0 ? (presentDays / totalDays) * 100 : 0,
        totalHours: parseFloat(totalHours.toFixed(2)),
        totalEarnings: parseFloat(totalEarnings.toFixed(2)),
      },
    };

    res.json({
      success: true,
      data: formattedSubWorker,
    });
  } catch (error) {
    console.error('Get subcontractor worker details error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

// Get Subcontractor Workers by Project ID
export const getSubcontractorWorkersByProjectId = async (req, res) => {
  try {
    const { projectId } = req.params;
    const {
      page = 1,
      limit = 10,
      search = '',
      status,
      skill,
      date, // Optional date to check attendance
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check CONTRACTOR_WORKER_READ permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_WORKER_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view subcontractor workers',
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

    // Find all subcontractor projects for this project
    const contractorProjects = await prisma.contractorProject.findMany({
      where: {
        projectId,
        companyId: req.user.companyId,
      },
      select: {
        id: true,
        contractorId: true,
        contractor: {
          select: {
            id: true,
            name: true,
            contractorId: true,
          },
        },
      },
    });

    const contractorIds = contractorProjects.map((cp) => cp.contractorId);
    const contractorProjectIds = contractorProjects.map((cp) => cp.id);

    if (contractorIds.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: 'No subcontractors assigned to this project',
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: 0,
          pages: 0,
        },
      });
    }

    // Find workers from these subcontractors
    const where = {
      contractorId: {
        in: contractorIds,
      },
      isActive: true,
    };

    // Add search filter
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { workerId: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Add skill filter
    if (skill) {
      where.skillSet = {
        has: skill,
      };
    }

    // Add availability filter
    if (status === 'available') {
      where.isAvailable = true;
    } else if (status === 'assigned') {
      where.isAvailable = false;
    }

    const [workers, total] = await Promise.all([
      prisma.subcontractorWorker.findMany({
        where,
        include: {
          contractor: {
            select: {
              id: true,
              name: true,
              contractorId: true,
            },
          },
          currentAssignment: {
            where: {
              contractorProjectId: {
                in: contractorProjectIds,
              },
            },
            include: {
              contractorProject: {
                include: {
                  project: {
                    select: {
                      id: true,
                      name: true,
                      projectId: true,
                    },
                  },
                },
              },
            },
          },
          contractorAssignments: {
            where: {
              contractorProjectId: {
                in: contractorProjectIds,
              },
            },
            orderBy: {
              assignmentDate: 'desc',
            },
            take: 5,
            include: {
              contractorProject: {
                include: {
                  project: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
          _count: {
            select: {
              attendances: {
                where: {
                  projectId,
                },
              },
              subtaskAssignments: {
                where: {
                  projectId,
                },
              },
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { name: 'asc' },
      }),
      prisma.subcontractorWorker.count({ where }),
    ]);

    // Get attendance for specified date or today
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // Enrich workers with project-specific data
    const enrichedWorkers = await Promise.all(
      workers.map(async (worker) => {
        // Get today's attendance for this worker on this project
        const todayAttendance = await prisma.workerAttendance.findFirst({
          where: {
            workerType: 'SUBCONTRACTOR',
            subcontractorWorkerId: worker.id,
            projectId,
            date: {
              gte: targetDate,
              lt: nextDay,
            },
          },
          select: {
            id: true,
            status: true,
            checkInTime: true,
            checkOutTime: true,
            totalHours: true,
            totalPayable: true,
          },
        });

        // Get assignment summary for this project
        const assignmentsOnProject = worker.contractorAssignments.filter(
          (assignment) => assignment.contractorProject.projectId === projectId
        );

        const totalAssignments = assignmentsOnProject.length;
        const completedAssignments = assignmentsOnProject.filter(
          (a) => a.isCompleted
        ).length;
        const totalEarnings = assignmentsOnProject.reduce(
          (sum, a) => sum + (a.wageAmount || 0),
          0
        );

        // Get attendance stats for this project
        const attendanceStats = await prisma.workerAttendance.aggregate({
          where: {
            workerType: 'SUBCONTRACTOR',
            subcontractorWorkerId: worker.id,
            projectId,
          },
          _sum: {
            totalHours: true,
            totalPayable: true,
          },
          _count: true,
        });

        const presentCount = await prisma.workerAttendance.count({
          where: {
            workerType: 'SUBCONTRACTOR',
            subcontractorWorkerId: worker.id,
            projectId,
            status: 'PRESENT',
          },
        });

        return {
          ...worker,
          projectSpecific: {
            todayAttendance,
            assignments: {
              total: totalAssignments,
              completed: completedAssignments,
              pending: totalAssignments - completedAssignments,
              completionRate:
                totalAssignments > 0
                  ? Math.round((completedAssignments / totalAssignments) * 100)
                  : 0,
              totalEarnings,
            },
            attendance: {
              totalDays: attendanceStats._count || 0,
              presentDays: presentCount,
              attendanceRate:
                attendanceStats._count > 0
                  ? Math.round((presentCount / attendanceStats._count) * 100)
                  : 0,
              totalHours: attendanceStats._sum.totalHours || 0,
              totalEarnings: attendanceStats._sum.totalPayable || 0,
            },
          },
          // Remove the original arrays to keep response clean
          contractorAssignments: undefined,
        };
      })
    );

    // Get summary statistics
    const summary = {
      totalWorkers: total,
      availableWorkers: workers.filter((w) => w.isAvailable).length,
      assignedWorkers: workers.filter((w) => !w.isAvailable).length,
      workersPresentToday: workers.filter((w) =>
        enrichedWorkers.some(
          (ew) =>
            ew.id === w.id &&
            ew.projectSpecific?.todayAttendance?.status === 'PRESENT'
        )
      ).length,
      skills: [...new Set(workers.flatMap((w) => w.skillSet))],
      contractors: contractorProjects.map((cp) => ({
        id: cp.contractor.id,
        name: cp.contractor.name,
        contractorId: cp.contractor.contractorId,
        workerCount: workers.filter((w) => w.contractorId === cp.contractor.id)
          .length,
      })),
    };

    res.json({
      success: true,
      data: enrichedWorkers,
      summary,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get subcontractor workers by project ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};
