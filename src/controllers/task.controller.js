import prisma from '../config/database.js';

// Helper function to check task permissions
const checkTaskPermission = async (userId, companyId, permissionCode) => {
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

// Create Task (Only users with TASK_CREATE permission can create tasks)
export const createTask = async (req, res) => {
  try {
    const {
      title,
      description,
      projectId,
      assignedToId,
      status,
      priority,
      progress,
      startDate,
      dueDate,
      estimatedHours,
    } = req.body;

    // Check TASK_CREATE permission
    const hasPermission = await checkTaskPermission(
      req.user.userId,
      req.user.companyId,
      'TASK_CREATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create tasks',
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
        message: 'Project not found in your company',
      });
    }

    // Check if assignee exists and belongs to company
    const assignee = await prisma.user.findFirst({
      where: {
        id: assignedToId,
        companyId: req.user.companyId,
        userType: 'EMPLOYEE',
      },
    });

    if (!assignee) {
      return res.status(404).json({
        success: false,
        message: 'Assignee not found in your company',
      });
    }

    // Check if user is assigned to the project (creator or project member)
    const isProjectCreator = project.createdById === req.user.userId;
    const isAssigned = await prisma.projectAssignment.findFirst({
      where: {
        projectId,
        userId: req.user.userId,
      },
    });

    // For non-admin users, they must be project creator or assigned to project
    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      if (!isProjectCreator && !isAssigned) {
        return res.status(403).json({
          success: false,
          message: 'You must be assigned to this project to create tasks',
        });
      }
    }

    // Create task
    const task = await prisma.task.create({
      data: {
        title,
        description,
        projectId,
        assignedToId,
        createdById: req.user.userId,
        status: status || 'TODO',
        priority: priority || 'MEDIUM',
        progress: progress || 0,
        startDate: startDate ? new Date(startDate) : null,
        dueDate: dueDate ? new Date(dueDate) : null,
        estimatedHours: estimatedHours ? parseFloat(estimatedHours) : null,
        actualHours: 0,
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'TASK_CREATED',
        entityType: 'TASK',
        entityId: task.id,
        newData: {
          title,
          projectId,
          assignedToId,
          status: status || 'TODO',
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    // Send notification to assignee
    await prisma.notification.create({
      data: {
        userId: assignedToId,
        title: 'New Task Assigned',
        message: `You have been assigned a new task: "${title}"`,
        type: 'TASK',
        relatedId: task.id,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Task created successfully',
      data: task,
    });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get All Tasks (with permission-based filtering)
export const getAllTasks = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status,
      priority,
      projectId,
      assignedToId,
      createdById,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check TASK_READ permission
    const hasPermission = await checkTaskPermission(
      req.user.userId,
      req.user.companyId,
      'TASK_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view tasks',
      });
    }

    const where = {
      project: {
        companyId: req.user.companyId,
      },
    };

    // Add search filter
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
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

    // Add project filter
    if (projectId) {
      where.projectId = projectId;
    }

    // Add assignee filter
    if (assignedToId) {
      where.assignedToId = assignedToId;
    }

    // Add creator filter
    if (createdById) {
      where.createdById = createdById;
    }

    // For non-admin users, apply additional filters
    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      // Get projects where user is assigned
      const userAssignments = await prisma.projectAssignment.findMany({
        where: { userId: req.user.userId },
        select: { projectId: true },
      });

      const assignedProjectIds = userAssignments.map((pa) => pa.projectId);

      // Get tasks created by user
      const createdTasksCondition = { createdById: req.user.userId };

      // Get tasks assigned to user
      const assignedTasksCondition = { assignedToId: req.user.userId };

      // Get tasks in projects where user is assigned
      const projectTasksCondition = {
        projectId: { in: assignedProjectIds },
      };

      // Combine conditions with OR
      where.AND = [
        {
          OR: [
            createdTasksCondition,
            assignedTasksCondition,
            projectTasksCondition,
          ],
        },
      ];
    }

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        include: {
          subtasks: true,
          project: {
            select: {
              id: true,
              name: true,
              projectId: true,
            },
          },
          assignedTo: {
            select: {
              id: true,
              name: true,
              email: true,
              designation: true,
            },
          },
          creator: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          _count: {
            select: {
              subtasks: true,
              comments: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.task.count({ where }),
    ]);

    res.json({
      success: true,
      data: tasks,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Task by ID
export const getTaskById = async (req, res) => {
  try {
    const { id } = req.params;

    // Check TASK_READ permission
    const hasPermission = await checkTaskPermission(
      req.user.userId,
      req.user.companyId,
      'TASK_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view task details',
      });
    }

    const task = await prisma.task.findFirst({
      where: {
        id,
        project: {
          companyId: req.user.companyId,
        },
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            projectId: true,
          },
        },
        assignedTo: {
          select: {
            id: true,
            name: true,
            email: true,
            designation: true,
            profilePicture: true,
          },
        },
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
            designation: true,
          },
        },
        subtasks: {
          include: {
            assignments: {
              include: { siteStaff: true, subcontractorWorker: true },
            },
          },
        },
        comments: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                profilePicture: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: {
            subtasks: true,
            comments: true,
          },
        },
      },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      });
    }

    // Check if user has access to this task
    const isTaskCreator = task.createdById === req.user.userId;
    const isTaskAssignee = task.assignedToId === req.user.userId;

    // For non-admin users, they must be creator, assignee, or project member
    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      // Check if user is assigned to the project
      const isProjectMember = await prisma.projectAssignment.findFirst({
        where: {
          projectId: task.projectId,
          userId: req.user.userId,
        },
      });

      if (!isTaskCreator && !isTaskAssignee && !isProjectMember) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this task',
        });
      }
    }

    res.json({
      success: true,
      data: task,
    });
  } catch (error) {
    console.error('Get task error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update Task (Only task creator or assignee can update)
export const updateTask = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Check TASK_UPDATE permission
    const hasPermission = await checkTaskPermission(
      req.user.userId,
      req.user.companyId,
      'TASK_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update tasks',
      });
    }

    // Check if task exists and belongs to company
    const task = await prisma.task.findFirst({
      where: {
        id,
        project: {
          companyId: req.user.companyId,
        },
      },
      include: {
        assignedTo: true,
      },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      });
    }

    // Check if user can update this task
    // Only task creator, assignee, or admin can update
    const isTaskCreator = task.createdById === req.user.userId;
    const isTaskAssignee = task.assignedToId === req.user.userId;

    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      if (!isTaskCreator && !isTaskAssignee) {
        return res.status(403).json({
          success: false,
          message: 'You can only update tasks you created or are assigned to',
        });
      }
    }

    // Convert date fields
    if (updates.startDate) {
      updates.startDate = new Date(updates.startDate);
    }
    if (updates.dueDate) {
      updates.dueDate = new Date(updates.dueDate);
    }
    if (updates.completedDate) {
      updates.completedDate = new Date(updates.completedDate);
    }

    // Convert numeric fields
    if (updates.progress) {
      updates.progress = parseInt(updates.progress);
    }
    if (updates.estimatedHours) {
      updates.estimatedHours = parseFloat(updates.estimatedHours);
    }
    if (updates.actualHours) {
      updates.actualHours = parseFloat(updates.actualHours);
    }

    // If status is changing to COMPLETED and progress is not 100, set it to 100
    if (
      updates.status === 'COMPLETED' &&
      (!updates.progress || updates.progress < 100)
    ) {
      updates.progress = 100;
      updates.completedDate = new Date();
    }

    const updatedTask = await prisma.task.update({
      where: { id },
      data: updates,
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'TASK_UPDATED',
        entityType: 'TASK',
        entityId: id,
        oldData: task,
        newData: updatedTask,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    // If assignee changed, notify new assignee
    if (updates.assignedToId && updates.assignedToId !== task.assignedToId) {
      await prisma.notification.create({
        data: {
          userId: updates.assignedToId,
          title: 'Task Reassigned',
          message: `Task "${task.title}" has been assigned to you`,
          type: 'TASK',
          relatedId: task.id,
        },
      });
    }

    res.json({
      success: true,
      message: 'Task updated successfully',
      data: updatedTask,
    });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Delete Task (Only task creator or admin can delete)
export const deleteTask = async (req, res) => {
  try {
    const { id } = req.params;

    // Check TASK_DELETE permission
    const hasPermission = await checkTaskPermission(
      req.user.userId,
      req.user.companyId,
      'TASK_DELETE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete tasks',
      });
    }

    // Check if task exists and belongs to company
    const task = await prisma.task.findFirst({
      where: {
        id,
        project: {
          companyId: req.user.companyId,
        },
      },
      include: {
        _count: {
          select: {
            subtasks: true,
            comments: true,
          },
        },
      },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      });
    }

    // Check if user can delete this task
    // Only task creator or admin can delete
    const isTaskCreator = task.createdById === req.user.userId;

    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      if (!isTaskCreator) {
        return res.status(403).json({
          success: false,
          message: 'You can only delete tasks you created',
        });
      }
    }

    // Start transaction to delete related records
    await prisma.$transaction(async (tx) => {
      // Delete subtasks
      await tx.subtask.deleteMany({
        where: { taskId: id },
      });

      // Delete comments
      await tx.taskComment.deleteMany({
        where: { taskId: id },
      });

      // Delete task
      await tx.task.delete({
        where: { id },
      });
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'TASK_DELETED',
        entityType: 'TASK',
        entityId: id,
        oldData: task,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Task deleted successfully',
    });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Create Subtask (Only task creator or assignee can create subtasks)
export const createSubtask = async (req, res) => {
  try {
    const { description, taskId } = req.body;

    // Check if task exists and belongs to company
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        project: {
          companyId: req.user.companyId,
        },
      },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      });
    }

    // Check if user can create subtask for this task
    // Only task creator, assignee, or admin can create subtasks
    const isTaskCreator = task.createdById === req.user.userId;
    const isTaskAssignee = task.assignedToId === req.user.userId;

    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      if (!isTaskCreator && !isTaskAssignee) {
        return res.status(403).json({
          success: false,
          message:
            'You can only create subtasks for tasks you created or are assigned to',
        });
      }
    }

    const subtask = await prisma.subtask.create({
      data: {
        description,
        taskId,
        createdById: req.user.userId,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Subtask created successfully',
      data: subtask,
    });
  } catch (error) {
    console.error('Create subtask error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update Subtask (Only subtask creator or task assignee can update)
export const updateSubtask = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Get subtask with task details
    const subtask = await prisma.subtask.findFirst({
      where: { id },
      include: {
        task: {
          include: {
            assignedTo: true,
          },
        },
      },
    });

    if (!subtask) {
      return res.status(404).json({
        success: false,
        message: 'Subtask not found',
      });
    }

    // Check if task belongs to company
    const task = await prisma.task.findFirst({
      where: {
        id: subtask.taskId,
        project: {
          companyId: req.user.companyId,
        },
      },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found in your company',
      });
    }

    // Check if user can update this subtask
    // Only subtask creator, task creator, task assignee, or admin can update
    const isSubtaskCreator = subtask.createdById === req.user.userId;
    const isTaskCreator = task.createdById === req.user.userId;
    const isTaskAssignee = task.assignedToId === req.user.userId;

    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      if (!isSubtaskCreator && !isTaskCreator && !isTaskAssignee) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to update this subtask',
        });
      }
    }

    const updatedSubtask = await prisma.subtask.update({
      where: { id },
      data: updates,
    });

    res.json({
      success: true,
      message: 'Subtask updated successfully',
      data: updatedSubtask,
    });
  } catch (error) {
    console.error('Update subtask error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Bulk Update Subtasks
export const bulkUpdateSubtasks = async (req, res) => {
  try {
    const { taskId, updates } = req.body;

    if (!taskId || !Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Task ID and an array of updates are required',
      });
    }

    // 1. Verify Task exists and belongs to the company
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        project: {
          companyId: req.user.companyId,
        },
      },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found in your company',
      });
    }

    // 2. Permission Check (Same logic as singular update but at Task level)
    const isTaskCreator = task.createdById === req.user.userId;
    const isTaskAssignee = task.assignedToId === req.user.userId;
    const isAdmin = ['COMPANY_ADMIN', 'SUPER_ADMIN'].includes(
      req.user.userType
    );

    if (!isAdmin && !isTaskCreator && !isTaskAssignee) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to manage subtasks for this task',
      });
    }

    // 3. Execute Bulk Update in a Transaction
    // We map through the updates array and create a list of Prisma update promises
    const updatePromises = updates.map((update) => {
      const { id, ...data } = update;
      return prisma.subtask.update({
        where: {
          id,
          taskId: taskId, // Security: ensure subtask actually belongs to the verified task
        },
        data: data,
      });
    });

    await prisma.$transaction(updatePromises);

    res.json({
      success: true,
      message: `${updates.length} subtasks updated successfully`,
    });
  } catch (error) {
    console.error('Bulk update subtasks error:', error);

    // Handle Prisma specific errors (e.g., one ID in the array was invalid)
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        message:
          'One or more subtasks were not found or do not belong to this task',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Delete Subtask (Only subtask creator or task creator can delete)
export const deleteSubtask = async (req, res) => {
  try {
    const { id } = req.params;

    // Get subtask with task details
    const subtask = await prisma.subtask.findFirst({
      where: { id },
      include: {
        task: true,
      },
    });

    if (!subtask) {
      return res.status(404).json({
        success: false,
        message: 'Subtask not found',
      });
    }

    // Check if task belongs to company
    const task = await prisma.task.findFirst({
      where: {
        id: subtask.taskId,
        project: {
          companyId: req.user.companyId,
        },
      },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found in your company',
      });
    }

    // Check if user can delete this subtask
    // Only subtask creator, task creator, or admin can delete
    const isSubtaskCreator = subtask.createdById === req.user.userId;
    const isTaskCreator = task.createdById === req.user.userId;

    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      if (!isSubtaskCreator && !isTaskCreator) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to delete this subtask',
        });
      }
    }

    await prisma.subtask.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: 'Subtask deleted successfully',
    });
  } catch (error) {
    console.error('Delete subtask error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Create Task Comment (Anyone with access to the task can comment)
export const createTaskComment = async (req, res) => {
  try {
    const { content, taskId } = req.body;

    // Check if task exists and belongs to company
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        project: {
          companyId: req.user.companyId,
        },
      },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      });
    }

    // Check if user has access to this task
    const isTaskCreator = task.createdById === req.user.userId;
    const isTaskAssignee = task.assignedToId === req.user.userId;

    // For non-admin users, they must be creator, assignee, or project member
    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      // Check if user is assigned to the project
      const isProjectMember = await prisma.projectAssignment.findFirst({
        where: {
          projectId: task.projectId,
          userId: req.user.userId,
        },
      });

      if (!isTaskCreator && !isTaskAssignee && !isProjectMember) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to comment on this task',
        });
      }
    }

    const comment = await prisma.taskComment.create({
      data: {
        content,
        taskId,
        userId: req.user.userId,
      },
    });

    // Get comment with user details
    const commentWithUser = await prisma.taskComment.findUnique({
      where: { id: comment.id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            profilePicture: true,
          },
        },
      },
    });

    // Notify task creator and assignee about new comment (excluding the commenter)
    const notifications = [];

    if (task.createdById !== req.user.userId) {
      notifications.push({
        userId: task.createdById,
        title: 'New Comment',
        message: `New comment on task: "${task.title}"`,
        type: 'TASK',
        relatedId: taskId,
      });
    }

    if (
      task.assignedToId &&
      task.assignedToId !== req.user.userId &&
      task.assignedToId !== task.createdById
    ) {
      notifications.push({
        userId: task.assignedToId,
        title: 'New Comment',
        message: `New comment on task: "${task.title}"`,
        type: 'TASK',
        relatedId: taskId,
      });
    }

    if (notifications.length > 0) {
      await prisma.notification.createMany({
        data: notifications,
      });
    }

    res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      data: commentWithUser,
    });
  } catch (error) {
    console.error('Create task comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Task Comments
export const getTaskComments = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check if task exists and belongs to company
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        project: {
          companyId: req.user.companyId,
        },
      },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      });
    }

    // Check if user has access to this task
    const isTaskCreator = task.createdById === req.user.userId;
    const isTaskAssignee = task.assignedToId === req.user.userId;

    // For non-admin users, they must be creator, assignee, or project member
    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      // Check if user is assigned to the project
      const isProjectMember = await prisma.projectAssignment.findFirst({
        where: {
          projectId: task.projectId,
          userId: req.user.userId,
        },
      });

      if (!isTaskCreator && !isTaskAssignee && !isProjectMember) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to view comments for this task',
        });
      }
    }

    const [comments, total] = await Promise.all([
      prisma.taskComment.findMany({
        where: { taskId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              profilePicture: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.taskComment.count({ where: { taskId } }),
    ]);

    res.json({
      success: true,
      data: comments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get task comments error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Delete Task Comment (Only comment creator or admin can delete)
export const deleteTaskComment = async (req, res) => {
  try {
    const { id } = req.params;

    // Get comment
    const comment = await prisma.taskComment.findFirst({
      where: { id },
      include: {
        task: {
          include: {
            project: true,
          },
        },
      },
    });

    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found',
      });
    }

    // Check if task belongs to company
    if (comment.task.project.companyId !== req.user.companyId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Check if user can delete this comment
    // Only comment creator, task creator, or admin can delete
    const isCommentCreator = comment.userId === req.user.userId;
    const isTaskCreator = comment.task.createdById === req.user.userId;

    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      if (!isCommentCreator && !isTaskCreator) {
        return res.status(403).json({
          success: false,
          message: 'You can only delete your own comments',
        });
      }
    }

    await prisma.taskComment.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: 'Comment deleted successfully',
    });
  } catch (error) {
    console.error('Delete task comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get User's Tasks (for dashboard)
export const getUserTasks = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status, priority, limit = 10 } = req.query;

    const where = {
      OR: [{ createdById: userId }, { assignedToId: userId }],
      project: {
        companyId: req.user.companyId,
      },
    };

    // Add status filter
    if (status) {
      where.status = status;
    }

    // Add priority filter
    if (priority) {
      where.priority = priority;
    }

    const tasks = await prisma.task.findMany({
      where,
      include: {
        project: {
          select: {
            id: true,
            name: true,
            projectId: true,
          },
        },
        assignedTo: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      take: parseInt(limit),
      orderBy: { dueDate: 'asc' },
    });

    // Categorize tasks
    const categorizedTasks = {
      todo: tasks.filter((task) => task.status === 'TODO'),
      inProgress: tasks.filter((task) => task.status === 'IN_PROGRESS'),
      review: tasks.filter((task) => task.status === 'REVIEW'),
      completed: tasks.filter((task) => task.status === 'COMPLETED'),
      blocked: tasks.filter((task) => task.status === 'BLOCKED'),
    };

    res.json({
      success: true,
      data: {
        tasks,
        categorizedTasks,
        counts: {
          total: tasks.length,
          todo: categorizedTasks.todo.length,
          inProgress: categorizedTasks.inProgress.length,
          review: categorizedTasks.review.length,
          completed: categorizedTasks.completed.length,
          blocked: categorizedTasks.blocked.length,
        },
      },
    });
  } catch (error) {
    console.error('Get user tasks error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
