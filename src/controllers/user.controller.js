// src/controllers/user.controller.js
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/database.js';
import { sendWelcomeEmail as sendEmailWelcome } from '../services/emailSms.service.js';

// Create Employee (Company Admin can create employees)
export const createEmployee = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      employeeId,
      designation,
      department,
      salary,
      salaryType,
      roleId,
      employeeStatus = 'ACTIVE',
      defaultLocation = 'OFFICE',
      dateOfJoining,
      address,
      emergencyContact,
      emergencyPhone,
      aadharNumber,
      panNumber,
      bankAccount,
      ifscCode,
    } = req.body;

    // Validate at least one contact method
    if (!email && !phone) {
      return res.status(400).json({
        success: false,
        message: 'Either email or phone is required',
      });
    }

    // Check if employee already exists in the company
    const existingEmployee = await prisma.user.findFirst({
      where: {
        OR: [
          ...(email ? [{ email }] : []),
          ...(phone ? [{ phone }] : []),
          ...(employeeId ? [{ employeeId }] : []),
        ],
        companyId: req.user.companyId,
      },
    });

    if (existingEmployee) {
      return res.status(400).json({
        success: false,
        message: 'Employee with similar details already exists in your company',
      });
    }

    // Check if role exists and belongs to the company
    const role = await prisma.role.findFirst({
      where: {
        id: roleId,
        companyId: req.user.companyId,
      },
    });

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found in your company',
      });
    }

    // Create employee WITHOUT password (they will set it up later)
    const employee = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        employeeId,
        password: '', // Empty password - will be set by user
        userType: 'EMPLOYEE',
        companyId: req.user.companyId,
        roleId,
        designation,
        department,
        salary: salary ? parseFloat(salary) : null,
        salaryType,
        employeeStatus,
        defaultLocation,
        dateOfJoining: dateOfJoining ? new Date(dateOfJoining) : null,
        address,
        emergencyContact,
        emergencyPhone,
        aadharNumber,
        panNumber,
        bankAccount,
        ifscCode,
        isActive: true,
        createdById: req.user.userId,
      },
    });

    // Send welcome email/SMS
    if (email || phone) {
      await sendEmailWelcome(
        email,
        phone,
        req.user.company?.name || 'Your Company'
      );
    }

    console.log(`✅ Employee created: ${employee.name} (${employee.id})`);

    res.status(201).json({
      success: true,
      message:
        'Employee created successfully. They need to complete account setup.',
      data: {
        id: employee.id,
        name: employee.name,
        email: employee.email,
        phone: employee.phone,
        employeeId: employee.employeeId,
        designation: employee.designation,
        setupToken: employee.resetPasswordToken,
        needsPasswordSetup: true,
      },
    });
  } catch (error) {
    console.error('Create employee error:', error);

    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'Duplicate entry detected.',
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

// Get All Employees (Company Admin sees all, employees see only relevant)
export const getAllEmployees = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      department,
      status,
      roleId,
      includeProjects = 'false', // New query parameter
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const shouldIncludeProjects = includeProjects === 'true';

    const where = {
      companyId: req.user.companyId,
      userType: {
        in: ['EMPLOYEE', 'COMPANY_ADMIN'],
      },
    };

    // Add search filter
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { employeeId: { contains: search, mode: 'insensitive' } },
        { designation: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Add department filter
    if (department) {
      where.department = department;
    }

    // Add status filter
    if (status === 'active' || status === 'inactive') {
      where.isActive = status === 'active';
    }

    // Add role filter
    if (roleId) {
      where.roleId = roleId;
    }

    // If user is not company admin, only show themselves and their team
    if (req.user.userType !== 'COMPANY_ADMIN') {
      // For now, show only themselves
      // TODO: Implement team-based filtering based on project assignments
      where.userType = 'EMPLOYEE';
    }

    const [employees, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: {
          role: {
            select: {
              id: true,
              name: true,
            },
          },
          // Include project assignments conditionally
          ...(shouldIncludeProjects && {
            projectAssignments: {
              include: {
                project: {
                  select: {
                    id: true,
                    name: true,
                    projectId: true,
                    status: true,
                    priority: true,
                    startDate: true,
                    estimatedEndDate: true,
                    client: {
                      select: {
                        id: true,
                        companyName: true,
                      },
                    },
                  },
                },
                role: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
              take: 5, // Limit to 5 projects per employee for list view
              orderBy: {
                isPrimary: 'desc',
              },
            },
          }),
          _count: {
            select: {
              projectAssignments: true,
              assignedTasks: {
                where: {
                  status: {
                    in: ['TODO', 'IN_PROGRESS'],
                  },
                },
              },
              attendances: {
                where: {
                  date: {
                    gte: new Date(
                      new Date().setDate(new Date().getDate() - 30)
                    ),
                  },
                },
              },
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    // Format response
    const formattedEmployees = employees.map((employee) => {
      const formatted = {
        id: employee.id,
        name: employee.name,
        email: employee.email,
        phone: employee.phone,
        employeeId: employee.employeeId,
        designation: employee.designation,
        department: employee.department,
        salary: employee.salary,
        salaryType: employee.salaryType,
        aadharNumber: employee.aadharNumber,
        employeeStatus: employee.employeeStatus,
        isActive: employee.isActive,
        createdAt: employee.createdAt,
        lastLogin: employee.lastLogin,
        role: employee.role,
        stats: {
          projects: employee._count.projectAssignments,
          pendingTasks: employee._count.assignedTasks,
          attendanceLast30Days: employee._count.attendances,
        },
        needsPasswordSetup: !employee.password || employee.password === '',
      };

      // Add projects if included
      if (shouldIncludeProjects && employee.projectAssignments) {
        formatted.projects = employee.projectAssignments.map((assignment) => ({
          id: assignment.project.id,
          projectId: assignment.project.projectId,
          name: assignment.project.name,
          status: assignment.project.status,
          priority: assignment.project.priority,
          startDate: assignment.project.startDate,
          estimatedEndDate: assignment.project.estimatedEndDate,
          client: assignment.project.client,
          assignment: {
            id: assignment.id,
            designation: assignment.designation,
            isPrimary: assignment.isPrimary,
            startDate: assignment.startDate,
            endDate: assignment.endDate,
            role: assignment.role,
          },
        }));

        // Add project count
        formatted.stats.totalProjects = employee._count.projectAssignments;
      }

      return formatted;
    });

    res.json({
      success: true,
      data: formattedEmployees,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get employees error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Employee by ID
export const getEmployeeById = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user has permission to view this employee
    const employee = await prisma.user.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        userType: {
          in: ['EMPLOYEE', 'COMPANY_ADMIN'],
        },
      },
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
            email: true,
          },
        },
        projectAssignments: {
          include: {
            project: {
              select: {
                id: true,
                name: true,
                projectId: true,
                status: true,
                priority: true,
                progress: true,
                startDate: true,
                estimatedEndDate: true,
                location: true,
                estimatedBudget: true,
                contractValue: true,
                client: {
                  select: {
                    id: true,
                    companyName: true,
                    contactPerson: true,
                  },
                },
              },
            },
            role: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: {
            isPrimary: 'desc', // Primary assignments first
          },
        },
        settings: true,
        // Add assigned tasks count per project
        assignedTasks: {
          where: {
            status: {
              in: ['TODO', 'IN_PROGRESS'],
            },
          },
          select: {
            id: true,
            projectId: true,
            title: true,
            status: true,
          },
        },
      },
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    // Check if user has permission to view this employee
    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      employee.id !== req.user.userId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view your own profile.',
      });
    }

    // Group tasks by project for easier access
    const tasksByProject = employee.assignedTasks.reduce((acc, task) => {
      if (!acc[task.projectId]) {
        acc[task.projectId] = [];
      }
      acc[task.projectId].push({
        id: task.id,
        title: task.title,
        status: task.status,
      });
      return acc;
    }, {});

    // Enhance project assignments with task counts
    const enhancedProjectAssignments = employee.projectAssignments.map(
      (assignment) => ({
        ...assignment,
        tasks: tasksByProject[assignment.project.id] || [],
        taskCount: tasksByProject[assignment.project.id]?.length || 0,
      })
    );

    // Sanitize response
    const { password, refreshToken, resetPasswordToken, ...employeeResponse } =
      employee;

    // Format permissions
    if (employeeResponse.role && employeeResponse.role.rolePermissions) {
      employeeResponse.role.permissions =
        employeeResponse.role.rolePermissions.map((rp) => rp.permission.code);
      delete employeeResponse.role.rolePermissions;
    }

    // Replace original projectAssignments with enhanced version
    employeeResponse.projectAssignments = enhancedProjectAssignments;

    // Remove the raw assignedTasks from response
    delete employeeResponse.assignedTasks;

    res.json({
      success: true,
      data: employeeResponse,
    });
  } catch (error) {
    console.error('Get employee error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update Employee
export const updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Check if employee exists and belongs to company
    const employee = await prisma.user.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        userType: {
          in: ['EMPLOYEE', 'COMPANY_ADMIN'],
        },
      },
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    // Check permissions
    const isSelfUpdate = id === req.user.userId;
    const isAdminUpdate = req.user.userType === 'COMPANY_ADMIN';

    if (!isSelfUpdate && !isAdminUpdate) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only update your own profile.',
      });
    }

    // Prevent employees from updating sensitive fields
    if (!isAdminUpdate) {
      // Employees can only update these fields
      const allowedFields = [
        'address',
        'emergencyContact',
        'emergencyPhone',
        'profilePicture',
      ];

      const unauthorizedFields = Object.keys(updates).filter(
        (field) => !allowedFields.includes(field)
      );

      if (unauthorizedFields.length > 0) {
        return res.status(403).json({
          success: false,
          message: `You are not authorized to update: ${unauthorizedFields.join(', ')}`,
        });
      }
    }

    // Convert salary to number if present
    if (updates.salary !== undefined) {
      updates.salary = updates.salary ? parseFloat(updates.salary) : null;
    }

    // Convert date fields
    if (updates.dateOfJoining) {
      updates.dateOfJoining = new Date(updates.dateOfJoining);
    }

    const updatedEmployee = await prisma.user.update({
      where: { id },
      data: updates,
    });

    res.json({
      success: true,
      message: 'Employee updated successfully',
      data: {
        id: updatedEmployee.id,
        name: updatedEmployee.name,
        email: updatedEmployee.email,
        designation: updatedEmployee.designation,
      },
    });
  } catch (error) {
    console.error('Update employee error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Delete Employee (Soft delete - set isActive to false)
export const deleteEmployee = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if employee exists and belongs to company
    const employee = await prisma.user.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        userType: 'EMPLOYEE',
      },
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    // Soft delete by deactivating
    await prisma.user.update({
      where: { id },
      data: {
        isActive: false,
        employeeStatus: 'TERMINATED',
      },
    });

    res.json({
      success: true,
      message: 'Employee deactivated successfully',
    });
  } catch (error) {
    console.error('Delete employee error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update Employee Role
export const updateEmployeeRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { roleId } = req.body;

    // Check if employee exists and belongs to company
    const employee = await prisma.user.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        userType: 'EMPLOYEE',
      },
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    // Check if role exists and belongs to company
    const role = await prisma.role.findFirst({
      where: {
        id: roleId,
        companyId: req.user.companyId,
      },
    });

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found in your company',
      });
    }

    const updatedEmployee = await prisma.user.update({
      where: { id },
      data: { roleId },
    });

    res.json({
      success: true,
      message: 'Employee role updated successfully',
      data: {
        id: updatedEmployee.id,
        name: updatedEmployee.name,
        role: {
          id: role.id,
          name: role.name,
        },
      },
    });
  } catch (error) {
    console.error('Update employee role error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Reset Employee Password (Admin can reset)
export const resetEmployeePassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { forceReset = true } = req.body;

    // Check if employee exists and belongs to company
    const employee = await prisma.user.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        userType: 'EMPLOYEE',
      },
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    // Generate new setup token
    const resetPasswordToken = uuidv4();
    const resetPasswordExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await prisma.user.update({
      where: { id },
      data: {
        password: '', // Clear password
        isActive: false, // Deactivate until they set new password
        emailVerified: false, // Require re-verification
        phoneVerified: false,
      },
    });

    // Send reset email/SMS
    if (employee.email || employee.phone) {
      await sendEmailWelcome(
        employee.email,
        employee.phone,
        req.user.company?.name || 'Your Company'
      );
    }

    res.json({
      success: true,
      message:
        'Password reset initiated. Employee will receive setup instructions.',
      data: {
        id: employee.id,
        name: employee.name,
        newSetupToken: resetPasswordToken,
      },
    });
  } catch (error) {
    console.error('Reset employee password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Toggle Employee Status (Activate/Deactivate)
export const toggleEmployeeStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive, reason } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isActive must be a boolean',
      });
    }

    // Check if employee exists and belongs to company
    const employee = await prisma.user.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        userType: 'EMPLOYEE',
      },
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    const updatedEmployee = await prisma.user.update({
      where: { id },
      data: {
        isActive,
        employeeStatus: isActive ? 'ACTIVE' : 'INACTIVE',
      },
    });

    // Log the status change in audit log
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: isActive ? 'EMPLOYEE_ACTIVATED' : 'EMPLOYEE_DEACTIVATED',
        entityType: 'USER',
        entityId: id,
        oldData: { isActive: employee.isActive },
        newData: { isActive },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: `Employee ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: {
        id: updatedEmployee.id,
        name: updatedEmployee.name,
        isActive: updatedEmployee.isActive,
        employeeStatus: updatedEmployee.employeeStatus,
      },
    });
  } catch (error) {
    console.error('Toggle employee status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Send Welcome Email/SMS (RENAMED FUNCTION)
export const sendWelcomeToEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const { sendEmail = true, sendSMS = true } = req.body;

    // Check if employee exists and belongs to company
    const employee = await prisma.user.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        userType: 'EMPLOYEE',
      },
      include: {
        company: true,
      },
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    let emailSent = false;
    let smsSent = false;

    // Send email if requested and employee has email
    if (sendEmail && employee.email) {
      emailSent = await sendEmailWelcome(
        employee.email,
        employee.phone,
        employee.company?.name || 'Your Company'
      );
    }

    // Send SMS if requested and employee has phone
    if (sendSMS && employee.phone) {
      // Implement SMS sending logic here
      // smsSent = await sendWelcomeSMS(employee.phone, employee.company?.name);
      smsSent = true; // Placeholder
    }

    res.json({
      success: true,
      message: 'Welcome message sent successfully',
      data: {
        emailSent,
        smsSent,
        employee: {
          id: employee.id,
          name: employee.name,
          email: employee.email,
          phone: employee.phone,
        },
      },
    });
  } catch (error) {
    console.error('Send welcome email error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send welcome message',
    });
  }
};

// Get Employee Dashboard
export const getEmployeeDashboard = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get employee data with stats
    const employee = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            logo: true,
          },
        },
        role: {
          select: {
            id: true,
            name: true,
          },
        },
        projectAssignments: {
          include: {
            project: {
              select: {
                id: true,
                name: true,
                status: true,
                progress: true,
              },
            },
          },
          take: 5,
        },
        assignedTasks: {
          where: {
            status: {
              in: ['TODO', 'IN_PROGRESS'],
            },
          },
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueDate: true,
            project: {
              select: {
                name: true,
              },
            },
          },
          take: 10,
          orderBy: { dueDate: 'asc' },
        },
        _count: {
          select: {
            assignedTasks: {
              where: {
                status: {
                  in: ['TODO', 'IN_PROGRESS'],
                },
              },
            },
            attendances: {
              where: {
                date: {
                  gte: new Date(new Date().setDate(new Date().getDate() - 30)),
                },
              },
            },
          },
        },
      },
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    // Get today's attendance
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayAttendance = await prisma.attendance.findFirst({
      where: {
        userId,
        date: {
          gte: today,
          lt: tomorrow,
        },
      },
    });

    // Get upcoming leaves
    const upcomingLeaves = await prisma.leave.findMany({
      where: {
        userId,
        status: 'APPROVED',
        startDate: {
          gte: new Date(),
        },
      },
      select: {
        id: true,
        type: true,
        startDate: true,
        endDate: true,
        totalDays: true,
      },
      take: 5,
      orderBy: { startDate: 'asc' },
    });

    // Get recent notifications
    const recentNotifications = await prisma.notification.findMany({
      where: {
        userId,
        createdAt: {
          gte: new Date(new Date().setDate(new Date().getDate() - 7)),
        },
      },
      select: {
        id: true,
        title: true,
        message: true,
        type: true,
        isRead: true,
        createdAt: true,
      },
      take: 10,
      orderBy: { createdAt: 'desc' },
    });

    const dashboardData = {
      employee: {
        id: employee.id,
        name: employee.name,
        email: employee.email,
        phone: employee.phone,
        designation: employee.designation,
        department: employee.department,
        profilePicture: employee.profilePicture,
      },
      company: employee.company,
      role: employee.role,
      stats: {
        activeProjects: employee.projectAssignments.length,
        pendingTasks: employee._count.assignedTasks,
        attendanceLast30Days: employee._count.attendances,
        upcomingLeaves: upcomingLeaves.length,
        unreadNotifications: recentNotifications.filter((n) => !n.isRead)
          .length,
      },
      todayAttendance: todayAttendance || { status: 'NOT_MARKED' },
      recentProjects: employee.projectAssignments,
      pendingTasks: employee.assignedTasks,
      upcomingLeaves,
      recentNotifications,
    };

    res.json({
      success: true,
      data: dashboardData,
    });
  } catch (error) {
    console.error('Get employee dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update Employee Permissions (via role)
export const updateEmployeePermissions = async (req, res) => {
  try {
    const { id } = req.params;
    const { permissions } = req.body;

    if (!permissions || !Array.isArray(permissions)) {
      return res.status(400).json({
        success: false,
        message: 'Permissions array is required',
      });
    }

    // Check if employee exists and belongs to company
    const employee = await prisma.user.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        userType: 'EMPLOYEE',
      },
      include: {
        role: true,
      },
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    // Get permissions to assign
    const permissionsToAssign = await prisma.permission.findMany({
      where: {
        code: { in: permissions },
      },
    });

    // Update role permissions
    await prisma.$transaction(async (tx) => {
      // Remove existing permissions from role
      await tx.rolePermission.deleteMany({
        where: {
          roleId: employee.roleId,
        },
      });

      // Add new permissions to role
      for (const permission of permissionsToAssign) {
        await tx.rolePermission.create({
          data: {
            roleId: employee.roleId,
            permissionId: permission.id,
            grantedById: req.user.userId,
          },
        });
      }
    });

    res.json({
      success: true,
      message: 'Employee permissions updated successfully',
      data: {
        employeeId: employee.id,
        roleId: employee.roleId,
        permissionsUpdated: permissionsToAssign.length,
        permissions: permissionsToAssign.map((p) => p.code),
      },
    });
  } catch (error) {
    console.error('Update employee permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Employee Projects
export const getEmployeeProjects = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if employee exists and belongs to company
    const employee = await prisma.user.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        userType: {
          in: ['EMPLOYEE', 'COMPANY_ADMIN'],
        },
      },
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    // Check if user has permission to view this employee's projects
    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      employee.id !== req.user.userId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view your own projects.',
      });
    }

    // Get all project assignments with full project details
    const projectAssignments = await prisma.projectAssignment.findMany({
      where: {
        userId: id,
      },
      include: {
        project: {
          include: {
            client: {
              select: {
                id: true,
                companyName: true,
                contactPerson: true,
              },
            },
            _count: {
              select: {
                tasks: true,
                projectAssignments: true,
              },
            },
          },
        },
        role: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        isPrimary: 'desc',
      },
    });

    // Get task counts per project for this employee
    const tasksPerProject = await prisma.task.groupBy({
      by: ['projectId'],
      where: {
        assignedToId: id,
        projectId: {
          in: projectAssignments.map((pa) => pa.projectId),
        },
      },
      _count: {
        _all: true,
      },
    });

    // Create a map of projectId to task count
    const taskCountMap = tasksPerProject.reduce((acc, item) => {
      acc[item.projectId] = item._count._all;
      return acc;
    }, {});

    // Format response
    const formattedProjects = projectAssignments.map((assignment) => ({
      assignment: {
        id: assignment.id,
        designation: assignment.designation,
        isPrimary: assignment.isPrimary,
        startDate: assignment.startDate,
        endDate: assignment.endDate,
        role: assignment.role,
      },
      project: {
        id: assignment.project.id,
        projectId: assignment.project.projectId,
        name: assignment.project.name,
        description: assignment.project.description,
        location: assignment.project.location,
        status: assignment.project.status,
        priority: assignment.project.priority,
        progress: assignment.project.progress,
        startDate: assignment.project.startDate,
        estimatedEndDate: assignment.project.estimatedEndDate,
        actualEndDate: assignment.project.actualEndDate,
        estimatedBudget: assignment.project.estimatedBudget,
        contractValue: assignment.project.contractValue,
        client: assignment.project.client,
        stats: {
          totalTasks: assignment.project._count.tasks,
          totalTeamMembers: assignment.project._count.projectAssignments,
          myTasks: taskCountMap[assignment.project.id] || 0,
        },
      },
    }));

    res.json({
      success: true,
      data: {
        employee: {
          id: employee.id,
          name: employee.name,
          email: employee.email,
          designation: employee.designation,
        },
        totalProjects: formattedProjects.length,
        projects: formattedProjects,
      },
    });
  } catch (error) {
    console.error('Get employee projects error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
