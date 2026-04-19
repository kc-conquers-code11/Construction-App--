// src/controllers/permission.controller.js
import prisma from '../config/database.js';

// Get All Permissions
export const getAllPermissions = async (req, res) => {
  try {
    const permissions = await prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { name: 'asc' }],
    });

    res.json({
      success: true,
      data: permissions,
      total: permissions.length,
    });
  } catch (error) {
    console.error('Get permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Grouped Permissions
export const getGroupedPermissions = async (req, res) => {
  try {
    const permissions = await prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { name: 'asc' }],
    });

    // Group by module
    const groupedByModule = permissions.reduce((acc, permission) => {
      if (!acc[permission.module]) {
        acc[permission.module] = [];
      }
      acc[permission.module].push({
        id: permission.id,
        code: permission.code,
        name: permission.name,
        description: permission.description,
        category: permission.category,
      });
      return acc;
    }, {});

    // Group by category
    const groupedByCategory = permissions.reduce((acc, permission) => {
      if (!acc[permission.category]) {
        acc[permission.category] = [];
      }
      acc[permission.category].push({
        id: permission.id,
        code: permission.code,
        name: permission.name,
        description: permission.description,
        module: permission.module,
      });
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        groupedByModule,
        groupedByCategory,
        allPermissions: permissions,
      },
    });
  } catch (error) {
    console.error('Get grouped permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Available Permissions (excluding system-level for company admins)
export const getAvailablePermissions = async (req, res) => {
  try {
    const permissions = await prisma.permission.findMany({
      where: {
        category: { not: 'SYSTEM' },
      },
      orderBy: [{ module: 'asc' }, { name: 'asc' }],
    });

    // Group permissions by module for easier frontend display
    const groupedPermissions = permissions.reduce((acc, permission) => {
      if (!acc[permission.module]) {
        acc[permission.module] = [];
      }
      acc[permission.module].push({
        code: permission.code,
        name: permission.name,
        description: permission.description,
        category: permission.category,
      });
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        allPermissions: permissions,
        groupedPermissions,
        total: permissions.length,
      },
    });
  } catch (error) {
    console.error('Get available permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
