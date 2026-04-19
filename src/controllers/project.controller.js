// src/controllers/project.controller.js
import prisma from '../config/database.js';

// Helper function to check project permissions
const checkProjectPermission = async (userId, companyId, permissionCode) => {
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

// Create Project
export const createProject = async (req, res) => {
  try {
    const {
      projectId,
      name,
      description,
      location,
      latitude,
      longitude,
      geofenceRadius,
      estimatedBudget,
      contractValue,
      advanceReceived,
      clientId,
      startDate,
      estimatedEndDate,
      priority,
    } = req.body;

    // Check CREATE_PROJECT permission
    const hasPermission = await checkProjectPermission(
      req.user.userId,
      req.user.companyId,
      'PROJECT_CREATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create projects',
      });
    }

    // Check if project ID already exists in company
    const existingProject = await prisma.project.findFirst({
      where: {
        projectId,
        companyId: req.user.companyId,
      },
    });

    if (existingProject) {
      return res.status(400).json({
        success: false,
        message: 'Project ID already exists in your company',
      });
    }

    // Check if client exists and belongs to company
    if (clientId) {
      const client = await prisma.client.findFirst({
        where: {
          id: clientId,
          companyId: req.user.companyId,
        },
      });

      if (!client) {
        return res.status(400).json({
          success: false,
          message: 'Client not found in your company',
        });
      }
    }

    // Start transaction to create project and assign creator
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create project
      const project = await tx.project.create({
        data: {
          projectId,
          name,
          description,
          location,
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          geofenceRadius: parseFloat(geofenceRadius) || 200,
          estimatedBudget: parseFloat(estimatedBudget),
          contractValue: contractValue ? parseFloat(contractValue) : null,
          advanceReceived: advanceReceived ? parseFloat(advanceReceived) : 0,
          clientId,
          startDate: new Date(startDate),
          estimatedEndDate: new Date(estimatedEndDate),
          priority: priority || 'MEDIUM',
          status: 'PLANNING',
          progress: 0,
          companyId: req.user.companyId,
          createdById: req.user.userId,
        },
      });

      // 2. Automatically assign project creator to the project
      await tx.projectAssignment.create({
        data: {
          userId: req.user.userId,
          projectId: project.id,
          designation: 'Project Creator / Manager',
          startDate: new Date(startDate),
          isPrimary: true,
        },
      });

      // 3. Create project settings
      await tx.projectSettings.create({
        data: {
          projectId: project.id,
        },
      });

      return project;
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'PROJECT_CREATED',
        entityType: 'PROJECT',
        entityId: result.id,
        newData: { name, projectId },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message:
        'Project created successfully. You have been automatically assigned as Project Manager.',
      data: result,
    });
  } catch (error) {
    console.error('Create project error:', error);

    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'Project with similar details already exists',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get All Projects (with permission-based filtering)
export const getAllProjects = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status,
      priority,
      clientId,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check READ_PROJECT permission
    const hasPermission = await checkProjectPermission(
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

    // Add status filter
    if (status) {
      where.status = status;
    }

    // Add priority filter
    if (priority) {
      where.priority = priority;
    }

    // Add client filter
    if (clientId) {
      where.clientId = clientId;
    }

    // For non-admin users (EMPLOYEES)
    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
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

      const hasAllProjectsAccess = user.role?.rolePermissions.some(
        (rp) =>
          rp.permission.code === 'VIEW_ALL_PROJECTS' ||
          rp.permission.code === 'ALL_ACCESS' ||
          rp.permission.code === 'FULL_COMPANY_ACCESS'
      );

      if (!hasAllProjectsAccess) {
        // Get projects created by user
        const createdProjects = await prisma.project.findMany({
          where: { createdById: req.user.userId },
          select: { id: true },
        });

        // Get projects assigned to user
        const userAssignments = await prisma.projectAssignment.findMany({
          where: { userId: req.user.userId },
          select: { projectId: true },
        });

        const createdProjectIds = createdProjects.map((p) => p.id);
        const assignedProjectIds = userAssignments.map((pa) => pa.projectId);
        const accessibleProjectIds = [
          ...new Set([...createdProjectIds, ...assignedProjectIds]),
        ];

        where.id = { in: accessibleProjectIds };
      }
    }

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        include: {
          client: {
            select: {
              id: true,
              companyName: true,
              contactPerson: true,
            },
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
              tasks: true,
              projectAssignments: true,
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

    // Format response with additional data
    const formattedProjects = projects.map((project) => ({
      id: project.id,
      projectId: project.projectId,
      name: project.name,
      location: project.location,
      status: project.status,
      priority: project.priority,
      progress: project.progress,
      estimatedBudget: project.estimatedBudget,
      startDate: project.startDate,
      estimatedEndDate: project.estimatedEndDate,
      client: project.client,
      createdAt: project.createdAt,
      stats: {
        tasks: project._count.tasks,
        teamMembers: project._count.projectAssignments,
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
    console.error('Get projects error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Project by ID
export const getProjectById = async (req, res) => {
  try {
    const { id } = req.params;

    // Check READ_PROJECT permission
    const hasPermission = await checkProjectPermission(
      req.user.userId,
      req.user.companyId,
      'PROJECT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view project details',
      });
    }

    const project = await prisma.project.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
      include: {
        client: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        projectAssignments: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                designation: true,
              },
            },
          },
        },
        milestones: {
          orderBy: { dueDate: 'asc' },
        },
        tasks: {
          where: {
            status: { in: ['TODO', 'IN_PROGRESS'] },
          },
          include: {
            assignedTo: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: { dueDate: 'asc' },
          take: 10,
        },
        dprs: {
          orderBy: { date: 'desc' },
          take: 5,
        },
        expenses: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        projectSettings: true,
        _count: {
          select: {
            tasks: true,
            projectAssignments: true,
            expenses: true,
            materialRequests: true,
            invoices: true,
            dprs: true,
          },
        },
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found',
      });
    }

    // Check if user has access to this project
    // SUPER_ADMIN and COMPANY_ADMIN have full access
    if (
      req.user.userType === 'SUPER_ADMIN' ||
      req.user.userType === 'COMPANY_ADMIN'
    ) {
      // Admin users can access any project in their company
      // No additional check needed
    } else {
      // For EMPLOYEE users
      // Check if user is the project creator
      const isProjectCreator = project.createdById === req.user.userId;

      // Check if user is assigned to the project
      const isAssigned = project.projectAssignments.some(
        (assignment) => assignment.userId === req.user.userId
      );

      // Check if user has special permission to view all projects
      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
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

      const hasAllProjectsAccess = user.role?.rolePermissions.some(
        (rp) =>
          rp.permission.code === 'VIEW_ALL_PROJECTS' ||
          rp.permission.code === 'ALL_ACCESS' ||
          rp.permission.code === 'FULL_COMPANY_ACCESS'
      );

      // Allow access if:
      // 1. User created the project, OR
      // 2. User is assigned to the project, OR
      // 3. User has special permission to view all projects
      if (!isProjectCreator && !isAssigned && !hasAllProjectsAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this project',
        });
      }
    }

    res.json({
      success: true,
      data: project,
    });
  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update Project
export const updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Check UPDATE_PROJECT permission
    const hasPermission = await checkProjectPermission(
      req.user.userId,
      req.user.companyId,
      'PROJECT_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update projects',
      });
    }

    // Check if project exists and belongs to company
    const project = await prisma.project.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found',
      });
    }

    // Check if user has access to update this project
    // For non-admin users, they must be creator or assigned
    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      const isProjectCreator = project.createdById === req.user.userId;

      const isAssigned = await prisma.projectAssignment.findFirst({
        where: {
          projectId: id,
          userId: req.user.userId,
        },
      });

      if (!isProjectCreator && !isAssigned) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to update this project',
        });
      }
    }

    // Convert numeric fields
    if (updates.latitude) updates.latitude = parseFloat(updates.latitude);
    if (updates.longitude) updates.longitude = parseFloat(updates.longitude);
    if (updates.geofenceRadius)
      updates.geofenceRadius = parseFloat(updates.geofenceRadius);
    if (updates.estimatedBudget)
      updates.estimatedBudget = parseFloat(updates.estimatedBudget);
    if (updates.contractValue)
      updates.contractValue = parseFloat(updates.contractValue);
    if (updates.advanceReceived)
      updates.advanceReceived = parseFloat(updates.advanceReceived);
    if (updates.progress) updates.progress = parseInt(updates.progress);

    // Convert date fields
    if (updates.startDate) updates.startDate = new Date(updates.startDate);
    if (updates.estimatedEndDate)
      updates.estimatedEndDate = new Date(updates.estimatedEndDate);
    if (updates.actualEndDate)
      updates.actualEndDate = new Date(updates.actualEndDate);

    const updatedProject = await prisma.project.update({
      where: { id },
      data: updates,
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'PROJECT_UPDATED',
        entityType: 'PROJECT',
        entityId: id,
        oldData: project,
        newData: updatedProject,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Project updated successfully',
      data: updatedProject,
    });
  } catch (error) {
    console.error('Update project error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Delete Project
export const deleteProject = async (req, res) => {
  try {
    const { id } = req.params;

    // Check DELETE_PROJECT permission
    const hasPermission = await checkProjectPermission(
      req.user.userId,
      req.user.companyId,
      'PROJECT_DELETE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete projects',
      });
    }

    // Check if project exists and belongs to company
    const project = await prisma.project.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
      include: {
        _count: {
          select: {
            tasks: true,
            expenses: true,
            invoices: true,
            materialRequests: true,
          },
        },
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found',
      });
    }

    // Check if user has access to delete this project
    // For non-admin users, they must be the creator
    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      const isProjectCreator = project.createdById === req.user.userId;

      if (!isProjectCreator) {
        return res.status(403).json({
          success: false,
          message: 'You can only delete projects you created',
        });
      }
    }

    // Check if project has related data
    const hasRelatedData =
      project._count.tasks > 0 ||
      project._count.expenses > 0 ||
      project._count.invoices > 0 ||
      project._count.materialRequests > 0;

    if (hasRelatedData) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete project with related data. Archive it instead.',
      });
    }

    await prisma.project.delete({
      where: { id },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'PROJECT_DELETED',
        entityType: 'PROJECT',
        entityId: id,
        oldData: project,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Project deleted successfully',
    });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Assign Team to Project
export const assignTeamToProject = async (req, res) => {
  try {
    const { id } = req.params;
    const { assignments } = req.body;

    // Check PROJECT_UPDATE permission
    const hasPermission = await checkProjectPermission(
      req.user.userId,
      req.user.companyId,
      'PROJECT_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to assign team to projects',
      });
    }

    // Check if project exists and belongs to company
    const project = await prisma.project.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found',
      });
    }

    // Check if user has access to assign team to this project
    // For non-admin users, they must be creator or assigned
    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      const isProjectCreator = project.createdById === req.user.userId;

      const isAssigned = await prisma.projectAssignment.findFirst({
        where: {
          projectId: id,
          userId: req.user.userId,
        },
      });

      if (!isProjectCreator && !isAssigned) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to assign team to this project',
        });
      }
    }

    // Validate assignments
    for (const assignment of assignments) {
      const user = await prisma.user.findFirst({
        where: {
          id: assignment.userId,
          companyId: req.user.companyId,
        },
      });

      if (!user) {
        return res.status(400).json({
          success: false,
          message: `User ${assignment.userId} not found in your company`,
        });
      }
    }

    // Start transaction
    await prisma.$transaction(async (tx) => {
      // Remove existing assignments for this project (optional)
      // If you want to replace all assignments, uncomment:
      // await tx.projectAssignment.deleteMany({
      //   where: { projectId: id },
      // });

      // Create new assignments
      for (const assignment of assignments) {
        await tx.projectAssignment.create({
          data: {
            userId: assignment.userId,
            projectId: id,
            roleId: assignment.roleId,
            designation: assignment.designation,
            startDate: new Date(assignment.startDate),
            endDate: assignment.endDate ? new Date(assignment.endDate) : null,
            isPrimary: assignment.isPrimary || false,
          },
        });
      }
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'PROJECT_TEAM_ASSIGNED',
        entityType: 'PROJECT',
        entityId: id,
        newData: { assignments },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Team assigned to project successfully',
    });
  } catch (error) {
    console.error('Assign team error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Project Team
export const getProjectTeam = async (req, res) => {
  try {
    const { id } = req.params;

    // Check PROJECT_READ permission
    const hasPermission = await checkProjectPermission(
      req.user.userId,
      req.user.companyId,
      'PROJECT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view project team',
      });
    }

    const project = await prisma.project.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found',
      });
    }

    // Check if user has access to view team
    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      const isProjectCreator = project.createdById === req.user.userId;

      const isAssigned = await prisma.projectAssignment.findFirst({
        where: {
          projectId: id,
          userId: req.user.userId,
        },
      });

      if (!isProjectCreator && !isAssigned) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to view this project team',
        });
      }
    }

    const team = await prisma.projectAssignment.findMany({
      where: {
        projectId: id,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            designation: true,
            department: true,
            profilePicture: true,
          },
        },
        role: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { isPrimary: 'desc' },
    });

    res.json({
      success: true,
      data: team,
    });
  } catch (error) {
    console.error('Get project team error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Project Statistics
export const getProjectStatistics = async (req, res) => {
  try {
    const { id } = req.params;

    // Check PROJECT_READ permission
    const hasPermission = await checkProjectPermission(
      req.user.userId,
      req.user.companyId,
      'PROJECT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view project statistics',
      });
    }

    const project = await prisma.project.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found',
      });
    }

    // Check if user has access to view statistics
    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      const isProjectCreator = project.createdById === req.user.userId;

      const isAssigned = await prisma.projectAssignment.findFirst({
        where: {
          projectId: id,
          userId: req.user.userId,
        },
      });

      if (!isProjectCreator && !isAssigned) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to view this project statistics',
        });
      }
    }

    // Run all database queries concurrently
    const [
      tasksByStatus,
      expensesByCategory,
      totalExpenses,
      completedMilestones,
      totalMilestones,
      teamCount,
      attendanceStats,
      activeBudget,
    ] = await Promise.all([
      // Task statistics
      prisma.task.groupBy({
        by: ['status'],
        where: { projectId: id },
        _count: true,
      }),

      // Expense statistics
      prisma.expense.groupBy({
        by: ['category'],
        where: {
          projectId: id,
          status: 'COMPLETED',
        },
        _sum: {
          amount: true,
        },
      }),

      // Total expenses
      prisma.expense.aggregate({
        where: {
          projectId: id,
          status: 'COMPLETED',
        },
        _sum: {
          amount: true,
        },
      }),

      // Completed milestones
      prisma.milestone.count({
        where: {
          projectId: id,
          status: 'COMPLETED',
        },
      }),

      // Total milestones
      prisma.milestone.count({
        where: { projectId: id },
      }),

      // Team count
      prisma.projectAssignment.count({
        where: { projectId: id },
      }),

      // Attendance stats (last 30 days)
      prisma.attendance.groupBy({
        by: ['status'],
        where: {
          projectId: id,
          date: {
            gte: new Date(new Date().setDate(new Date().getDate() - 30)),
          },
        },
        _count: true,
      }),

      // Active Budget Query
      prisma.budget.findFirst({
        where: {
          projectId: id,
          companyId: req.user.companyId,
          isActive: true,
          status: 'ACTIVE',
        },
      }),
    ]);

    // 1. Calculate Tasks Left
    const totalTasks = tasksByStatus.reduce(
      (sum, item) => sum + item._count,
      0
    );
    const completedTasks =
      tasksByStatus.find((t) => t.status === 'COMPLETED')?._count || 0;
    const tasksLeft = totalTasks - completedTasks;

    // 2. Calculate Days Left
    let daysLeft = 0;
    if (project.estimatedEndDate) {
      const today = new Date();
      const endDate = new Date(project.estimatedEndDate);
      const timeDiff = endDate.getTime() - today.getTime();

      daysLeft = timeDiff > 0 ? Math.ceil(timeDiff / (1000 * 3600 * 24)) : 0;
    }

    // 3. Determine the base budget value (Active Budget totalApproved vs Project estimatedBudget)
    const baseBudget = activeBudget
      ? activeBudget.totalApproved
      : project.estimatedBudget;
    const totalSpent = totalExpenses._sum.amount || 0;

    const statistics = {
      tasks: {
        byStatus: tasksByStatus.reduce((acc, item) => {
          acc[item.status] = item._count;
          return acc;
        }, {}),
        total: totalTasks,
        completed: completedTasks,
        left: tasksLeft,
      },
      timeline: {
        startDate: project.startDate,
        estimatedEndDate: project.estimatedEndDate,
        daysLeft: daysLeft,
      },
      expenses: {
        byCategory: expensesByCategory.reduce((acc, item) => {
          acc[item.category] = item._sum.amount;
          return acc;
        }, {}),
        total: totalSpent,
      },
      milestones: {
        completed: completedMilestones,
        total: totalMilestones,
        completionRate:
          totalMilestones > 0
            ? (completedMilestones / totalMilestones) * 100
            : 0,
      },
      team: {
        count: teamCount,
      },
      attendance: attendanceStats.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {}),

      // Updated Budget Summary block
      budget: {
        estimated: baseBudget, // Now uses active budget's totalApproved if available
        spent: totalSpent,
        remaining: baseBudget - totalSpent,
        utilizationRate: baseBudget > 0 ? (totalSpent / baseBudget) * 100 : 0,
        hasActiveBudget: !!activeBudget, // Adding a flag so frontend knows which budget this is
      },
    };

    res.json({
      success: true,
      data: statistics,
    });
  } catch (error) {
    console.error('Get project statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update Project Settings
export const updateProjectSettings = async (req, res) => {
  try {
    const { id } = req.params;
    const settings = req.body;

    // Check PROJECT_SETTINGS_UPDATE permission (CHANGED FROM SETTINGS_UPDATE)
    const hasPermission = await checkProjectPermission(
      req.user.userId,
      req.user.companyId,
      'PROJECT_SETTINGS_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update project settings',
      });
    }

    // Check if project exists and belongs to company
    const project = await prisma.project.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found',
      });
    }

    // Check if user has access to update settings
    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      const isProjectCreator = project.createdById === req.user.userId;

      const isAssigned = await prisma.projectAssignment.findFirst({
        where: {
          projectId: id,
          userId: req.user.userId,
        },
      });

      if (!isProjectCreator && !isAssigned) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to update this project settings',
        });
      }
    }

    const updatedSettings = await prisma.projectSettings.upsert({
      where: { projectId: id },
      update: settings,
      create: {
        projectId: id,
        ...settings,
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'PROJECT_SETTINGS_UPDATED',
        entityType: 'PROJECT_SETTINGS',
        entityId: updatedSettings.id,
        newData: settings,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Project settings updated successfully',
      data: updatedSettings,
    });
  } catch (error) {
    console.error('Update project settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Create Project Settings (Initial Setup)
export const createProjectSettings = async (req, res) => {
  try {
    const { id } = req.params;
    const settings = req.body;

    // Check PROJECT_SETTINGS_UPDATE permission
    const hasPermission = await checkProjectPermission(
      req.user.userId,
      req.user.companyId,
      'PROJECT_SETTINGS_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create project settings',
      });
    }

    // Check if project exists and belongs to company
    const project = await prisma.project.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found',
      });
    }

    // Check if user has access to create settings
    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      const isProjectCreator = project.createdById === req.user.userId;

      const isAssigned = await prisma.projectAssignment.findFirst({
        where: {
          projectId: id,
          userId: req.user.userId,
        },
      });

      if (!isProjectCreator && !isAssigned) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to create settings for this project',
        });
      }
    }

    // Check if settings already exist
    const existingSettings = await prisma.projectSettings.findUnique({
      where: { projectId: id },
    });

    if (existingSettings) {
      return res.status(400).json({
        success: false,
        message: 'Project settings already exist. Use PUT to update instead.',
      });
    }

    const createdSettings = await prisma.projectSettings.create({
      data: {
        projectId: id,
        ...settings,
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'PROJECT_SETTINGS_CREATED',
        entityType: 'PROJECT_SETTINGS',
        entityId: createdSettings.id,
        newData: settings,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message: 'Project settings created successfully',
      data: createdSettings,
    });
  } catch (error) {
    console.error('Create project settings error:', error);

    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'Project settings already exist for this project',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Project Settings
export const getProjectSettings = async (req, res) => {
  try {
    const { id } = req.params;

    // Check PROJECT_READ permission (can view project)
    const hasPermission = await checkProjectPermission(
      req.user.userId,
      req.user.companyId,
      'PROJECT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view project settings',
      });
    }

    const project = await prisma.project.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found',
      });
    }

    // Check if user has access to view settings
    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      const isProjectCreator = project.createdById === req.user.userId;

      const isAssigned = await prisma.projectAssignment.findFirst({
        where: {
          projectId: id,
          userId: req.user.userId,
        },
      });

      if (!isProjectCreator && !isAssigned) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to view this project settings',
        });
      }
    }

    const settings = await prisma.projectSettings.findUnique({
      where: { projectId: id },
    });

    // If settings don't exist, return default settings
    if (!settings) {
      const defaultSettings = {
        checkInStart: '08:00',
        checkInEnd: '09:00',
        checkOutStart: '17:00',
        checkOutEnd: '18:00',
        requireLocation: true,
        maxDistance: 100,
        notifyManagerOnDPR: true,
        notifyOnDelay: true,
        safetyRequirements: null,
        qualityStandards: null,
      };

      return res.json({
        success: true,
        message: 'Using default project settings',
        data: defaultSettings,
        isDefault: true,
      });
    }

    res.json({
      success: true,
      data: settings,
      isDefault: false,
    });
  } catch (error) {
    console.error('Get project settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
