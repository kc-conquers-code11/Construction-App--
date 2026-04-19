// src/controllers/role.controller.js
import prisma from '../config/database.js';

// Create Role
export const createRole = async (req, res) => {
  try {
    const { name, description, permissions = [] } = req.body;

    // Check if role already exists in company
    const existingRole = await prisma.role.findFirst({
      where: {
        name,
        companyId: req.user.companyId,
      },
    });

    if (existingRole) {
      return res.status(400).json({
        success: false,
        message: 'Role with this name already exists in your company',
      });
    }

    // Start transaction
    const result = await prisma.$transaction(
      async (tx) => {
        // 1. Create role
        const role = await tx.role.create({
          data: {
            name,
            description,
            companyId: req.user.companyId,
            isSystemAdmin: false,
            createdById: req.user.userId,
          },
        });

        // 2. Assign permissions if provided
        let permissionsAssigned = 0;
        if (permissions.length > 0) {
          const permissionsToAssign = await tx.permission.findMany({
            where: {
              code: { in: permissions },
            },
          });

          for (const permission of permissionsToAssign) {
            await tx.rolePermission.create({
              data: {
                roleId: role.id,
                permissionId: permission.id,
                grantedById: req.user.userId,
              },
            });
          }
          permissionsAssigned = permissionsToAssign.length;
        }

        return { role, permissionsAssigned };
      },
      {
        maxWait: 10000, // 10 seconds
        // Increase the "execution time" for the whole transaction
        timeout: 15000, // 15 seconds (default is 5000ms)
      }
    );

    res.status(201).json({
      success: true,
      message: 'Role created successfully',
      data: {
        id: result.role.id,
        name: result.role.name,
        description: result.role.description,
        permissionsAssigned: result.permissionsAssigned,
      },
    });
  } catch (error) {
    console.error('Create role error:', error);

    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'Duplicate role name in your company',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get All Roles
export const getAllRoles = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      companyId: req.user.companyId,
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [roles, total] = await Promise.all([
      prisma.role.findMany({
        where,
        include: {
          _count: {
            select: {
              users: true,
              rolePermissions: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.role.count({ where }),
    ]);

    // Format response
    const formattedRoles = roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      isSystemAdmin: role.isSystemAdmin,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
      stats: {
        users: role._count.users,
        permissions: role._count.rolePermissions,
      },
    }));

    res.json({
      success: true,
      data: formattedRoles,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get roles error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Role by ID
export const getRoleById = async (req, res) => {
  try {
    const { id } = req.params;

    const role = await prisma.role.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
      include: {
        rolePermissions: {
          include: {
            permission: true,
          },
        },
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            designation: true,
            isActive: true,
          },
          take: 10,
        },
        _count: {
          select: {
            users: true,
          },
        },
      },
    });

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found',
      });
    }

    // Format permissions
    const permissions = role.rolePermissions.map((rp) => ({
      code: rp.permission.code,
      name: rp.permission.name,
      module: rp.permission.module,
      category: rp.permission.category,
    }));

    res.json({
      success: true,
      data: {
        id: role.id,
        name: role.name,
        description: role.description,
        isSystemAdmin: role.isSystemAdmin,
        permissions,
        users: role.users,
        stats: {
          totalUsers: role._count.users,
          totalPermissions: role.rolePermissions.length,
        },
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      },
    });
  } catch (error) {
    console.error('Get role error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update Role
export const updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    // Check if role exists and belongs to company
    const role = await prisma.role.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        isSystemAdmin: false, // Cannot update system roles
      },
    });

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found or cannot be updated',
      });
    }

    // Check if new name already exists (excluding current role)
    if (name && name !== role.name) {
      const existingRole = await prisma.role.findFirst({
        where: {
          name,
          companyId: req.user.companyId,
          id: { not: id },
        },
      });

      if (existingRole) {
        return res.status(400).json({
          success: false,
          message: 'Role with this name already exists in your company',
        });
      }
    }

    const updatedRole = await prisma.role.update({
      where: { id },
      data: {
        name,
        description,
      },
    });

    res.json({
      success: true,
      message: 'Role updated successfully',
      data: {
        id: updatedRole.id,
        name: updatedRole.name,
        description: updatedRole.description,
      },
    });
  } catch (error) {
    console.error('Update role error:', error);

    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'Duplicate role name in your company',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Delete Role
export const deleteRole = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if role exists and belongs to company
    const role = await prisma.role.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        isSystemAdmin: false, // Cannot delete system roles
      },
      include: {
        _count: {
          select: {
            users: true,
          },
        },
      },
    });

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found or cannot be deleted',
      });
    }

    // Check if role has users assigned
    if (role._count.users > 0) {
      return res.status(400).json({
        success: false,
        message:
          'Cannot delete role that has users assigned. Reassign users first.',
      });
    }

    // Start transaction to delete role and its permissions
    await prisma.$transaction(async (tx) => {
      // Delete role permissions first
      await tx.rolePermission.deleteMany({
        where: { roleId: id },
      });

      // Delete role
      await tx.role.delete({
        where: { id },
      });
    });

    res.json({
      success: true,
      message: 'Role deleted successfully',
    });
  } catch (error) {
    console.error('Delete role error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update Role Permissions
export const updateRolePermissions = async (req, res) => {
  try {
    const { id } = req.params;
    const { permissions } = req.body;

    if (!permissions || !Array.isArray(permissions)) {
      return res.status(400).json({
        success: false,
        message: 'Permissions array is required',
      });
    }

    // Check if role exists and belongs to company
    const role = await prisma.role.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found',
      });
    }

    // Get permissions to assign
    const permissionsToAssign = await prisma.permission.findMany({
      where: {
        code: { in: permissions },
      },
    });

    // Start transaction
    await prisma.$transaction(
      async (tx) => {
        // Remove existing permissions
        await tx.rolePermission.deleteMany({
          where: {
            roleId: id,
          },
        });

        // Add new permissions
        for (const permission of permissionsToAssign) {
          await tx.rolePermission.create({
            data: {
              roleId: id,
              permissionId: permission.id,
              grantedById: req.user.userId,
            },
          });
        }
      },
      {
        maxWait: 10000, // 10 seconds
        // Increase the "execution time" for the whole transaction
        timeout: 15000, // 15 seconds (default is 5000ms)
      }
    );

    res.json({
      success: true,
      message: 'Role permissions updated successfully',
      data: {
        roleId: role.id,
        roleName: role.name,
        permissionsUpdated: permissionsToAssign.length,
        permissions: permissionsToAssign.map((p) => p.code),
      },
    });
  } catch (error) {
    console.error('Update role permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Role Permissions
export const getRolePermissions = async (req, res) => {
  try {
    const { id } = req.params;

    const role = await prisma.role.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
      include: {
        rolePermissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found',
      });
    }

    const permissions = role.rolePermissions.map((rp) => ({
      id: rp.permission.id,
      code: rp.permission.code,
      name: rp.permission.name,
      module: rp.permission.module,
      category: rp.permission.category,
      description: rp.permission.description,
    }));

    res.json({
      success: true,
      data: {
        roleId: role.id,
        roleName: role.name,
        permissions,
        totalPermissions: permissions.length,
      },
    });
  } catch (error) {
    console.error('Get role permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
