import prisma from '../config/database.js';

// Helper function to check timeline permissions (following your exact pattern)
const checkTimelinePermission = async (userId, companyId, permissionCode) => {
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

// Helper: Validate timeline access
const validateTimelineAccess = async (
  timelineId,
  userId,
  companyId,
  userType
) => {
  const timeline = await prisma.timeline.findFirst({
    where: {
      id: timelineId,
      project: {
        companyId: companyId,
      },
    },
  });

  if (!timeline) return { valid: false, error: 'Timeline not found' };

  // Admin users have full access
  if (userType === 'COMPANY_ADMIN' || userType === 'SUPER_ADMIN') {
    return { valid: true, timeline, isAdmin: true };
  }

  // Check if user is project member
  const projectAssignment = await prisma.projectAssignment.findFirst({
    where: {
      projectId: timeline.projectId,
      userId: userId,
    },
  });

  if (!projectAssignment) {
    return { valid: false, error: 'You do not have access to this timeline' };
  }

  return { valid: true, timeline, isAdmin: false };
};

// 1. ADD TASK TO TIMELINE
export const addTaskToTimeline = async (req, res) => {
  try {
    const { id: timelineId } = req.params;
    const {
      taskId,
      timelineVersionId,
      year,
      month,
      week,
      weekOfMonth,
      order,
      isCritical = false,
      notes,
    } = req.body;

    // DATE SYNCHRONIZATION: Extract dates from either naming convention
    const rawStartDate =
      req.body.plannedStartDate !== undefined
        ? req.body.plannedStartDate
        : req.body.startDate;
    const rawEndDate =
      req.body.plannedEndDate !== undefined
        ? req.body.plannedEndDate
        : req.body.dueDate;

    const synchronizedStartDate = rawStartDate ? new Date(rawStartDate) : null;
    const synchronizedEndDate = rawEndDate ? new Date(rawEndDate) : null;

    // Check TIMELINE_TASK_CREATE permission
    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_TASK_CREATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to add tasks to timeline',
      });
    }

    const access = await validateTimelineAccess(
      timelineId,
      req.user.userId,
      req.user.companyId,
      req.user.userType
    );

    if (!access.valid) {
      return res
        .status(access.error === 'Timeline not found' ? 404 : 403)
        .json({
          success: false,
          message: access.error,
        });
    }

    // Check if timeline can be modified
    if (['LOCKED', 'ARCHIVED'].includes(access.timeline.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot add tasks to timeline with status: ${access.timeline.status}`,
      });
    }

    // Validate task exists and belongs to same project
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        projectId: access.timeline.projectId,
      },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found in this project',
      });
    }

    // Validate timeline version exists
    let timelineVersion;
    if (timelineVersionId) {
      timelineVersion = await prisma.timelineVersion.findFirst({
        where: {
          id: timelineVersionId,
          timelineId,
        },
      });

      if (!timelineVersion) {
        return res.status(404).json({
          success: false,
          message: 'Timeline version not found',
        });
      }
    }

    // Check if task is already in timeline version
    if (timelineVersionId) {
      const existingTask = await prisma.timelineTask.findFirst({
        where: {
          timelineVersionId,
          taskId,
        },
      });

      if (existingTask) {
        return res.status(400).json({
          success: false,
          message: 'Task already exists in this timeline version',
        });
      }
    }

    const timelineTask = await prisma.$transaction(async (tx) => {
      // 1. Sync dates to the root Task
      await tx.task.update({
        where: { id: taskId },
        data: {
          startDate: synchronizedStartDate,
          dueDate: synchronizedEndDate,
        },
      });

      // 2. Create timeline task with exact same dates
      const taskEntry = await tx.timelineTask.create({
        data: {
          timelineId,
          timelineVersionId: timelineVersionId || null,
          taskId,
          year,
          month,
          week,
          weekOfMonth: weekOfMonth || Math.ceil(week / 4),
          order: order || 0,
          plannedStartDate: synchronizedStartDate,
          plannedEndDate: synchronizedEndDate,
          timelineStatus: 'SCHEDULED',
          isCritical,
          notes,
        },
      });

      // Log task addition
      await tx.timelineHistory.create({
        data: {
          timelineId,
          timelineVersionId: timelineVersionId || null,
          action: 'TASK_ADDED',
          entityType: 'TIMELINE_TASK',
          entityId: taskEntry.id,
          performedById: req.user.userId,
          notes: `Added task "${task.title}" to timeline`,
        },
      });

      return taskEntry;
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'TIMELINE_TASK_ADDED',
        entityType: 'TIMELINE_TASK',
        entityId: timelineTask.id,
        newData: {
          timelineId,
          taskId,
          year,
          month,
          week,
          isCritical,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message: 'Task added to timeline successfully',
      data: timelineTask,
    });
  } catch (error) {
    console.error('Add task to timeline error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 2. BULK ADD TASKS TO TIMELINE
export const bulkAddTasksToTimeline = async (req, res) => {
  try {
    const { id: timelineId } = req.params;
    const { tasks, timelineVersionId } = req.body;

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No tasks provided',
      });
    }

    // Check TIMELINE_TASK_CREATE permission
    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_TASK_CREATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to add tasks to timeline',
      });
    }

    const access = await validateTimelineAccess(
      timelineId,
      req.user.userId,
      req.user.companyId,
      req.user.userType
    );

    if (!access.valid) {
      return res
        .status(access.error === 'Timeline not found' ? 404 : 403)
        .json({
          success: false,
          message: access.error,
        });
    }

    // Check if timeline can be modified
    if (['LOCKED', 'ARCHIVED'].includes(access.timeline.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot add tasks to timeline with status: ${access.timeline.status}`,
      });
    }

    // Validate timeline version exists
    if (timelineVersionId) {
      const timelineVersion = await prisma.timelineVersion.findFirst({
        where: {
          id: timelineVersionId,
          timelineId,
        },
      });

      if (!timelineVersion) {
        return res.status(404).json({
          success: false,
          message: 'Timeline version not found',
        });
      }
    }

    // Get all task IDs for validation
    const taskIds = tasks.map((t) => t.taskId);
    const existingTasks = await prisma.task.findMany({
      where: {
        id: { in: taskIds },
        projectId: access.timeline.projectId,
      },
      select: { id: true },
    });

    const existingTaskIds = new Set(existingTasks.map((t) => t.id));
    const invalidTasks = taskIds.filter((id) => !existingTaskIds.has(id));

    if (invalidTasks.length > 0) {
      return res.status(404).json({
        success: false,
        message: `Some tasks not found in project: ${invalidTasks.join(', ')}`,
      });
    }

    // Check for duplicates in timeline version
    if (timelineVersionId) {
      const existingTimelineTasks = await prisma.timelineTask.findMany({
        where: {
          timelineVersionId,
          taskId: { in: taskIds },
        },
        select: { taskId: true },
      });

      const existingTimelineTaskIds = new Set(
        existingTimelineTasks.map((tt) => tt.taskId)
      );
      const duplicateTasks = taskIds.filter((id) =>
        existingTimelineTaskIds.has(id)
      );

      if (duplicateTasks.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Some tasks already exist in timeline version: ${duplicateTasks.join(', ')}`,
        });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Sync root task dates for all tasks being added
      const rootTaskUpdatePromises = tasks.map((task) => {
        const rawStart =
          task.plannedStartDate !== undefined
            ? task.plannedStartDate
            : task.startDate;
        const rawEnd =
          task.plannedEndDate !== undefined
            ? task.plannedEndDate
            : task.dueDate;

        return tx.task.update({
          where: { id: task.taskId },
          data: {
            startDate: rawStart ? new Date(rawStart) : null,
            dueDate: rawEnd ? new Date(rawEnd) : null,
          },
        });
      });
      await Promise.all(rootTaskUpdatePromises);

      // 2. Prepare task data for TimelineTask creation
      const taskData = tasks.map((task) => {
        const rawStart =
          task.plannedStartDate !== undefined
            ? task.plannedStartDate
            : task.startDate;
        const rawEnd =
          task.plannedEndDate !== undefined
            ? task.plannedEndDate
            : task.dueDate;

        return {
          timelineId,
          timelineVersionId: timelineVersionId || null,
          taskId: task.taskId,
          year: task.year,
          month: task.month,
          week: task.week,
          weekOfMonth: task.weekOfMonth || Math.ceil(task.week / 4),
          order: task.order || 0,
          plannedStartDate: rawStart ? new Date(rawStart) : null,
          plannedEndDate: rawEnd ? new Date(rawEnd) : null,
          timelineStatus: task.timelineStatus || 'SCHEDULED',
          isCritical: task.isCritical || false,
          notes: task.notes,
        };
      });

      // Create timeline tasks
      const createdTasks = await tx.timelineTask.createMany({
        data: taskData,
      });

      // Log bulk addition
      await tx.timelineHistory.create({
        data: {
          timelineId,
          timelineVersionId: timelineVersionId || null,
          action: 'TASKS_BULK_ADDED',
          entityType: 'TIMELINE',
          entityId: timelineId,
          performedById: req.user.userId,
          notes: `Added ${tasks.length} tasks to timeline in bulk`,
          changes: {
            taskCount: tasks.length,
            taskIds,
          },
        },
      });

      return createdTasks;
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'TIMELINE_TASKS_BULK_ADDED',
        entityType: 'TIMELINE',
        entityId: timelineId,
        newData: {
          timelineId,
          taskCount: result.count,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message: `${result.count} tasks added to timeline successfully`,
      data: {
        count: result.count,
      },
    });
  } catch (error) {
    console.error('Bulk add tasks to timeline error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 3. GET TIMELINE TASKS
export const getTimelineTasks = async (req, res) => {
  try {
    const { id: timelineId } = req.params;
    const {
      page = 1,
      limit = 20,
      year,
      month,
      week,
      status,
      timelineVersionId,
      isCritical,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check TIMELINE_TASK_READ permission
    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_TASK_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view timeline tasks',
      });
    }

    const access = await validateTimelineAccess(
      timelineId,
      req.user.userId,
      req.user.companyId,
      req.user.userType
    );

    if (!access.valid) {
      return res
        .status(access.error === 'Timeline not found' ? 404 : 403)
        .json({
          success: false,
          message: access.error,
        });
    }

    const where = { timelineId };

    // Filter by timeline version
    if (timelineVersionId) {
      where.timelineVersionId = timelineVersionId;
    }

    // Filter by year
    if (year) {
      where.year = parseInt(year);
    }

    // Filter by month
    if (month) {
      where.month = parseInt(month);
    }

    // Filter by week
    if (week) {
      where.week = parseInt(week);
    }

    // Filter by timeline status
    if (status) {
      where.timelineStatus = status;
    }

    // Filter by critical path
    if (isCritical === 'true') {
      where.isCritical = true;
    } else if (isCritical === 'false') {
      where.isCritical = false;
    }

    const [timelineTasks, total] = await Promise.all([
      prisma.timelineTask.findMany({
        where,
        include: {
          task: {
            include: {
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
                },
              },
              project: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          timelineVersion: {
            select: {
              id: true,
              versionNumber: true,
              name: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: [
          { year: 'asc' },
          { month: 'asc' },
          { week: 'asc' },
          { order: 'asc' },
        ],
      }),
      prisma.timelineTask.count({ where }),
    ]);

    // Group tasks by month/year for calendar view
    const tasksByMonth = {};
    timelineTasks.forEach((tt) => {
      const key = `${tt.year}-${String(tt.month).padStart(2, '0')}`;
      if (!tasksByMonth[key]) {
        tasksByMonth[key] = [];
      }
      tasksByMonth[key].push(tt);
    });

    res.json({
      success: true,
      data: {
        timelineTasks,
        groupedByMonth: tasksByMonth,
        summary: {
          total,
          critical: timelineTasks.filter((tt) => tt.isCritical).length,
          completed: timelineTasks.filter(
            (tt) => tt.timelineStatus === 'COMPLETED'
          ).length,
          delayed: timelineTasks.filter((tt) => tt.timelineStatus === 'DELAYED')
            .length,
        },
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get timeline tasks error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 4. UPDATE TIMELINE TASK
export const updateTimelineTask = async (req, res) => {
  try {
    const { id: timelineId, taskId } = req.params;

    // Check TIMELINE_TASK_UPDATE permission
    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_TASK_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update timeline tasks',
      });
    }

    const access = await validateTimelineAccess(
      timelineId,
      req.user.userId,
      req.user.companyId,
      req.user.userType
    );

    if (!access.valid) {
      return res
        .status(access.error === 'Timeline not found' ? 404 : 403)
        .json({
          success: false,
          message: access.error,
        });
    }

    // Check if timeline can be modified
    if (['LOCKED', 'ARCHIVED'].includes(access.timeline.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot update tasks in timeline with status: ${access.timeline.status}`,
      });
    }

    // Find the Timeline Task (we assume req.params.taskId refers to the root task id in the URL like /timelines/:id/tasks/:taskId)
    // Adjust where clause if your route passes the TimelineTask id instead
    const timelineTask = await prisma.timelineTask.findFirst({
      where: { timelineId, taskId },
      include: { task: true },
    });

    if (!timelineTask) {
      return res
        .status(404)
        .json({ success: false, message: 'Task not found in timeline' });
    }

    // DATE SYNCHRONIZATION: Extract dates from either naming convention
    let syncStartDate = undefined;
    if (req.body.plannedStartDate !== undefined)
      syncStartDate = req.body.plannedStartDate;
    else if (req.body.startDate !== undefined)
      syncStartDate = req.body.startDate;

    let syncEndDate = undefined;
    if (req.body.plannedEndDate !== undefined)
      syncEndDate = req.body.plannedEndDate;
    else if (req.body.dueDate !== undefined) syncEndDate = req.body.dueDate;

    const updatedTimelineTask = await prisma.$transaction(
      async (tx) => {
        // 1. Update the base Task (Title, Priority, Hours, Dates)
        const taskUpdateData = {};
        if (req.body.title !== undefined) taskUpdateData.title = req.body.title;
        if (req.body.priority !== undefined)
          taskUpdateData.priority = req.body.priority;
        if (req.body.estimatedHours !== undefined)
          taskUpdateData.estimatedHours = req.body.estimatedHours;

        // Sync dates down to root Task
        if (syncStartDate !== undefined) {
          taskUpdateData.startDate = syncStartDate
            ? new Date(syncStartDate)
            : null;
        }
        if (syncEndDate !== undefined) {
          taskUpdateData.dueDate = syncEndDate ? new Date(syncEndDate) : null;
        }

        if (Object.keys(taskUpdateData).length > 0) {
          await tx.task.update({
            where: { id: taskId },
            data: taskUpdateData,
          });
        }

        // 2. Handle Subtasks (Add, Update, Delete)
        if (Array.isArray(req.body.subtasks)) {
          const existingSubtasks = await tx.subtask.findMany({
            where: { taskId },
          });
          const existingIds = existingSubtasks.map((s) => s.id);
          const incomingIds = req.body.subtasks
            .filter((s) => s.id)
            .map((s) => s.id);

          // Delete removed subtasks
          const toDelete = existingIds.filter(
            (id) => !incomingIds.includes(id)
          );
          if (toDelete.length > 0) {
            await tx.subtask.deleteMany({ where: { id: { in: toDelete } } });
          }

          // Update existing or create new subtasks
          for (const sub of req.body.subtasks) {
            if (sub.id) {
              await tx.subtask.update({
                where: { id: sub.id },
                data: { description: sub.description },
              });
            } else {
              await tx.subtask.create({
                data: {
                  description: sub.description,
                  taskId,
                  createdById: req.user.userId,
                  isCompleted: false,
                },
              });
            }
          }
        }

        // 3. Update the TimelineTask scheduling
        const tlUpdateData = {
          ...(req.body.year && { year: parseInt(req.body.year) }),
          ...(req.body.month && { month: parseInt(req.body.month) }),
          ...(req.body.week && {
            week: parseInt(req.body.week),
            weekOfMonth: Math.ceil(parseInt(req.body.week) / 4),
          }),
          ...(req.body.isCritical !== undefined && {
            isCritical: req.body.isCritical,
          }),
          ...(req.body.notes !== undefined && { notes: req.body.notes }),
        };

        // Sync dates to TimelineTask
        if (syncStartDate !== undefined) {
          tlUpdateData.plannedStartDate = syncStartDate
            ? new Date(syncStartDate)
            : null;
        }
        if (syncEndDate !== undefined) {
          tlUpdateData.plannedEndDate = syncEndDate
            ? new Date(syncEndDate)
            : null;
        }

        return await tx.timelineTask.update({
          where: { id: timelineTask.id },
          data: tlUpdateData,
        });
      },
      {
        maxWait: 10000, // 10 seconds
        timeout: 15000, // 15 seconds (default is 5000ms)
      }
    );

    res.json({
      success: true,
      message: 'Task updated successfully',
      data: updatedTimelineTask,
    });
  } catch (error) {
    console.error('Update timeline task error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// 5. BULK UPDATE TIMELINE TASKS
export const bulkUpdateTimelineTasks = async (req, res) => {
  try {
    const { id: timelineId } = req.params;
    const { updates } = req.body; // Array of { taskId, updates }

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No updates provided',
      });
    }

    // Check TIMELINE_TASK_UPDATE permission
    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_TASK_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update timeline tasks',
      });
    }

    const access = await validateTimelineAccess(
      timelineId,
      req.user.userId,
      req.user.companyId,
      req.user.userType
    );

    if (!access.valid) {
      return res
        .status(access.error === 'Timeline not found' ? 404 : 403)
        .json({
          success: false,
          message: access.error,
        });
    }

    // Check if timeline can be modified
    if (['LOCKED', 'ARCHIVED'].includes(access.timeline.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot update tasks in timeline with status: ${access.timeline.status}`,
      });
    }

    // Only creator or admin can update
    if (!access.isAdmin && access.timeline.createdById !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only update tasks in timelines you created',
      });
    }

    const taskIds = updates.map((u) => u.taskId);
    const timelineTasks = await prisma.timelineTask.findMany({
      where: {
        timelineId,
        taskId: { in: taskIds },
      },
      include: {
        task: true,
      },
    });

    const timelineTaskMap = new Map(timelineTasks.map((tt) => [tt.taskId, tt]));

    // Validate all tasks exist in timeline
    const missingTasks = taskIds.filter((id) => !timelineTaskMap.has(id));
    if (missingTasks.length > 0) {
      return res.status(404).json({
        success: false,
        message: `Some tasks not found in timeline: ${missingTasks.join(', ')}`,
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatePromises = updates.map(async (update) => {
        const timelineTask = timelineTaskMap.get(update.taskId);
        const taskUpdates = update.updates;

        // DATE SYNCHRONIZATION
        let syncStartDate = undefined;
        if (taskUpdates.plannedStartDate !== undefined)
          syncStartDate = taskUpdates.plannedStartDate;
        else if (taskUpdates.startDate !== undefined)
          syncStartDate = taskUpdates.startDate;

        let syncEndDate = undefined;
        if (taskUpdates.plannedEndDate !== undefined)
          syncEndDate = taskUpdates.plannedEndDate;
        else if (taskUpdates.dueDate !== undefined)
          syncEndDate = taskUpdates.dueDate;

        // Sync with root task
        if (syncStartDate !== undefined || syncEndDate !== undefined) {
          const rootUpdate = {};
          if (syncStartDate !== undefined)
            rootUpdate.startDate = syncStartDate
              ? new Date(syncStartDate)
              : null;
          if (syncEndDate !== undefined)
            rootUpdate.dueDate = syncEndDate ? new Date(syncEndDate) : null;

          await tx.task.update({
            where: { id: timelineTask.taskId },
            data: rootUpdate,
          });
        }

        // Convert date fields for timeline task
        if (syncStartDate !== undefined) {
          taskUpdates.plannedStartDate = syncStartDate
            ? new Date(syncStartDate)
            : null;
        }
        if (syncEndDate !== undefined) {
          taskUpdates.plannedEndDate = syncEndDate
            ? new Date(syncEndDate)
            : null;
        }

        // Convert numeric fields
        if (taskUpdates.year) taskUpdates.year = parseInt(taskUpdates.year);
        if (taskUpdates.month) taskUpdates.month = parseInt(taskUpdates.month);
        if (taskUpdates.week) taskUpdates.week = parseInt(taskUpdates.week);
        if (taskUpdates.weekOfMonth)
          taskUpdates.weekOfMonth = parseInt(taskUpdates.weekOfMonth);
        if (taskUpdates.order) taskUpdates.order = parseInt(taskUpdates.order);

        // Strip out non-TimelineTask fields to prevent Prisma errors
        delete taskUpdates.startDate;
        delete taskUpdates.dueDate;
        delete taskUpdates.title;
        delete taskUpdates.description;
        delete taskUpdates.priority;
        delete taskUpdates.estimatedHours;
        delete taskUpdates.subtasks;

        // Update timeline task
        const updated = await tx.timelineTask.update({
          where: { id: timelineTask.id },
          data: taskUpdates,
        });

        // Log update
        await tx.timelineHistory.create({
          data: {
            timelineId,
            timelineVersionId: timelineTask.timelineVersionId,
            action: 'TASK_UPDATED',
            entityType: 'TIMELINE_TASK',
            entityId: timelineTask.id,
            performedById: req.user.userId,
            notes: `Bulk update: Updated scheduling for task "${timelineTask.task.title}"`,
          },
        });

        return updated;
      });

      return await Promise.all(updatePromises);
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'TIMELINE_TASKS_BULK_UPDATED',
        entityType: 'TIMELINE',
        entityId: timelineId,
        newData: {
          timelineId,
          updatedCount: result.length,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: `${result.length} timeline tasks updated successfully`,
      data: {
        count: result.length,
      },
    });
  } catch (error) {
    console.error('Bulk update timeline tasks error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 6. REMOVE TASK FROM TIMELINE
export const removeTaskFromTimeline = async (req, res) => {
  try {
    const { id: timelineId, taskId } = req.params;

    // Check TIMELINE_TASK_DELETE permission
    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_TASK_DELETE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to remove tasks from timeline',
      });
    }

    const access = await validateTimelineAccess(
      timelineId,
      req.user.userId,
      req.user.companyId,
      req.user.userType
    );

    if (!access.valid) {
      return res
        .status(access.error === 'Timeline not found' ? 404 : 403)
        .json({
          success: false,
          message: access.error,
        });
    }

    // Check if timeline can be modified
    if (['LOCKED', 'ARCHIVED'].includes(access.timeline.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot remove tasks from timeline with status: ${access.timeline.status}`,
      });
    }

    // Get the timeline task
    const timelineTask = await prisma.timelineTask.findFirst({
      where: {
        timelineId,
        taskId,
      },
      include: {
        task: true,
      },
    });

    if (!timelineTask) {
      return res.status(404).json({
        success: false,
        message: 'Task not found in timeline',
      });
    }

    // Only creator or admin can remove
    if (!access.isAdmin && access.timeline.createdById !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only remove tasks from timelines you created',
      });
    }

    await prisma.$transaction(async (tx) => {
      // Delete timeline task
      await tx.timelineTask.delete({
        where: { id: timelineTask.id },
      });

      // Log removal
      await tx.timelineHistory.create({
        data: {
          timelineId,
          timelineVersionId: timelineTask.timelineVersionId,
          action: 'TASK_REMOVED',
          entityType: 'TIMELINE_TASK',
          entityId: timelineTask.id,
          performedById: req.user.userId,
          notes: `Removed task "${timelineTask.task.title}" from timeline`,
        },
      });
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'TIMELINE_TASK_REMOVED',
        entityType: 'TIMELINE_TASK',
        entityId: timelineTask.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Task removed from timeline successfully',
    });
  } catch (error) {
    console.error('Remove task from timeline error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 7. UPDATE TASK TIMELINE STATUS
export const updateTaskTimelineStatus = async (req, res) => {
  try {
    const { id: timelineId, taskId } = req.params;
    const { timelineStatus, notes } = req.body;

    // No permission check here - task assignees can update their own task status
    const access = await validateTimelineAccess(
      timelineId,
      req.user.userId,
      req.user.companyId,
      req.user.userType
    );

    if (!access.valid) {
      return res
        .status(access.error === 'Timeline not found' ? 404 : 403)
        .json({
          success: false,
          message: access.error,
        });
    }

    // Get the timeline task
    const timelineTask = await prisma.timelineTask.findFirst({
      where: {
        timelineId,
        taskId,
      },
      include: {
        task: true,
      },
    });

    if (!timelineTask) {
      return res.status(404).json({
        success: false,
        message: 'Task not found in timeline',
      });
    }

    // Check if user has access to update this task
    const isTaskAssignee = timelineTask.task.assignedToId === req.user.userId;
    const isTaskCreator = timelineTask.task.createdById === req.user.userId;

    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      if (!isTaskAssignee && !isTaskCreator) {
        return res.status(403).json({
          success: false,
          message:
            'You can only update status of tasks assigned to you or created by you',
        });
      }
    }

    const updatedTimelineTask = await prisma.$transaction(async (tx) => {
      // Update timeline task status
      const updated = await tx.timelineTask.update({
        where: { id: timelineTask.id },
        data: {
          timelineStatus,
          notes,
        },
      });

      // Log status update
      await tx.timelineHistory.create({
        data: {
          timelineId,
          timelineVersionId: timelineTask.timelineVersionId,
          action: 'TASK_STATUS_UPDATED',
          entityType: 'TIMELINE_TASK',
          entityId: timelineTask.id,
          performedById: req.user.userId,
          notes: `Updated timeline status to "${timelineStatus}" for task "${timelineTask.task.title}"`,
        },
      });

      // If marking as completed, also update the underlying task
      if (
        timelineStatus === 'COMPLETED' &&
        timelineTask.task.status !== 'COMPLETED'
      ) {
        await tx.task.update({
          where: { id: taskId },
          data: {
            status: 'COMPLETED',
            progress: 100,
            completedDate: new Date(),
          },
        });
      }

      return updated;
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'TIMELINE_TASK_STATUS_UPDATED',
        entityType: 'TIMELINE_TASK',
        entityId: timelineTask.id,
        newData: { timelineStatus, notes },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Task timeline status updated successfully',
      data: updatedTimelineTask,
    });
  } catch (error) {
    console.error('Update task timeline status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 8. GET TIMELINE TASK CALENDAR VIEW
export const getTimelineCalendar = async (req, res) => {
  try {
    const { id: timelineId } = req.params;
    const { year, month, timelineVersionId } = req.query;

    // Check TIMELINE_TASK_READ permission
    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_TASK_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view timeline calendar',
      });
    }

    const access = await validateTimelineAccess(
      timelineId,
      req.user.userId,
      req.user.companyId,
      req.user.userType
    );

    if (!access.valid) {
      return res
        .status(access.error === 'Timeline not found' ? 404 : 403)
        .json({
          success: false,
          message: access.error,
        });
    }

    const where = { timelineId };

    // Filter by timeline version
    if (timelineVersionId) {
      where.timelineVersionId = timelineVersionId;
    }

    // Filter by year and month
    if (year && month) {
      where.year = parseInt(year);
      where.month = parseInt(month);
    } else {
      // Default to current month
      const now = new Date();
      where.year = now.getFullYear();
      where.month = now.getMonth() + 1;
    }

    const timelineTasks = await prisma.timelineTask.findMany({
      where,
      include: {
        task: {
          include: {
            subtasks: true,
            assignedTo: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        timelineVersion: {
          select: {
            id: true,
            versionNumber: true,
            name: true,
            status: true,
          },
        },
      },
      orderBy: [{ week: 'asc' }, { order: 'asc' }],
    });

    // Group tasks by week
    const tasksByWeek = {};
    timelineTasks.forEach((tt) => {
      const weekKey = `Week ${tt.week}`;
      if (!tasksByWeek[weekKey]) {
        tasksByWeek[weekKey] = [];
      }
      tasksByWeek[weekKey].push(tt);
    });

    // Calculate calendar metrics
    const totalWeeks = Object.keys(tasksByWeek).length;
    const tasksByStatus = {
      SCHEDULED: timelineTasks.filter((tt) => tt.timelineStatus === 'SCHEDULED')
        .length,
      IN_PROGRESS: timelineTasks.filter(
        (tt) => tt.timelineStatus === 'IN_PROGRESS'
      ).length,
      COMPLETED: timelineTasks.filter((tt) => tt.timelineStatus === 'COMPLETED')
        .length,
      DELAYED: timelineTasks.filter((tt) => tt.timelineStatus === 'DELAYED')
        .length,
      CANCELLED: timelineTasks.filter((tt) => tt.timelineStatus === 'CANCELLED')
        .length,
    };

    res.json({
      success: true,
      data: {
        year: where.year,
        month: where.month,
        monthName: new Date(where.year, where.month - 1).toLocaleString(
          'default',
          { month: 'long' }
        ),
        tasksByWeek,
        summary: {
          totalTasks: timelineTasks.length,
          totalWeeks,
          tasksByStatus,
          criticalTasks: timelineTasks.filter((tt) => tt.isCritical).length,
        },
        timelineInfo: {
          id: access.timeline.id,
          name: access.timeline.name,
          status: access.timeline.status,
          startDate: access.timeline.startDate,
          endDate: access.timeline.endDate,
        },
      },
    });
  } catch (error) {
    console.error('Get timeline calendar error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
