// src/controllers/shiftType.controller.js
import prisma from '../config/database.js';

// Helper function to check permissions
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

// Get userId and companyId from request
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

// Create Shift Type
export const createShiftType = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message:
          'Authentication required. User ID and Company ID must be provided.',
      });
    }

    const hasPermission = await checkPermission(
      userId,
      companyId,
      'PAYROLL_SHIFT_CREATE'
    );
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message:
          'You do not have permission to create shift types. Required permission: PAYROLL_SHIFT_CREATE',
      });
    }

    const { name, multiplier, description } = req.body;

    // Validate multiplier
    if (multiplier <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Multiplier must be greater than 0',
      });
    }

    // Check if shift type with same name or multiplier exists
    const existingShift = await prisma.shiftType.findFirst({
      where: {
        companyId,
        OR: [{ name: { equals: name, mode: 'insensitive' } }, { multiplier }],
      },
    });

    if (existingShift) {
      return res.status(400).json({
        success: false,
        message: 'Shift type with this name or multiplier already exists',
      });
    }

    const shiftType = await prisma.shiftType.create({
      data: {
        companyId,
        name,
        multiplier,
        description,
        createdById: userId,
        isActive: true,
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId,
        companyId,
        action: 'SHIFT_TYPE_CREATED',
        entityType: 'SHIFT_TYPE',
        entityId: shiftType.id,
        newData: { name, multiplier, description },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message: 'Shift type created successfully',
      data: shiftType,
    });
  } catch (error) {
    console.error('Create shift type error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create shift type',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Get All Shift Types
export const getAllShiftTypes = async (req, res) => {
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
      'PAYROLL_SHIFT_READ'
    );
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view shift types.',
      });
    }

    const { page = 1, limit = 20, isActive, search = '' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      companyId,
      ...(isActive !== undefined && { isActive: isActive === 'true' }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [shiftTypes, total] = await Promise.all([
      prisma.shiftType.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { multiplier: 'asc' },
      }),
      prisma.shiftType.count({ where }),
    ]);

    res.json({
      success: true,
      data: shiftTypes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get shift types error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Shift Type by ID
export const getShiftTypeById = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { id } = req.params;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const hasPermission = await checkPermission(
      userId,
      companyId,
      'PAYROLL_SHIFT_READ'
    );
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view shift types.',
      });
    }

    const shiftType = await prisma.shiftType.findFirst({
      where: {
        id,
        companyId,
      },
    });

    if (!shiftType) {
      return res.status(404).json({
        success: false,
        message: 'Shift type not found',
      });
    }

    res.json({
      success: true,
      data: shiftType,
    });
  } catch (error) {
    console.error('Get shift type error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update Shift Type
export const updateShiftType = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { id } = req.params;
    const { name, multiplier, description, isActive } = req.body;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const hasPermission = await checkPermission(
      userId,
      companyId,
      'PAYROLL_SHIFT_UPDATE'
    );
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update shift types.',
      });
    }

    const shiftType = await prisma.shiftType.findFirst({
      where: {
        id,
        companyId,
      },
    });

    if (!shiftType) {
      return res.status(404).json({
        success: false,
        message: 'Shift type not found',
      });
    }

    // Check for duplicates if name or multiplier is being changed
    if (
      (name && name !== shiftType.name) ||
      (multiplier && multiplier !== shiftType.multiplier)
    ) {
      const existingShift = await prisma.shiftType.findFirst({
        where: {
          companyId,
          OR: [
            ...(name && name !== shiftType.name
              ? [{ name: { equals: name, mode: 'insensitive' } }]
              : []),
            ...(multiplier && multiplier !== shiftType.multiplier
              ? [{ multiplier }]
              : []),
          ],
          id: { not: id },
        },
      });

      if (existingShift) {
        return res.status(400).json({
          success: false,
          message: 'Shift type with this name or multiplier already exists',
        });
      }
    }

    const updatedShiftType = await prisma.shiftType.update({
      where: { id },
      data: {
        name,
        multiplier,
        description,
        isActive,
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId,
        companyId,
        action: 'SHIFT_TYPE_UPDATED',
        entityType: 'SHIFT_TYPE',
        entityId: id,
        oldData: shiftType,
        newData: updatedShiftType,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Shift type updated successfully',
      data: updatedShiftType,
    });
  } catch (error) {
    console.error('Update shift type error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Delete Shift Type
export const deleteShiftType = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { id } = req.params;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const hasPermission = await checkPermission(
      userId,
      companyId,
      'PAYROLL_SHIFT_DELETE'
    );
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete shift types.',
      });
    }

    const shiftType = await prisma.shiftType.findFirst({
      where: {
        id,
        companyId,
      },
      include: {
        _count: {
          select: {
            attendances: true,
            payrollItems: true,
          },
        },
      },
    });

    if (!shiftType) {
      return res.status(404).json({
        success: false,
        message: 'Shift type not found',
      });
    }

    // Check if shift type is in use
    if (shiftType._count.attendances > 0 || shiftType._count.payrollItems > 0) {
      return res.status(400).json({
        success: false,
        message:
          'Cannot delete shift type that is in use. Deactivate it instead.',
      });
    }

    await prisma.shiftType.delete({
      where: { id },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId,
        companyId,
        action: 'SHIFT_TYPE_DELETED',
        entityType: 'SHIFT_TYPE',
        entityId: id,
        oldData: shiftType,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Shift type deleted successfully',
    });
  } catch (error) {
    console.error('Delete shift type error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Toggle Shift Type Status
export const toggleShiftTypeStatus = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { id } = req.params;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const hasPermission = await checkPermission(
      userId,
      companyId,
      'PAYROLL_SHIFT_UPDATE'
    );
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update shift types.',
      });
    }

    const shiftType = await prisma.shiftType.findFirst({
      where: {
        id,
        companyId,
      },
    });

    if (!shiftType) {
      return res.status(404).json({
        success: false,
        message: 'Shift type not found',
      });
    }

    const updatedShiftType = await prisma.shiftType.update({
      where: { id },
      data: {
        isActive: !shiftType.isActive,
      },
    });

    res.json({
      success: true,
      message: `Shift type ${updatedShiftType.isActive ? 'activated' : 'deactivated'} successfully`,
      data: updatedShiftType,
    });
  } catch (error) {
    console.error('Toggle shift type status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
