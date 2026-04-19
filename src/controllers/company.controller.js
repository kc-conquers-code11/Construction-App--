// src/controllers/company.controller.js
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/database.js';
import { sendWelcomeEmail } from '../services/emailSms.service.js';

// Create Company with Admin (NO PASSWORD)
export const createCompanyWithAdmin = async (req, res) => {
  try {
    const {
      companyName,
      registrationNumber,
      gstNumber,
      officeAddress,
      phone: companyPhone,
      email: companyEmail,
      website,
      adminName,
      adminEmail,
      adminPhone,
      permissions = [], // Array of permission codes
    } = req.body;

    // Validate at least one contact method for admin
    if (!adminEmail && !adminPhone) {
      return res.status(400).json({
        success: false,
        message: 'Either email or phone is required for admin',
      });
    }

    // Check if company already exists
    const existingCompany = await prisma.company.findFirst({
      where: {
        OR: [
          { registrationNumber },
          { gstNumber },
          { email: companyEmail },
          { phone: companyPhone },
        ].filter(Boolean),
      },
    });

    if (existingCompany) {
      return res.status(400).json({
        success: false,
        message: 'Company with similar details already exists',
      });
    }

    // Check if admin already exists
    const existingAdmin = await prisma.user.findFirst({
      where: {
        OR: [
          ...(adminEmail ? [{ email: adminEmail }] : []),
          { phone: adminPhone },
        ],
      },
    });

    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: 'Admin with this email or phone already exists',
      });
    }

    // Start transaction
    const result = await prisma.$transaction(
      async (tx) => {
        // 1. Create Company
        const company = await tx.company.create({
          data: {
            name: companyName,
            registrationNumber,
            gstNumber,
            officeAddress,
            phone: companyPhone,
            email: companyEmail,
            website,
            isActive: true,
            createdById: req.user.userId,
          },
        });

        // 2. Create Company Settings
        await tx.companySettings.create({
          data: {
            companyId: company.id,
          },
        });

        // 3. Create Company Admin Role
        const companyAdminRole = await tx.role.create({
          data: {
            name: 'Company Administrator',
            description: 'Full access to company features',
            companyId: company.id,
            isSystemAdmin: false,
            createdById: req.user.userId,
          },
        });

        // 4. Get permissions to assign
        let permissionsToAssign = [];

        if (
          permissions.includes('FULL_COMPANY_ACCESS') ||
          permissions.includes('ALL_ACCESS')
        ) {
          // Get all permissions except system-level ones
          permissionsToAssign = await tx.permission.findMany({
            where: {
              OR: [
                { category: { not: 'SYSTEM' } },
                { code: 'FULL_COMPANY_ACCESS' },
              ],
            },
          });
        } else if (permissions.length > 0) {
          // Get specific permissions
          permissionsToAssign = await tx.permission.findMany({
            where: {
              code: { in: permissions },
            },
          });
        } else {
          // Default permissions for company admin
          permissionsToAssign = await tx.permission.findMany({
            where: {
              module: {
                in: [
                  'USER_MANAGEMENT',
                  'PROJECT_MANAGEMENT',
                  'ATTENDANCE_MANAGEMENT',
                  'TASK_MANAGEMENT',
                  'EXPENSE_MANAGEMENT',
                  'TRANSACTION_MANAGEMENT',
                  'MATERIAL_MANAGEMENT',
                  'CLIENT_MANAGEMENT',
                  'INVOICE_MANAGEMENT',
                  'DPR_MANAGEMENT',
                  'EQUIPMENT_MANAGEMENT',
                  'PAYROLL_MANAGEMENT',
                  'SETTINGS_MANAGEMENT',
                  'REPORTS',
                ],
              },
            },
          });
        }

        // 5. Assign permissions to role
        for (const permission of permissionsToAssign) {
          await tx.rolePermission.create({
            data: {
              roleId: companyAdminRole.id,
              permissionId: permission.id,
              grantedById: req.user.userId,
            },
          });
        }

        // 6. Create Company Admin User WITHOUT PASSWORD
        const companyAdmin = await tx.user.create({
          data: {
            name: adminName,
            email: adminEmail,
            phone: adminPhone,
            password: '', // Empty password - will be set by user
            userType: 'COMPANY_ADMIN',
            companyId: company.id,
            roleId: companyAdminRole.id,
            designation: 'Company Administrator',
            department: 'Administration',
            employeeStatus: 'ACTIVE',
            defaultLocation: 'OFFICE',
            isActive: true, // This should be true by default, false only when user deleted
            createdById: req.user.userId,
          },
        });

        return {
          company,
          companyAdmin,
          permissionsAssigned: permissionsToAssign.length,
        };
      },
      {
        // Increase the "wait time" for a database connection
        maxWait: 10000, // 10 seconds
        // Increase the "execution time" for the whole transaction
        timeout: 15000, // 15 seconds (default is 5000ms)
      }
    );

    // 7. Send welcome email to admin
    if (adminEmail) {
      await sendWelcomeEmail(adminEmail, adminPhone, companyName);
    }

    // Log admin credentials (for development only)
    console.log('\n📋 COMPANY CREATION SUMMARY:');
    console.log('==========================');
    console.log(`Company: ${result.company.name}`);
    console.log(`Company ID: ${result.company.id}`);
    console.log(`Admin Name: ${result.companyAdmin.name}`);
    console.log(`Admin Email: ${adminEmail || 'Not provided'}`);
    console.log(`Admin Phone: ${adminPhone}`);
    console.log(`Setup Token: ${result.companyAdmin.resetPasswordToken}`);
    console.log(`Permissions Assigned: ${result.permissionsAssigned}`);
    console.log('==========================\n');

    res.status(201).json({
      success: true,
      message:
        'Company created successfully. Admin needs to complete account setup.',
      data: {
        company: {
          id: result.company.id,
          name: result.company.name,
          email: result.company.email,
          phone: result.company.phone,
        },
        admin: {
          id: result.companyAdmin.id,
          name: result.companyAdmin.name,
          email: result.companyAdmin.email,
          phone: result.companyAdmin.phone,
          setupToken: result.companyAdmin.resetPasswordToken,
        },
        nextSteps: [
          'Admin will receive welcome email/SMS',
          'Admin must login with email/phone',
          'Admin will receive OTP for verification',
          'Admin will set password after verification',
        ],
      },
    });
  } catch (error) {
    console.error('Create company error:', error);

    // Handle specific Prisma errors
    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'Duplicate entry detected. Please check company details.',
        field: error.meta?.target || 'unknown',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Get all companies (for Super Admin)
export const getAllCompanies = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ],
    };

    // Add status filter if provided
    if (status === 'active' || status === 'inactive') {
      where.isActive = status === 'active';
    }

    const [companies, total] = await Promise.all([
      prisma.company.findMany({
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
              users: true,
              projects: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.company.count({ where }),
    ]);

    // Get company admins for each company
    const companiesWithAdmins = await Promise.all(
      companies.map(async (company) => {
        // Find COMPANY_ADMIN users for this company
        const companyAdmins = await prisma.user.findMany({
          where: {
            companyId: company.id,
            userType: 'COMPANY_ADMIN',
          },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            isActive: true,
            lastLogin: true,
            createdAt: true,
            employeeStatus: true,
          },
        });

        return {
          ...company,
          companyAdmins: companyAdmins.map((admin) => ({
            id: admin.id,
            name: admin.name,
            email: admin.email,
            phone: admin.phone,
            isActive: admin.isActive,
            employeeStatus: admin.employeeStatus,
            lastLogin: admin.lastLogin,
            createdAt: admin.createdAt,
          })),
          adminsCount: companyAdmins.length,
        };
      })
    );

    res.json({
      success: true,
      data: companiesWithAdmins,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get companies error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get company by ID
export const getCompanyById = async (req, res) => {
  try {
    const { id } = req.params;

    const company = await prisma.company.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        settings: true,
        users: {
          where: {
            userType: 'COMPANY_ADMIN',
          },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            isActive: true,
            lastLogin: true,
            createdAt: true,
            employeeStatus: true,
            accountSetupCompleted: true,
            profilePicture: true,
            designation: true,
            roleId: true,
          },
        },
        _count: {
          select: {
            users: true,
            projects: true,
            clients: true,
          },
        },
      },
    });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found',
      });
    }

    // Get roles for all admins (filter out undefined/null roleIds)
    const adminRoleIds = company.users
      .map((admin) => admin.roleId)
      .filter((roleId) => roleId != null); // Filter out null/undefined

    let roles = [];
    if (adminRoleIds.length > 0) {
      roles = await prisma.role.findMany({
        where: {
          id: { in: adminRoleIds },
        },
        include: {
          rolePermissions: {
            include: {
              permission: {
                select: {
                  code: true,
                  name: true,
                  module: true,
                },
              },
            },
          },
        },
      });
    }

    const roleMap = roles.reduce((acc, role) => {
      acc[role.id] = {
        id: role.id,
        name: role.name,
        permissions: role.rolePermissions.map((rp) => rp.permission.code),
        permissionsCount: role.rolePermissions.length,
      };
      return acc;
    }, {});

    // Format admins with their roles (handle cases where roleId is null)
    const companyAdmins = company.users.map((admin) => ({
      ...admin,
      role:
        admin.roleId && roleMap[admin.roleId] ? roleMap[admin.roleId] : null,
      // Provide default role info if role is null
      roleInfo: !admin.roleId
        ? {
            id: null,
            name: 'No Role Assigned',
            permissions: [],
            permissionsCount: 0,
          }
        : null,
    }));

    const companyWithAdmins = {
      ...company,
      companyAdmins,
      adminsCount: companyAdmins.length,
      stats: {
        totalUsers: company._count.users,
        projects: company._count.projects,
        clients: company._count.clients,
      },
    };

    // Remove the users array to avoid duplication
    delete companyWithAdmins.users;

    res.json({
      success: true,
      data: companyWithAdmins,
    });
  } catch (error) {
    console.error('Get company error:', error);

    // More detailed error logging
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      meta: error.meta,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      // Include error details in development
      ...(process.env.NODE_ENV === 'development' && {
        error: error.message,
        details: error.code,
      }),
    });
  }
};

// Update company
export const updateCompany = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      name,
      registrationNumber,
      gstNumber,
      officeAddress,
      phone,
      email,
      website,
      isActive,
    } = req.body;
    console.log('Update Company Request Bodyuuuuu:', req.body);

    const company = await prisma.company.findUnique({
      where: { id },
    });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found',
      });
    }

    const updatedCompany = await prisma.company.update({
      where: { id },
      data: {
        name,
        registrationNumber,
        gstNumber,
        officeAddress,
        phone,
        email,
        website,
        isActive,
      },
    });

    res.json({
      success: true,
      message: 'Company updated successfully',
      data: updatedCompany,
    });
  } catch (error) {
    console.error('Update company error:', error);

    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'Duplicate value detected',
        field: error.meta?.target,
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Toggle company active status
export const toggleCompanyStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const company = await prisma.company.findUnique({
      where: { id },
    });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found',
      });
    }

    const updatedCompany = await prisma.company.update({
      where: { id },
      data: { isActive },
    });

    // Also deactivate all users if company is deactivated
    if (!isActive) {
      await prisma.user.updateMany({
        where: { companyId: id },
        data: { isActive: false },
      });
    } else {
      // If company is activated, update all users to active
      await prisma.user.updateMany({
        where: { companyId: id },
        data: { isActive: true },
      });
    }

    res.json({
      success: true,
      message: `Company ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: updatedCompany,
    });
  } catch (error) {
    console.error('Toggle company status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get company admins
export const getCompanyAdmins = async (req, res) => {
  try {
    const { companyId } = req.params;
    const { page = 1, limit = 10, status = 'active' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      companyId,
      userType: 'COMPANY_ADMIN',
    };

    // Add status filter
    if (status === 'active' || status === 'inactive') {
      where.isActive = status === 'active';
    }

    const [admins, total] = await Promise.all([
      prisma.user.findMany({
        where,
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
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    // Format permissions
    const formattedAdmins = admins.map((admin) => {
      const permissions =
        admin.role?.rolePermissions.map((rp) => rp.permission.code) || [];

      return {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        isActive: admin.isActive,
        createdAt: admin.createdAt,
        lastLogin: admin.lastLogin,
        role: admin.role
          ? {
              id: admin.role.id,
              name: admin.role.name,
              permissions: permissions,
              permissionsCount: permissions.length,
            }
          : null,
        createdBy: admin.createdBy,
        needsPasswordSetup: !admin.password || admin.password === '',
      };
    });

    res.json({
      success: true,
      data: formattedAdmins,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get company admins error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Add additional admin to company
export const addCompanyAdmin = async (req, res) => {
  try {
    const { companyId } = req.params;
    const { name, email, phone, permissions = [] } = req.body;

    // Validate at least one contact method
    if (!email && !phone) {
      return res.status(400).json({
        success: false,
        message: 'Either email or phone is required',
      });
    }

    // Check if company exists
    const company = await prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found',
      });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { phone }],
        companyId,
      },
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or phone already exists in company',
      });
    }

    // Get or create Company Admin role
    let companyAdminRole = await prisma.role.findFirst({
      where: {
        companyId,
        name: 'Company Administrator',
      },
    });

    if (!companyAdminRole) {
      companyAdminRole = await prisma.role.create({
        data: {
          name: 'Company Administrator',
          description: 'Full access to company features',
          companyId,
          isSystemAdmin: false,
          createdById: req.user.userId,
        },
      });
    }

    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create admin WITHOUT PASSWORD
      const newAdmin = await tx.user.create({
        data: {
          name,
          email,
          phone,
          password: '', // Empty password - will be set by user
          userType: 'COMPANY_ADMIN',
          companyId,
          roleId: companyAdminRole.id,
          designation: 'Company Administrator',
          department: 'Administration',
          employeeStatus: 'ACTIVE',
          defaultLocation: 'OFFICE',
          isActive: false, // Inactive until they set password
          createdById: req.user.userId,
        },
      });

      // 2. Assign permissions if specified
      if (permissions.length > 0) {
        const permissionsToAssign = await tx.permission.findMany({
          where: {
            code: { in: permissions },
          },
        });

        for (const permission of permissionsToAssign) {
          await tx.rolePermission.upsert({
            where: {
              roleId_permissionId: {
                roleId: companyAdminRole.id,
                permissionId: permission.id,
              },
            },
            update: {},
            create: {
              roleId: companyAdminRole.id,
              permissionId: permission.id,
              grantedById: req.user.userId,
            },
          });
        }
      }

      return { newAdmin, permissionsAssigned: permissions.length };
    });

    // Send welcome email
    if (email) {
      await sendWelcomeEmail(email, phone, company.name);
    }

    console.log('\n➕ ADDITIONAL ADMIN CREATED:');
    console.log('==========================');
    console.log(`Company: ${company.name}`);
    console.log(`Admin Name: ${result.newAdmin.name}`);
    console.log(`Admin Email: ${email || 'Not provided'}`);
    console.log(`Admin Phone: ${phone}`);
    console.log(`Setup Token: ${result.newAdmin.resetPasswordToken}`);
    console.log('==========================\n');

    res.status(201).json({
      success: true,
      message:
        'Company admin added successfully. They need to complete account setup.',
      data: {
        admin: {
          id: result.newAdmin.id,
          name: result.newAdmin.name,
          email: result.newAdmin.email,
          phone: result.newAdmin.phone,
          setupToken: result.newAdmin.resetPasswordToken,
        },
      },
    });
  } catch (error) {
    console.error('Add company admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update existing company admin details
export const updateCompanyAdmin = async (req, res) => {
  try {
    const { companyId, adminId } = req.params;
    const { name, email, phone } = req.body;

    // 1. Check if admin exists and belongs to this company
    const adminUser = await prisma.user.findFirst({
      where: {
        id: adminId,
        companyId,
        userType: 'COMPANY_ADMIN',
      },
      include: { role: true },
    });

    if (!adminUser) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found in this company',
      });
    }

    // 2. Perform updates in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update User details
      const updatedAdmin = await tx.user.update({
        where: { id: adminId },
        data: {
          name,
          email,
          phone,
        },
      });

      return updatedAdmin;
    });

    res.status(200).json({
      success: true,
      message: 'Admin details updated successfully',
      data: result,
    });
  } catch (error) {
    console.error('Update company admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update company admin permissions
export const updateAdminPermissions = async (req, res) => {
  try {
    const { companyId, adminId } = req.params;
    const { permissions } = req.body;

    if (!permissions || !Array.isArray(permissions)) {
      return res.status(400).json({
        success: false,
        message: 'Permissions array is required',
      });
    }

    // Check if admin exists and belongs to company
    const admin = await prisma.user.findFirst({
      where: {
        id: adminId,
        companyId,
        userType: 'COMPANY_ADMIN',
      },
      include: {
        role: true,
      },
    });

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found in this company',
      });
    }

    // Get permissions to assign
    let permissionsToAssign = [];

    if (
      permissions.includes('FULL_COMPANY_ACCESS') ||
      permissions.includes('ALL_ACCESS')
    ) {
      permissionsToAssign = await prisma.permission.findMany({
        where: {
          OR: [
            { category: { not: 'SYSTEM' } },
            { code: 'FULL_COMPANY_ACCESS' },
          ],
        },
      });
    } else {
      permissionsToAssign = await prisma.permission.findMany({
        where: {
          code: { in: permissions },
        },
      });
    }

    // Start transaction
    await prisma.$transaction(async (tx) => {
      // Remove existing permissions
      await tx.rolePermission.deleteMany({
        where: {
          roleId: admin.roleId,
        },
      });

      // Add new permissions
      for (const permission of permissionsToAssign) {
        await tx.rolePermission.create({
          data: {
            roleId: admin.roleId,
            permissionId: permission.id,
            grantedById: req.user.userId,
          },
        });
      }
    });

    res.json({
      success: true,
      message: 'Admin permissions updated successfully',
      data: {
        adminId: admin.id,
        permissionsUpdated: permissionsToAssign.length,
        permissions: permissionsToAssign.map((p) => p.code),
      },
    });
  } catch (error) {
    console.error('Update admin permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get available permissions for company admin
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

// Reset admin setup (allow them to setup password again)
export const resetAdminSetup = async (req, res) => {
  try {
    const { companyId, adminId } = req.params;

    // Check if admin exists and belongs to company
    const admin = await prisma.user.findFirst({
      where: {
        id: adminId,
        companyId,
        userType: 'COMPANY_ADMIN',
      },
      include: {
        company: true,
      },
    });

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found in this company',
      });
    }

    // Clear password and deactivate account
    const updatedAdmin = await prisma.user.update({
      where: { id: adminId },
      data: {
        password: '',
        isActive: false, // Deactivate until setup is complete
        emailVerified: false, // Reset verification if needed
        phoneVerified: false,
      },
    });

    res.json({
      success: true,
      message:
        'Admin setup reset successfully. They will need to verify and set password again.',
      data: {
        adminId: admin.id,
      },
    });
  } catch (error) {
    console.error('Reset admin setup error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
