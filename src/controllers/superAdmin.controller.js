// src/controllers/superAdmin.controller.js
import prisma from '../config/database.js';

// Helper function to get recent activities data (reused from above)
const getRecentActivitiesData = async () => {
  // Get recent company creations (last 30 days)
  const recentCompanies = await prisma.company.findMany({
    where: {
      createdAt: {
        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
    },
    select: {
      id: true,
      name: true,
      createdAt: true,
      createdBy: {
        select: { name: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  // Get recently suspended companies
  const suspendedCompanies = await prisma.company.findMany({
    where: {
      isActive: false,
      updatedAt: {
        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
    },
    select: {
      id: true,
      name: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 5,
  });

  // Get inactive companies
  const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);

  const companiesWithProjects = await prisma.project.groupBy({
    by: ['companyId'],
    where: { updatedAt: { gte: fifteenDaysAgo } },
  });

  const companiesWithUsers = await prisma.user.groupBy({
    by: ['companyId'],
    where: {
      userType: 'COMPANY_ADMIN',
      lastLogin: { gte: fifteenDaysAgo },
    },
  });

  const activeCompanyIds = [
    ...new Set([
      ...companiesWithProjects.map((c) => c.companyId),
      ...companiesWithUsers.map((u) => u.companyId),
    ]),
  ];

  const inactiveCompanies = await prisma.company.findMany({
    where: {
      isActive: true,
      id: { notIn: activeCompanyIds },
    },
    select: {
      id: true,
      name: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'asc' },
    take: 5,
  });

  // Format activities
  const activities = [];

  recentCompanies.forEach((company) => {
    const daysAgo = Math.floor(
      (Date.now() - new Date(company.createdAt).getTime()) /
        (1000 * 60 * 60 * 24)
    );
    activities.push({
      id: `new-company-${company.id}`,
      type: 'company_created',
      title: 'New Company Created',
      description: `${company.name} registered successfully`,
      timestamp: company.createdAt,
      timeText:
        daysAgo === 0
          ? 'today'
          : daysAgo === 1
            ? 'yesterday'
            : `${daysAgo} days ago`,
    });
  });

  suspendedCompanies.forEach((company) => {
    const daysAgo = Math.floor(
      (Date.now() - new Date(company.updatedAt).getTime()) /
        (1000 * 60 * 60 * 24)
    );
    activities.push({
      id: `suspended-company-${company.id}`,
      type: 'company_suspended',
      title: 'Company Suspended',
      description: `${company.name} suspended due to policy violation`,
      timestamp: company.updatedAt,
      timeText:
        daysAgo === 0
          ? 'today'
          : daysAgo === 1
            ? 'yesterday'
            : `${daysAgo} days ago`,
    });
  });

  inactiveCompanies.forEach((company) => {
    const daysInactive = Math.floor(
      (Date.now() - new Date(company.updatedAt).getTime()) /
        (1000 * 60 * 60 * 24)
    );
    activities.push({
      id: `inactive-company-${company.id}`,
      type: 'inactive_warning',
      title: 'Inactive Company Warning',
      description: `${company.name} has shown no activity for ${daysInactive} days`,
      timestamp: company.updatedAt,
      timeText: `${daysInactive}d ago`,
    });
  });

  return activities
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
    .slice(0, 10);
};

export const getSuperAdminProfile = async (req, res) => {
  try {
    console.log('Req User:', req.user);
    const superAdminId = req.user.userId;

    const superAdmin = await prisma.user.findFirst({
      where: {
        id: superAdminId,
        userType: 'SUPER_ADMIN',
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        employeeId: true,
        designation: true,
        department: true,
        defaultLocation: true,
        profilePicture: true,
        emailVerified: true,
        phoneVerified: true,
        accountSetupCompleted: true,
        createdAt: true,
        updatedAt: true,
        role: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
      },
    });

    if (!superAdmin) {
      return res.status(404).json({
        success: false,
        message: 'Super Admin profile not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: superAdmin,
    });
  } catch (error) {
    console.error('Get Super Admin Profile Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch super admin profile',
    });
  }
};

export const updateSuperAdminProfile = async (req, res) => {
  try {
    console.log('Req Body:', req.body);
    const superAdminId = req.user.userId;

    const allowedFields = [
      'name',
      'email',
      'phone',
      'designation',
      'department',
      'address',
      'profilePicture',
      'defaultLocation',
    ];

    const updateData = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields provided for update',
      });
    }

    const updatedSuperAdmin = await prisma.user.update({
      where: {
        id: superAdminId,
      },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        designation: true,
        department: true,
        defaultLocation: true,
        profilePicture: true,
        updatedAt: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Super Admin profile updated successfully',
      data: updatedSuperAdmin,
    });
  } catch (error) {
    console.error('Update Super Admin Profile Error:', error);

    // Prisma unique constraint (email / phone)
    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: `Duplicate value for field: ${error.meta.target.join(', ')}`,
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to update super admin profile',
    });
  }
};

export const getDashboardStats = async (req, res) => {
  try {
    // Get active companies count
    const activeCompanies = await prisma.company.count({
      where: {
        isActive: true,
      },
    });

    // Get suspended companies count (inactive companies)
    const suspendedCompanies = await prisma.company.count({
      where: {
        isActive: false,
      },
    });

    // Get total users across all companies (excluding SUPER_ADMIN)
    const totalUsers = await prisma.user.count({
      where: {
        userType: {
          in: ['COMPANY_ADMIN', 'EMPLOYEE'],
        },
      },
    });

    // Get active projects across all companies
    const activeProjects = await prisma.project.count({
      where: {
        status: {
          in: ['PLANNING', 'ONGOING'],
        },
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        activeCompanies,
        suspendedCompanies,
        totalUsers,
        activeProjects,
      },
    });
  } catch (error) {
    console.error('Get Dashboard Stats Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard statistics',
    });
  }
};

export const getRecentActivities = async (req, res) => {
  try {
    // Get recent company creations (last 30 days)
    const recentCompanies = await prisma.company.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
        },
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
        createdBy: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 5,
    });

    // Get recently suspended companies
    const suspendedCompanies = await prisma.company.findMany({
      where: {
        isActive: false,
        updatedAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
      select: {
        id: true,
        name: true,
        updatedAt: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: 5,
    });

    // Get inactive companies (no activity for 15+ days)
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);

    // Get companies with no recent activity
    const companiesWithProjects = await prisma.project.groupBy({
      by: ['companyId'],
      where: {
        updatedAt: {
          gte: fifteenDaysAgo,
        },
      },
    });

    const companiesWithUsers = await prisma.user.groupBy({
      by: ['companyId'],
      where: {
        userType: 'COMPANY_ADMIN',
        lastLogin: {
          gte: fifteenDaysAgo,
        },
      },
    });

    const activeCompanyIds = [
      ...new Set([
        ...companiesWithProjects.map((c) => c.companyId),
        ...companiesWithUsers.map((u) => u.companyId),
      ]),
    ];

    const inactiveCompanies = await prisma.company.findMany({
      where: {
        isActive: true,
        id: {
          notIn: activeCompanyIds,
        },
      },
      select: {
        id: true,
        name: true,
        updatedAt: true,
      },
      orderBy: {
        updatedAt: 'asc',
      },
      take: 5,
    });

    // Format activities
    const activities = [];

    // Add new company activities
    recentCompanies.forEach((company) => {
      const daysAgo = Math.floor(
        (Date.now() - new Date(company.createdAt).getTime()) /
          (1000 * 60 * 60 * 24)
      );
      let timeText;

      if (daysAgo === 0) {
        timeText = 'today';
      } else if (daysAgo === 1) {
        timeText = 'yesterday';
      } else {
        timeText = `${daysAgo} days ago`;
      }

      activities.push({
        id: `new-company-${company.id}`,
        type: 'company_created',
        title: 'New Company Created',
        description: `${company.name} registered successfully`,
        timestamp: company.createdAt,
        timeText: timeText,
      });
    });

    // Add suspended company activities
    suspendedCompanies.forEach((company) => {
      const daysAgo = Math.floor(
        (Date.now() - new Date(company.updatedAt).getTime()) /
          (1000 * 60 * 60 * 24)
      );
      let timeText;

      if (daysAgo === 0) {
        timeText = 'today';
      } else if (daysAgo === 1) {
        timeText = 'yesterday';
      } else {
        timeText = `${daysAgo} days ago`;
      }

      activities.push({
        id: `suspended-company-${company.id}`,
        type: 'company_suspended',
        title: 'Company Suspended',
        description: `${company.name} suspended due to policy violation`,
        timestamp: company.updatedAt,
        timeText: timeText,
      });
    });

    // Add inactive company warnings
    inactiveCompanies.forEach((company) => {
      const daysInactive = Math.floor(
        (Date.now() - new Date(company.updatedAt).getTime()) /
          (1000 * 60 * 60 * 24)
      );

      activities.push({
        id: `inactive-company-${company.id}`,
        type: 'inactive_warning',
        title: 'Inactive Company Warning',
        description: `${company.name} has shown no activity for ${daysInactive} days`,
        timestamp: company.updatedAt,
        timeText: `${daysInactive}d ago`,
      });
    });

    // Sort activities by timestamp (most recent first) and limit to 10
    const sortedActivities = activities
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      .slice(0, 10);

    return res.status(200).json({
      success: true,
      data: sortedActivities,
    });
  } catch (error) {
    console.error('Get Recent Activities Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch recent activities',
    });
  }
};

export const getDashboardData = async (req, res) => {
  try {
    // Get all stats in parallel
    const [
      activeCompanies,
      suspendedCompanies,
      totalUsers,
      activeProjects,
      activities,
    ] = await Promise.all([
      // Active companies count
      prisma.company.count({
        where: { isActive: true },
      }),

      // Suspended companies count
      prisma.company.count({
        where: { isActive: false },
      }),

      // Total users count (excluding SUPER_ADMIN)
      prisma.user.count({
        where: {
          userType: {
            in: ['COMPANY_ADMIN', 'EMPLOYEE'],
          },
        },
      }),

      // Active projects count
      prisma.project.count({
        where: {
          status: {
            in: ['PLANNING', 'ONGOING'],
          },
        },
      }),

      // Get recent activities
      getRecentActivitiesData(),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        stats: {
          activeCompanies,
          suspendedCompanies,
          totalUsers,
          activeProjects,
        },
        recentActivities: activities,
      },
    });
  } catch (error) {
    console.error('Get Dashboard Data Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data',
    });
  }
};

// Get all companies with filters
export const getAllCompanies = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status = 'all',
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Build where clause
    const where = {};

    if (search) {
      where.name = {
        contains: search,
        mode: 'insensitive',
      };
    }

    if (status !== 'all') {
      where.isActive = status === 'active';
    }

    // Get companies
    const [companies, total] = await Promise.all([
      prisma.company.findMany({
        where,
        skip,
        take,
        orderBy: {
          [sortBy]: sortOrder,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          officeAddress: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              users: {
                where: {
                  userType: 'COMPANY_ADMIN',
                },
              },
              // employees: true,
              projects: true,
            },
          },
        },
      }),
      prisma.company.count({ where }),
    ]);

    // Format response
    const formattedCompanies = companies.map((company) => ({
      ...company,
      address: company.officeAddress,
      adminCount: company._count.users,
      employeeCount: company._count.employees,
      projectCount: company._count.projects,
      _count: undefined,
    }));

    return res.status(200).json({
      success: true,
      data: {
        companies: formattedCompanies,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error('Get All Companies Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch companies',
    });
  }
};

// Get company details
export const getCompanyDetails = async (req, res) => {
  try {
    const { companyId } = req.params;

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        users: {
          where: { userType: 'COMPANY_ADMIN' },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            isActive: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            employees: true,
            projects: true,
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

    // Get project stats
    const projectStats = await prisma.project.groupBy({
      by: ['status'],
      where: { companyId },
      _count: true,
    });

    const formattedCompany = {
      ...company,
      stats: {
        employees: company._count.employees,
        projects: company._count.projects,
        activeProjects:
          projectStats.find(
            (p) => p.status === 'ONGOING' || p.status === 'PLANNING'
          )?._count || 0,
        completedProjects:
          projectStats.find((p) => p.status === 'COMPLETED')?._count || 0,
      },
      _count: undefined,
    };

    return res.status(200).json({
      success: true,
      data: formattedCompany,
    });
  } catch (error) {
    console.error('Get Company Details Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch company details',
    });
  }
};

// Update company status
export const updateCompanyStatus = async (req, res) => {
  try {
    const { companyId } = req.params;
    const { isActive, reason } = req.body;
    const superAdminId = req.user.userId;

    const company = await prisma.company.update({
      where: { id: companyId },
      data: {
        isActive,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        isActive: true,
        updatedAt: true,
      },
    });

    // Log the action (you might want to create an audit log table)
    console.log(
      `Company ${companyId} status changed to ${isActive} by ${superAdminId}. Reason: ${reason}`
    );

    return res.status(200).json({
      success: true,
      message: `Company ${isActive ? 'activated' : 'suspended'} successfully`,
      data: {
        ...company,
        statusChangedBy: { id: superAdminId },
        reason,
      },
    });
  } catch (error) {
    console.error('Update Company Status Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update company status',
    });
  }
};

// Delete company
export const deleteCompany = async (req, res) => {
  try {
    const { companyId } = req.params;

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

    // Delete company (this will cascade delete related records if schema is set up correctly)
    await prisma.company.delete({
      where: { id: companyId },
    });

    return res.status(200).json({
      success: true,
      message: 'Company and all associated data deleted successfully',
    });
  } catch (error) {
    console.error('Delete Company Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete company',
    });
  }
};

// Get company admins
export const getCompanyAdmins = async (req, res) => {
  try {
    const { companyId } = req.params;
    const { page = 1, limit = 10, status = 'active' } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = {
      companyId,
      userType: 'COMPANY_ADMIN',
    };

    if (status !== 'all') {
      where.isActive = status === 'active';
    }

    const [admins, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          designation: true,
          isActive: true,
          lastLogin: true,
          permissions: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        admins,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error('Get Company Admins Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch company admins',
    });
  }
};

// Create company admin
export const createCompanyAdmin = async (req, res) => {
  try {
    const { companyId } = req.params;
    const { name, email, phone, permissions = [] } = req.body;

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

    // Check if user already exists with same email or phone
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [email ? { email } : {}, { phone }],
      },
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User already exists with this email or phone',
      });
    }

    // Create company admin
    const admin = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        userType: 'COMPANY_ADMIN',
        companyId,
        permissions,
        isActive: true,
        accountSetupCompleted: false,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        userType: true,
        companyId: true,
        isActive: true,
        permissions: true,
        createdAt: true,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Company admin created successfully',
      data: {
        ...admin,
        companyName: company.name,
      },
    });
  } catch (error) {
    console.error('Create Company Admin Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create company admin',
    });
  }
};

// Update admin permissions
export const updateAdminPermissions = async (req, res) => {
  try {
    const { companyId, adminId } = req.params;
    const { permissions } = req.body;

    const admin = await prisma.user.update({
      where: {
        id: adminId,
        companyId,
        userType: 'COMPANY_ADMIN',
      },
      data: {
        permissions,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        permissions: true,
        updatedAt: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Admin permissions updated successfully',
      data: admin,
    });
  } catch (error) {
    console.error('Update Admin Permissions Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update admin permissions',
    });
  }
};

// Toggle admin status
export const toggleAdminStatus = async (req, res) => {
  try {
    const { companyId, adminId } = req.params;
    const { isActive, reason } = req.body;

    const admin = await prisma.user.update({
      where: {
        id: adminId,
        companyId,
        userType: 'COMPANY_ADMIN',
      },
      data: {
        isActive,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        updatedAt: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: `Admin ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: {
        ...admin,
        statusChangedAt: new Date(),
        reason,
      },
    });
  } catch (error) {
    console.error('Toggle Admin Status Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update admin status',
    });
  }
};

// Delete admin
export const deleteAdmin = async (req, res) => {
  try {
    const { companyId, adminId } = req.params;

    await prisma.user.delete({
      where: {
        id: adminId,
        companyId,
        userType: 'COMPANY_ADMIN',
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Company admin deleted successfully',
    });
  } catch (error) {
    console.error('Delete Admin Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete company admin',
    });
  }
};
