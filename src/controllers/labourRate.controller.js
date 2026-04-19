// src/controllers/labourRate.controller.js
import prisma from '../config/database.js';

// Helper functions (same as above)
const checkPermission = async (userId, companyId, permissionCode) => {
  if (!userId) return false;
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
  return user.role?.rolePermissions.some(
    (rp) =>
      rp.permission.code === permissionCode ||
      rp.permission.code === 'ALL_ACCESS' ||
      rp.permission.code === 'FULL_COMPANY_ACCESS'
  );
};

const getUserIdFromRequest = (req) =>
  req.user?.userId ||
  req.headers['x-user-id'] ||
  req.query.userId ||
  req.body.userId;
const getCompanyIdFromRequest = (req) =>
  req.user?.companyId ||
  req.headers['x-company-id'] ||
  req.query.companyId ||
  req.body.companyId;

// Create Labour Rate
export const createLabourRate = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const hasPermission = await checkPermission(
      userId,
      companyId,
      'PAYROLL_RATE_CREATE'
    );
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create labour rates.',
      });
    }

    const { workerType, workerId, rate, effectiveFrom, reason } = req.body;

    if (!workerType || !workerId || !rate || !effectiveFrom) {
      return res.status(400).json({
        success: false,
        message:
          'Worker type, worker ID, rate, and effective from date are required',
      });
    }

    if (rate <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Rate must be greater than 0',
      });
    }

    // Validate worker exists
    let worker = null;
    if (workerType === 'SITE_STAFF') {
      worker = await prisma.siteStaff.findFirst({
        where: { id: workerId, companyId },
      });
    } else if (workerType === 'SUBCONTRACTOR') {
      worker = await prisma.subcontractorWorker.findFirst({
        where: {
          id: workerId,
          contractor: { companyId },
        },
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid worker type',
      });
    }

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found',
      });
    }

    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      // Set previous rates as not current
      await tx.labourRate.updateMany({
        where: {
          companyId,
          workerType,
          ...(workerType === 'SITE_STAFF'
            ? { siteStaffId: workerId }
            : { subcontractorWorkerId: workerId }),
          isCurrent: true,
        },
        data: {
          isCurrent: false,
          effectiveTo: new Date(effectiveFrom),
        },
      });

      // Create new rate
      const labourRate = await tx.labourRate.create({
        data: {
          companyId,
          workerType,
          siteStaffId: workerType === 'SITE_STAFF' ? workerId : null,
          subcontractorWorkerId:
            workerType === 'SUBCONTRACTOR' ? workerId : null,
          rate: parseFloat(rate),
          effectiveFrom: new Date(effectiveFrom),
          isCurrent: true,
          reason,
          createdById: userId,
        },
      });

      // Update worker's current rate in their table
      if (workerType === 'SITE_STAFF') {
        await tx.siteStaff.update({
          where: { id: workerId },
          data: { dailyWageRate: parseFloat(rate) },
        });
      } else {
        await tx.subcontractorWorker.update({
          where: { id: workerId },
          data: { wageRate: parseFloat(rate) },
        });
      }

      return labourRate;
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId,
        companyId,
        action: 'LABOUR_RATE_CREATED',
        entityType: 'LABOUR_RATE',
        entityId: result.id,
        newData: { workerType, workerId, rate, effectiveFrom, reason },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message: 'Labour rate created successfully',
      data: result,
    });
  } catch (error) {
    console.error('Create labour rate error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create labour rate',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Get Labour Rates
export const getLabourRates = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const hasPermission = await checkPermission(
      userId,
      companyId,
      'PAYROLL_RATE_READ'
    );
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view labour rates.',
      });
    }

    const { workerType, workerId, page = 1, limit = 20, isCurrent } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      companyId,
      ...(workerType && { workerType }),
      ...(workerType === 'SITE_STAFF' && workerId && { siteStaffId: workerId }),
      ...(workerType === 'SUBCONTRACTOR' &&
        workerId && { subcontractorWorkerId: workerId }),
      ...(isCurrent !== undefined && { isCurrent: isCurrent === 'true' }),
    };

    const [labourRates, total] = await Promise.all([
      prisma.labourRate.findMany({
        where,
        include: {
          siteStaff: {
            select: {
              id: true,
              name: true,
              workerId: true,
            },
          },
          subcontractorWorker: {
            select: {
              id: true,
              name: true,
              workerId: true,
              contractor: {
                select: { name: true },
              },
            },
          },
          createdBy: {
            select: { id: true, name: true },
          },
          approvedBy: {
            select: { id: true, name: true },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { effectiveFrom: 'desc' },
      }),
      prisma.labourRate.count({ where }),
    ]);

    res.json({
      success: true,
      data: labourRates,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get labour rates error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Current Labour Rate for a Worker
export const getCurrentLabourRate = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { workerType, workerId } = req.params;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const hasPermission = await checkPermission(
      userId,
      companyId,
      'PAYROLL_RATE_READ'
    );
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view labour rates.',
      });
    }

    const labourRate = await prisma.labourRate.findFirst({
      where: {
        companyId,
        workerType,
        ...(workerType === 'SITE_STAFF'
          ? { siteStaffId: workerId }
          : { subcontractorWorkerId: workerId }),
        isCurrent: true,
      },
      include: {
        siteStaff: {
          select: {
            id: true,
            name: true,
            workerId: true,
            designation: true,
          },
        },
        subcontractorWorker: {
          select: {
            id: true,
            name: true,
            workerId: true,
            contractor: {
              select: { name: true },
            },
          },
        },
      },
    });

    if (!labourRate) {
      return res.status(404).json({
        success: false,
        message: 'No current labour rate found for this worker',
      });
    }

    res.json({
      success: true,
      data: labourRate,
    });
  } catch (error) {
    console.error('Get current labour rate error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Labour Rate History for a Worker
export const getLabourRateHistory = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { workerType, workerId } = req.params;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const hasPermission = await checkPermission(
      userId,
      companyId,
      'PAYROLL_RATE_READ'
    );
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view labour rates.',
      });
    }

    const labourRates = await prisma.labourRate.findMany({
      where: {
        companyId,
        workerType,
        ...(workerType === 'SITE_STAFF'
          ? { siteStaffId: workerId }
          : { subcontractorWorkerId: workerId }),
      },
      include: {
        createdBy: {
          select: { id: true, name: true },
        },
        approvedBy: {
          select: { id: true, name: true },
        },
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    res.json({
      success: true,
      data: labourRates,
      total: labourRates.length,
    });
  } catch (error) {
    console.error('Get labour rate history error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update Labour Rate (Approve/Reject/Modify)
export const updateLabourRate = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { id } = req.params;
    const { rate, effectiveFrom, reason, isApproved, approvalNotes } = req.body;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const hasPermission = await checkPermission(
      userId,
      companyId,
      'PAYROLL_RATE_UPDATE'
    );
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update labour rates.',
      });
    }

    const labourRate = await prisma.labourRate.findFirst({
      where: {
        id,
        companyId,
      },
    });

    if (!labourRate) {
      return res.status(404).json({
        success: false,
        message: 'Labour rate not found',
      });
    }

    const updateData = {};

    if (rate) updateData.rate = parseFloat(rate);
    if (effectiveFrom) updateData.effectiveFrom = new Date(effectiveFrom);
    if (reason) updateData.reason = reason;

    if (isApproved !== undefined) {
      updateData.approvedById = userId;
      updateData.approvedAt = new Date();
    }

    const updatedLabourRate = await prisma.labourRate.update({
      where: { id },
      data: updateData,
    });

    // If rate is updated and this is current rate, update worker's table
    if (rate && labourRate.isCurrent) {
      if (labourRate.workerType === 'SITE_STAFF') {
        await prisma.siteStaff.update({
          where: { id: labourRate.siteStaffId },
          data: { dailyWageRate: parseFloat(rate) },
        });
      } else {
        await prisma.subcontractorWorker.update({
          where: { id: labourRate.subcontractorWorkerId },
          data: { wageRate: parseFloat(rate) },
        });
      }
    }

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId,
        companyId,
        action: 'LABOUR_RATE_UPDATED',
        entityType: 'LABOUR_RATE',
        entityId: id,
        oldData: labourRate,
        newData: updatedLabourRate,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Labour rate updated successfully',
      data: updatedLabourRate,
    });
  } catch (error) {
    console.error('Update labour rate error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
