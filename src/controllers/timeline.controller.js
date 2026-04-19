import prisma from '../config/database.js';

// Helper function to check timeline permissions
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

  if (user.userType === 'SUPER_ADMIN') return true;

  if (user.companyId !== companyId) return false;

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

  if (userType === 'COMPANY_ADMIN' || userType === 'SUPER_ADMIN') {
    return { valid: true, timeline, isAdmin: true };
  }

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

// 1. CREATE TIMELINE
export const createTimeline = async (req, res) => {
  try {
    const {
      projectId,
      name,
      description,
      startDate,
      endDate,
      versionComment,
      tasks = [],
    } = req.body;

    if (!projectId || !name || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Project ID, name, start date, and end date are required',
      });
    }

    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_CREATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create timelines',
      });
    }

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

    const parsedStartDate = new Date(startDate);
    const parsedEndDate = new Date(endDate);

    if (parsedStartDate > parsedEndDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date must be before end date',
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const timeline = await tx.timeline.create({
        data: {
          projectId,
          name,
          description: description || null,
          startDate: parsedStartDate,
          endDate: parsedEndDate,
          status: 'DRAFT',
          currentVersion: 1,
          isCurrent: true,
          createdById: req.user.userId,
          versionComment: versionComment || null,
        },
      });

      const version = await tx.timelineVersion.create({
        data: {
          timelineId: timeline.id,
          versionNumber: 1,
          name: `Version 1: ${name}`,
          description: description || null,
          startDate: parsedStartDate,
          endDate: parsedEndDate,
          status: 'DRAFT',
          createdById: req.user.userId,
          changesSummary: versionComment || 'Initial version',
        },
      });

      for (let i = 0; i < tasks.length; i++) {
        const taskData = tasks[i];

        // DATE SYNCHRONIZATION: Map planned dates to Task dates
        const rawStartDate =
          taskData.plannedStartDate !== undefined
            ? taskData.plannedStartDate
            : taskData.startDate;
        const rawEndDate =
          taskData.plannedEndDate !== undefined
            ? taskData.plannedEndDate
            : taskData.dueDate;

        const taskStartDate = rawStartDate ? new Date(rawStartDate) : null;
        const taskEndDate = rawEndDate ? new Date(rawEndDate) : null;

        const task = await tx.task.create({
          data: {
            title: taskData.title.trim(),
            description: taskData.description || null,
            projectId,
            createdById: req.user.userId,
            priority:
              taskData.priority ||
              (taskData.isCritical ? 'CRITICAL' : 'MEDIUM'),
            status: 'TODO',
            estimatedHours: taskData.estimatedHours || 0,
            actualHours: 0,
            // Apply dates to the Root Task
            startDate: taskStartDate,
            dueDate: taskEndDate,
          },
        });

        if (Array.isArray(taskData.subtasks) && taskData.subtasks.length > 0) {
          const subtaskData = taskData.subtasks.map((subtask) => ({
            description: subtask.description.trim(),
            isCompleted: false,
            taskId: task.id,
            createdById: req.user.userId,
          }));

          await tx.subtask.createMany({ data: subtaskData });
        }

        await tx.timelineTask.create({
          data: {
            timelineId: timeline.id,
            timelineVersionId: version.id,
            taskId: task.id,
            year: taskData.year || null,
            month: taskData.month || null,
            week: taskData.week || null,
            weekOfMonth:
              taskData.weekOfMonth ||
              (taskData.week ? Math.ceil(taskData.week / 4) : null),
            order: taskData.order || i,
            // Apply exact same dates to Timeline Task
            plannedStartDate: taskStartDate,
            plannedEndDate: taskEndDate,
            isCritical: taskData.isCritical || false,
            notes: taskData.notes || null,
          },
        });
      }

      await tx.timelineHistory.create({
        data: {
          timelineId: timeline.id,
          action: 'TIMELINE_CREATED',
          entityType: 'TIMELINE',
          entityId: timeline.id,
          performedById: req.user.userId,
          notes: `Created timeline "${name}" with ${tasks.length} tasks`,
        },
      });

      return { timeline, version };
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'TIMELINE_CREATED',
        entityType: 'TIMELINE',
        entityId: result.timeline.id,
        newData: {
          projectId,
          name,
          startDate,
          endDate,
          taskCount: tasks.length,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    const timelineWithDetails = await prisma.timeline.findUnique({
      where: { id: result.timeline.id },
      include: {
        project: true,
        createdBy: true,
        timelineVersions: {
          where: { versionNumber: 1 },
          include: {
            timelineTasks: {
              include: {
                task: {
                  include: {
                    subtasks: true,
                  },
                },
              },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Timeline created successfully',
      data: timelineWithDetails,
    });
  } catch (error) {
    console.error('Create timeline error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to create timeline',
    });
  }
};

// 2. GET ALL TIMELINES
export const getAllTimelines = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      status,
      projectId,
      isArchived = false,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view timelines',
      });
    }

    const where = {
      project: {
        companyId: req.user.companyId,
      },
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { project: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (status) where.status = status;
    if (projectId) where.projectId = projectId;

    const [timelines, total] = await Promise.all([
      prisma.timeline.findMany({
        where,
        include: {
          project: true,
          createdBy: true,
        },
        skip,
        take: parseInt(limit),
        orderBy: { [sortBy]: sortOrder },
      }),
      prisma.timeline.count({ where }),
    ]);

    return res.status(200).json({
      success: true,
      data: timelines,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get all timelines error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve timelines',
    });
  }
};

// 3. GET TIMELINE BY ID
export const getTimelineById = async (req, res) => {
  try {
    const { id } = req.params;

    const access = await validateTimelineAccess(
      id,
      req.user.userId,
      req.user.companyId,
      req.user.userType
    );

    if (!access.valid) {
      return res.status(403).json({ success: false, message: access.error });
    }

    const timeline = await prisma.timeline.findUnique({
      where: { id },
      include: {
        project: true,
        createdBy: true,
        timelineTasks: {
          include: {
            task: {
              include: { subtasks: true },
            },
          },
          orderBy: [
            { year: 'asc' },
            { month: 'asc' },
            { week: 'asc' },
            { order: 'asc' },
          ],
        },
      },
    });

    return res.status(200).json({
      success: true,
      data: timeline,
    });
  } catch (error) {
    console.error('Get timeline error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve timeline',
    });
  }
};

// 4. UPDATE TIMELINE
export const updateTimeline = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const access = await validateTimelineAccess(
      id,
      req.user.userId,
      req.user.companyId,
      req.user.userType
    );

    if (!access.valid) {
      return res.status(403).json({ success: false, message: access.error });
    }

    const updatedTimeline = await prisma.timeline.update({
      where: { id },
      data: updates,
    });

    return res.status(200).json({
      success: true,
      message: 'Timeline updated successfully',
      data: updatedTimeline,
    });
  } catch (error) {
    console.error('Update timeline error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update timeline',
    });
  }
};

// 5. DELETE TIMELINE
export const deleteTimeline = async (req, res) => {
  try {
    const { id } = req.params;

    const access = await validateTimelineAccess(
      id,
      req.user.userId,
      req.user.companyId,
      req.user.userType
    );

    if (!access.valid) {
      return res.status(403).json({ success: false, message: access.error });
    }

    await prisma.$transaction([
      prisma.timelineHistory.deleteMany({ where: { timelineId: id } }),
      prisma.timelineTask.deleteMany({ where: { timelineId: id } }),
      prisma.timelineVersion.deleteMany({ where: { timelineId: id } }),
      prisma.timeline.delete({ where: { id } }),
    ]);

    return res.status(200).json({
      success: true,
      message: 'Timeline deleted successfully',
    });
  } catch (error) {
    console.error('Delete timeline error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete timeline',
    });
  }
};

// 6. SUBMIT TIMELINE FOR APPROVAL
export const submitTimelineForApproval = async (req, res) => {
  try {
    const { id } = req.params;
    const { approverId, comments } = req.body;

    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_SUBMIT'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to submit timelines for approval',
      });
    }

    const access = await validateTimelineAccess(
      id,
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

    if (access.timeline.status !== 'DRAFT') {
      return res.status(400).json({
        success: false,
        message: `Timeline must be in DRAFT status to submit. Current status: ${access.timeline.status}`,
      });
    }

    if (!access.isAdmin && access.timeline.createdById !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the timeline creator can submit for approval',
      });
    }

    const approver = await prisma.user.findFirst({
      where: {
        id: approverId,
        companyId: req.user.companyId,
        userType: { in: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },
      },
    });

    if (!approver) {
      return res.status(404).json({
        success: false,
        message: 'Approver not found or does not have approval permissions',
      });
    }

    const updatedTimeline = await prisma.$transaction(async (tx) => {
      const timeline = await tx.timeline.update({
        where: { id },
        data: {
          status: 'PENDING_APPROVAL',
        },
      });

      await tx.timelineApproval.create({
        data: {
          timelineId: id,
          approvalType: 'TIMELINE_APPROVAL',
          entityType: 'TIMELINE',
          entityId: id,
          requestedById: req.user.userId,
          approverId: approverId,
          status: 'PENDING',
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      await tx.timelineHistory.create({
        data: {
          timelineId: id,
          action: 'TIMELINE_SUBMITTED',
          entityType: 'TIMELINE',
          entityId: id,
          performedById: req.user.userId,
          notes: comments || 'Submitted for approval',
        },
      });

      return timeline;
    });

    res.json({
      success: true,
      message: 'Timeline submitted for approval successfully',
      data: updatedTimeline,
    });
  } catch (error) {
    console.error('Submit timeline error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 7. APPROVE/REJECT TIMELINE
export const approveRejectTimeline = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, rejectionReason } = req.body;

    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_APPROVE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to approve/reject timelines',
      });
    }

    const access = await validateTimelineAccess(
      id,
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

    if (access.timeline.status !== 'PENDING_APPROVAL') {
      return res.status(400).json({
        success: false,
        message: `Timeline is not pending approval. Current status: ${access.timeline.status}`,
      });
    }

    const approvalRequest = await prisma.timelineApproval.findFirst({
      where: {
        timelineId: id,
        approverId: req.user.userId,
        status: 'PENDING',
      },
    });

    if (!approvalRequest && !access.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned as approver for this timeline',
      });
    }

    const updatedTimeline = await prisma.$transaction(async (tx) => {
      let newStatus;
      let decision;

      if (action === 'approve') {
        newStatus = 'APPROVED';
        decision = 'APPROVED';
      } else if (action === 'reject') {
        newStatus = 'DRAFT';
        decision = 'REJECTED';
      } else {
        throw new Error('Invalid action. Use "approve" or "reject"');
      }

      const timeline = await tx.timeline.update({
        where: { id },
        data: {
          status: newStatus,
          approvedById: action === 'approve' ? req.user.userId : null,
          approvedAt: action === 'approve' ? new Date() : null,
          rejectionReason: action === 'reject' ? rejectionReason : null,
        },
      });

      if (approvalRequest) {
        await tx.timelineApproval.update({
          where: { id: approvalRequest.id },
          data: {
            status: 'COMPLETED',
            decision: decision,
            decisionNotes: rejectionReason,
            decidedAt: new Date(),
          },
        });
      }

      await tx.timelineHistory.create({
        data: {
          timelineId: id,
          action:
            action === 'approve' ? 'TIMELINE_APPROVED' : 'TIMELINE_REJECTED',
          entityType: 'TIMELINE',
          entityId: id,
          performedById: req.user.userId,
          notes:
            rejectionReason ||
            (action === 'approve' ? 'Timeline approved' : 'Timeline rejected'),
        },
      });

      return timeline;
    });

    res.json({
      success: true,
      message: `Timeline ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
      data: updatedTimeline,
    });
  } catch (error) {
    console.error('Approve/reject timeline error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 8. LOCK/UNLOCK TIMELINE
export const lockUnlockTimeline = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, lockReason } = req.body;

    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_LOCK'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to lock/unlock timelines',
      });
    }

    const access = await validateTimelineAccess(
      id,
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

    if (action === 'lock') {
      if (!['APPROVED', 'ACTIVE'].includes(access.timeline.status)) {
        return res.status(400).json({
          success: false,
          message: `Only APPROVED or ACTIVE timelines can be locked. Current status: ${access.timeline.status}`,
        });
      }
    }

    if (action === 'unlock') {
      if (access.timeline.status !== 'LOCKED') {
        return res.status(400).json({
          success: false,
          message: `Only LOCKED timelines can be unlocked. Current status: ${access.timeline.status}`,
        });
      }
    }

    const updatedTimeline = await prisma.$transaction(async (tx) => {
      if (action === 'lock') {
        const timeline = await tx.timeline.update({
          where: { id },
          data: {
            status: 'LOCKED',
            lockedById: req.user.userId,
            lockedAt: new Date(),
          },
        });

        await tx.timelineHistory.create({
          data: {
            timelineId: id,
            action: 'TIMELINE_LOCKED',
            entityType: 'TIMELINE',
            entityId: id,
            performedById: req.user.userId,
            notes: lockReason || 'Timeline locked',
          },
        });

        return timeline;
      } else if (action === 'unlock') {
        if (!access.isAdmin && access.timeline.lockedById !== req.user.userId) {
          throw new Error(
            'Only the user who locked the timeline or admin can unlock it'
          );
        }

        const timeline = await tx.timeline.update({
          where: { id },
          data: {
            status: 'APPROVED',
            lockedById: null,
            lockedAt: null,
          },
        });

        await tx.timelineHistory.create({
          data: {
            timelineId: id,
            action: 'TIMELINE_UNLOCKED',
            entityType: 'TIMELINE',
            entityId: id,
            performedById: req.user.userId,
            notes: 'Timeline unlocked',
          },
        });

        return timeline;
      } else {
        throw new Error('Invalid action. Use "lock" or "unlock"');
      }
    });

    res.json({
      success: true,
      message: `Timeline ${action}ed successfully`,
      data: updatedTimeline,
    });
  } catch (error) {
    console.error('Lock/unlock timeline error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
};

// 9. ARCHIVE/RESTORE TIMELINE
export const archiveRestoreTimeline = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, archiveReason } = req.body;

    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_ARCHIVE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to archive/restore timelines',
      });
    }

    const access = await validateTimelineAccess(
      id,
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

    const updatedTimeline = await prisma.$transaction(async (tx) => {
      if (action === 'archive') {
        const timeline = await tx.timeline.update({
          where: { id },
          data: {
            status: 'ARCHIVED',
            archivedById: req.user.userId,
            archivedAt: new Date(),
          },
        });

        await tx.timelineHistory.create({
          data: {
            timelineId: id,
            action: 'TIMELINE_ARCHIVED',
            entityType: 'TIMELINE',
            entityId: id,
            performedById: req.user.userId,
            notes: archiveReason || 'Timeline archived',
          },
        });

        return timeline;
      } else if (action === 'restore') {
        if (access.timeline.status !== 'ARCHIVED') {
          throw new Error('Only archived timelines can be restored');
        }

        const timeline = await tx.timeline.update({
          where: { id },
          data: {
            status: 'APPROVED',
            archivedById: null,
            archivedAt: null,
          },
        });

        await tx.timelineHistory.create({
          data: {
            timelineId: id,
            action: 'TIMELINE_RESTORED',
            entityType: 'TIMELINE',
            entityId: id,
            performedById: req.user.userId,
            notes: 'Timeline restored from archive',
          },
        });

        return timeline;
      } else {
        throw new Error('Invalid action. Use "archive" or "restore"');
      }
    });

    res.json({
      success: true,
      message: `Timeline ${action}d successfully`,
      data: updatedTimeline,
    });
  } catch (error) {
    console.error('Archive/restore timeline error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
};

// 10. GET TIMELINE PROGRESS
export const getTimelineProgress = async (req, res) => {
  try {
    const { id } = req.params;

    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view timeline progress',
      });
    }

    const access = await validateTimelineAccess(
      id,
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

    const timelineTasks = await prisma.timelineTask.findMany({
      where: { timelineId: id },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            status: true,
            progress: true,
            startDate: true,
            dueDate: true,
            completedDate: true,
          },
        },
      },
    });

    const totalTasks = timelineTasks.length;
    const completedTasks = timelineTasks.filter(
      (tt) => tt.task.status === 'COMPLETED'
    ).length;
    const inProgressTasks = timelineTasks.filter(
      (tt) => tt.task.status === 'IN_PROGRESS'
    ).length;
    const delayedTasks = timelineTasks.filter(
      (tt) =>
        tt.task.dueDate &&
        new Date(tt.task.dueDate) < new Date() &&
        tt.task.status !== 'COMPLETED'
    ).length;

    let totalProgress = 0;
    timelineTasks.forEach((tt) => {
      totalProgress += tt.task.progress || 0;
    });
    const averageProgress = totalTasks > 0 ? totalProgress / totalTasks : 0;

    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const upcomingTasks = timelineTasks.filter((tt) => {
      return (
        tt.task.dueDate &&
        new Date(tt.task.dueDate) <= sevenDaysFromNow &&
        tt.task.status !== 'COMPLETED'
      );
    });

    res.json({
      success: true,
      data: {
        timelineId: id,
        timelineName: access.timeline.name,
        metrics: {
          totalTasks,
          completedTasks,
          inProgressTasks,
          delayedTasks,
          completionRate:
            totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0,
          averageProgress,
          delayedRate: totalTasks > 0 ? (delayedTasks / totalTasks) * 100 : 0,
        },
        upcomingTasks: upcomingTasks.map((tt) => ({
          taskId: tt.task.id,
          title: tt.task.title,
          dueDate: tt.task.dueDate,
          status: tt.task.status,
          progress: tt.task.progress,
        })),
        tasksByStatus: {
          completed: completedTasks,
          inProgress: inProgressTasks,
          delayed: delayedTasks,
          pending: totalTasks - completedTasks - inProgressTasks,
        },
      },
    });
  } catch (error) {
    console.error('Get timeline progress error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 11. GET TIMELINE HISTORY
export const getTimelineHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_HISTORY_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view timeline history',
      });
    }

    const access = await validateTimelineAccess(
      id,
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

    const [history, total] = await Promise.all([
      prisma.timelineHistory.findMany({
        where: { timelineId: id },
        include: {
          performedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { performedAt: 'desc' },
      }),
      prisma.timelineHistory.count({ where: { timelineId: id } }),
    ]);

    res.json({
      success: true,
      data: history,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get timeline history error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 12. GET TIMELINE APPROVALS
export const getTimelineApprovals = async (req, res) => {
  try {
    const { id } = req.params;

    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_APPROVAL_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view timeline approvals',
      });
    }

    const access = await validateTimelineAccess(
      id,
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

    const approvals = await prisma.timelineApproval.findMany({
      where: { timelineId: id },
      include: {
        requestedBy: {
          select: {
            id: true,
            name: true,
          },
        },
        approver: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: approvals,
    });
  } catch (error) {
    console.error('Get timeline approvals error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 13. CREATE TASK AND ADD TO TIMELINE
export const createTaskAndAddToTimeline = async (req, res) => {
  try {
    const { id: timelineId } = req.params;
    const {
      // Task fields
      title,
      description,
      assignedToId,
      priority = 'MEDIUM',
      estimatedHours,

      // Allow accepting either naming convention from the client
      startDate,
      dueDate,
      plannedStartDate,
      plannedEndDate,

      // Timeline scheduling fields
      year,
      month,
      week,
      timelineVersionId,
      isCritical = false,
      notes,
      order = 0,
      subtasks = [],
    } = req.body;

    const access = await validateTimelineAccess(
      timelineId,
      req.user.userId,
      req.user.companyId,
      req.user.userType
    );

    if (!access.valid) {
      return res.status(403).json({ success: false, message: access.error });
    }

    // DATE SYNCHRONIZATION: Extract dates from either naming convention
    const rawStartDate =
      plannedStartDate !== undefined ? plannedStartDate : startDate;
    const rawEndDate = plannedEndDate !== undefined ? plannedEndDate : dueDate;

    const synchronizedStartDate = rawStartDate ? new Date(rawStartDate) : null;
    const synchronizedEndDate = rawEndDate ? new Date(rawEndDate) : null;

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create the Task
      const task = await tx.task.create({
        data: {
          title,
          description,
          projectId: access.timeline.projectId,
          assignedToId,
          createdById: req.user.userId,
          priority,
          estimatedHours,
          // Apply dates to the Root Task
          startDate: synchronizedStartDate,
          dueDate: synchronizedEndDate,
        },
      });

      // 2. Create Subtasks
      if (subtasks.length > 0) {
        await tx.subtask.createMany({
          data: subtasks.map((s) => ({
            description: s.description,
            isCompleted: false,
            taskId: task.id,
            createdById: req.user.userId,
          })),
        });
      }

      // 3. Add Task to Timeline
      const timelineTask = await tx.timelineTask.create({
        data: {
          timelineId,
          timelineVersionId: timelineVersionId || null,
          taskId: task.id,
          year: parseInt(year),
          month: parseInt(month),
          week: parseInt(week),
          weekOfMonth: parseInt(week) ? Math.ceil(parseInt(week) / 4) : 1,
          order: order || 0,
          // Apply exact same dates to Timeline Task
          plannedStartDate: synchronizedStartDate,
          plannedEndDate: synchronizedEndDate,
          timelineStatus: 'SCHEDULED',
          isCritical,
          notes,
        },
      });

      return { task, timelineTask };
    });

    res.status(201).json({
      success: true,
      message: 'Task created and added to timeline successfully',
      data: result,
    });
  } catch (error) {
    console.error('Create task and add to timeline error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
