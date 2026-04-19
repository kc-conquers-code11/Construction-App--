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

// 1. GET CRITICAL PATH
export const getCriticalPath = async (req, res) => {
  try {
    // Check TIMELINE_ANALYZE permission
    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_ANALYZE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to analyze timelines',
      });
    }

    const { id: timelineId } = req.params;
    const { timelineVersionId } = req.query;

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

    // Get timeline tasks
    const where = { timelineId };
    if (timelineVersionId) {
      where.timelineVersionId = timelineVersionId;
    }

    const timelineTasks = await prisma.timelineTask.findMany({
      where,
      include: {
        task: {
          include: {
            assignedTo: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: [{ year: 'asc' }, { month: 'asc' }, { week: 'asc' }],
    });

    // Simple critical path algorithm based on task dependencies
    // In a real system, you'd implement proper CPM (Critical Path Method)
    const criticalTasks = timelineTasks.filter((tt) => tt.isCritical);

    // Calculate timeline duration in weeks
    const startDate = new Date(access.timeline.startDate);
    const endDate = new Date(access.timeline.endDate);
    const durationWeeks = Math.ceil(
      (endDate - startDate) / (7 * 24 * 60 * 60 * 1000)
    );

    // Group critical tasks by week
    const criticalPathByWeek = {};
    criticalTasks.forEach((task) => {
      const weekKey = `Week ${task.week} (Year ${task.year}, Month ${task.month})`;
      if (!criticalPathByWeek[weekKey]) {
        criticalPathByWeek[weekKey] = [];
      }
      criticalPathByWeek[weekKey].push({
        taskId: task.task.id,
        title: task.task.title,
        assignedTo: task.task.assignedTo?.name || 'Unassigned',
        timelineStatus: task.timelineStatus,
        plannedStartDate: task.plannedStartDate,
        plannedEndDate: task.plannedEndDate,
      });
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'TIMELINE_CRITICAL_PATH_VIEWED',
        entityType: 'TIMELINE',
        entityId: timelineId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      data: {
        timelineId,
        timelineName: access.timeline.name,
        duration: {
          startDate: access.timeline.startDate,
          endDate: access.timeline.endDate,
          totalWeeks: durationWeeks,
          totalMonths: Math.ceil(durationWeeks / 4.33),
        },
        criticalPath: {
          totalCriticalTasks: criticalTasks.length,
          tasks: criticalTasks.map((tt) => ({
            taskId: tt.task.id,
            title: tt.task.title,
            week: tt.week,
            month: tt.month,
            year: tt.year,
            status: tt.timelineStatus,
            assignedTo: tt.task.assignedTo?.name || 'Unassigned',
            isDelayed: tt.timelineStatus === 'DELAYED',
          })),
          byWeek: criticalPathByWeek,
        },
        recommendations:
          criticalTasks.length === 0
            ? [
                'No critical tasks identified. Consider marking key tasks as critical.',
                'Review task dependencies to identify the critical path.',
              ]
            : [
                `Focus on ${criticalTasks.length} critical tasks for timely completion.`,
                'Monitor critical tasks weekly for any delays.',
                'Ensure resources are allocated to critical tasks first.',
              ],
      },
    });
  } catch (error) {
    console.error('Get critical path error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 2. GET TIMELINE GANTT DATA
export const getTimelineGanttData = async (req, res) => {
  try {
    // Check TIMELINE_ANALYZE permission
    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_ANALYZE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to analyze timelines',
      });
    }

    const { id: timelineId } = req.params;
    let { timelineVersionId } = req.query;

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

    // ============================================================
    // REFACTOR: Determine the Target Version
    // ============================================================
    if (!timelineVersionId) {
      // First, try to find a version explicitly marked as 'ACTIVE'
      const activeVersion = await prisma.timelineVersion.findFirst({
        where: {
          timelineId,
          status: 'ACTIVE',
        },
      });

      if (activeVersion) {
        timelineVersionId = activeVersion.id;
      } else {
        // Fallback: Use the 'currentVersion' number stored on the Timeline object
        // provided by validateTimelineAccess
        const versionByNumber = await prisma.timelineVersion.findFirst({
          where: {
            timelineId,
            versionNumber: access.timeline.currentVersion,
          },
        });
        timelineVersionId = versionByNumber?.id;
      }
    }

    // If after fallbacks we still don't have a version, it means the timeline is brand new with no versions
    if (!timelineVersionId) {
      return res.status(404).json({
        success: false,
        message: 'No active or approved version found for this timeline',
      });
    }

    // ============================================================
    // Fetch tasks ONLY for the resolved version ID to prevent duplicates
    // ============================================================
    const timelineTasks = await prisma.timelineTask.findMany({
      where: {
        timelineVersionId: timelineVersionId, // Strictly filter by version ID
      },
      include: {
        task: {
          include: {
            subtasks: true,
            assignedTo: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: [
        { year: 'asc' },
        { month: 'asc' },
        { week: 'asc' },
        { order: 'asc' },
      ],
    });

    // Format data for Gantt chart
    const ganttData = timelineTasks.map((tt) => {
      const startDate =
        tt.plannedStartDate ||
        new Date(tt.year, tt.month - 1, (tt.week - 1) * 7 + 1);

      const endDate =
        tt.plannedEndDate || new Date(tt.year, tt.month - 1, tt.week * 7);

      return {
        id: tt.id,
        taskId: tt.taskId,
        text: tt.task.title,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
        week: tt.week,
        month: tt.month,
        year: tt.year,
        duration: Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) || 1,
        progress: (tt.task.progress || 0) / 100,
        open: true,
        type: 'task',
        parent: 0,
        subtasks: tt.task.subtasks,
        assignee: tt.task.assignedTo?.name || 'Unassigned',
        status: tt.timelineStatus.toLowerCase(),
        priority: tt.task.priority.toLowerCase(),
      };
    });

    // Calculate metrics based on the filtered task list
    const metrics = {
      totalTasks: timelineTasks.length,
      totalSubtasks: timelineTasks.reduce(
        (sum, tt) => sum + tt.task.subtasks.length,
        0
      ),
      completedTasks: timelineTasks.filter(
        (tt) => tt.timelineStatus === 'COMPLETED'
      ).length,
      inProgressTasks: timelineTasks.filter(
        (tt) => tt.timelineStatus === 'IN_PROGRESS'
      ).length,
      delayedTasks: timelineTasks.filter(
        (tt) => tt.timelineStatus === 'DELAYED'
      ).length,
      completionRate:
        timelineTasks.length > 0
          ? (timelineTasks.filter((tt) => tt.timelineStatus === 'COMPLETED')
              .length /
              timelineTasks.length) *
            100
          : 0,
    };

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'TIMELINE_GANTT_VIEWED',
        entityType: 'TIMELINE',
        entityId: timelineId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      data: {
        timelineId,
        timelineName: access.timeline.name,
        startDate: access.timeline.startDate,
        endDate: access.timeline.endDate,
        ganttData,
        metrics,
        links: [],
      },
    });
  } catch (error) {
    console.error('Get Gantt data error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 3. GET PROJECT TIMELINE SUMMARY
export const getProjectTimelineSummary = async (req, res) => {
  try {
    // Check TIMELINE_READ permission
    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view timeline summaries',
      });
    }

    const { projectId } = req.params;

    // Validate project access
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        companyId: req.user.companyId,
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found',
      });
    }

    // Check if user has access to this project
    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      const isProjectCreator = project.createdById === req.user.userId;

      const isAssigned = await prisma.projectAssignment.findFirst({
        where: {
          projectId: projectId,
          userId: req.user.userId,
        },
      });

      const hasAllProjectsAccess = await checkTimelinePermission(
        req.user.userId,
        req.user.companyId,
        'VIEW_ALL_PROJECTS'
      );

      if (!isProjectCreator && !isAssigned && !hasAllProjectsAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this project',
        });
      }
    }

    // Get all timelines for the project
    const timelines = await prisma.timeline.findMany({
      where: {
        projectId,
        status: { not: 'ARCHIVED' },
      },
      include: {
        timelineVersions: {
          where: { isBaseline: true },
          take: 1,
        },
        _count: {
          select: {
            timelineTasks: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get project tasks for comparison
    const projectTasks = await prisma.task.findMany({
      where: { projectId },
      select: {
        id: true,
        status: true,
        progress: true,
        dueDate: true,
      },
    });

    // Calculate project progress
    const totalTasks = projectTasks.length;
    const completedTasks = projectTasks.filter(
      (t) => t.status === 'COMPLETED'
    ).length;
    const projectProgress =
      totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    // Find active timeline
    const activeTimeline = timelines.find((t) => t.status === 'ACTIVE');
    const approvedTimeline = timelines.find((t) => t.status === 'APPROVED');

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'PROJECT_TIMELINE_SUMMARY_VIEWED',
        entityType: 'PROJECT',
        entityId: projectId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      data: {
        project: {
          id: project.id,
          name: project.name,
          status: project.status,
          progress: project.progress,
        },
        timelines: {
          total: timelines.length,
          active: activeTimeline,
          approved: approvedTimeline,
          all: timelines.map((t) => ({
            id: t.id,
            name: t.name,
            status: t.status,
            startDate: t.startDate,
            endDate: t.endDate,
            versionCount: t._count.timelineVersions,
            taskCount: t._count.timelineTasks,
            baselineVersion: t.timelineVersions[0] || null,
          })),
        },
        metrics: {
          projectProgress,
          taskCompletion: {
            total: totalTasks,
            completed: completedTasks,
            percentage: projectProgress,
          },
          timelineCoverage:
            totalTasks > 0
              ? (timelines.reduce((sum, t) => sum + t._count.timelineTasks, 0) /
                  totalTasks) *
                100
              : 0,
        },
        recommendations: [
          activeTimeline
            ? 'Project has an active timeline.'
            : 'No active timeline. Consider creating or approving one.',
          `Timeline covers ${Math.round((timelines.reduce((sum, t) => sum + t._count.timelineTasks, 0) / totalTasks) * 100)}% of project tasks.`,
        ],
      },
    });
  } catch (error) {
    console.error('Get project timeline summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 4. GET DELAYED TIMELINES
export const getDelayedTimelines = async (req, res) => {
  try {
    // Check TIMELINE_READ permission
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

    const { companyId } = req.user;
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // For non-admin users, check if they have VIEW_ALL_TIMELINES permission
    let where = {
      project: {
        companyId,
      },
      timelineTasks: {
        some: {
          timelineStatus: 'DELAYED',
        },
      },
      status: { not: 'ARCHIVED' },
    };

    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      const hasAllTimelinesAccess = await checkTimelinePermission(
        req.user.userId,
        req.user.companyId,
        'VIEW_ALL_TIMELINES'
      );

      if (!hasAllTimelinesAccess) {
        // Get projects where user is assigned
        const userAssignments = await prisma.projectAssignment.findMany({
          where: { userId: req.user.userId },
          select: { projectId: true },
        });

        const assignedProjectIds = userAssignments.map((pa) => pa.projectId);

        // Get timelines created by user
        const createdTimelinesCondition = { createdById: req.user.userId };

        // Get timelines in projects where user is assigned
        const projectTimelinesCondition = {
          projectId: { in: assignedProjectIds },
        };

        // Apply project filter
        where.projectId = { in: assignedProjectIds };
      }
    }

    const [timelines, total] = await Promise.all([
      prisma.timeline.findMany({
        where,
        include: {
          project: {
            select: {
              id: true,
              name: true,
              projectId: true,
            },
          },
          timelineTasks: {
            where: {
              timelineStatus: 'DELAYED',
            },
            include: {
              task: {
                select: {
                  id: true,
                  title: true,
                  assignedTo: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
          _count: {
            select: {
              timelineTasks: {
                where: {
                  timelineStatus: 'DELAYED',
                },
              },
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.timeline.count({ where }),
    ]);

    // Calculate delay statistics
    const delayStats = {
      totalDelayedTimelines: total,
      totalDelayedTasks: timelines.reduce(
        (sum, t) => sum + t._count.timelineTasks,
        0
      ),
      byProject: {},
    };

    timelines.forEach((t) => {
      if (!delayStats.byProject[t.project.name]) {
        delayStats.byProject[t.project.name] = 0;
      }
      delayStats.byProject[t.project.name] += t._count.timelineTasks;
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'DELAYED_TIMELINES_VIEWED',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      data: {
        timelines,
        statistics: delayStats,
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get delayed timelines error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 5. GET UPCOMING MILESTONES
export const getUpcomingMilestones = async (req, res) => {
  try {
    // Check TIMELINE_READ permission
    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view milestones',
      });
    }

    const { companyId } = req.user;
    const { days = 30 } = req.query; // Default to next 30 days
    const daysFromNow = parseInt(days);

    const now = new Date();
    const futureDate = new Date(
      now.getTime() + daysFromNow * 24 * 60 * 60 * 1000
    );

    // For non-admin users, check if they have VIEW_ALL_PROJECTS permission
    let projectWhere = {
      companyId,
    };

    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      const hasAllProjectsAccess = await checkTimelinePermission(
        req.user.userId,
        req.user.companyId,
        'VIEW_ALL_PROJECTS'
      );

      if (!hasAllProjectsAccess) {
        // Get projects where user is assigned
        const userAssignments = await prisma.projectAssignment.findMany({
          where: { userId: req.user.userId },
          select: { projectId: true },
        });

        const assignedProjectIds = userAssignments.map((pa) => pa.projectId);

        projectWhere.id = { in: assignedProjectIds };
      }
    }

    // Get milestones from projects
    const milestones = await prisma.milestone.findMany({
      where: {
        project: projectWhere,
        dueDate: {
          gte: now,
          lte: futureDate,
        },
        status: { not: 'COMPLETED' },
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            projectId: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { dueDate: 'asc' },
      take: 20,
    });

    // Get timeline tasks that are critical and upcoming
    const upcomingCriticalTasks = await prisma.timelineTask.findMany({
      where: {
        timeline: {
          project: projectWhere,
        },
        isCritical: true,
        timelineStatus: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        plannedEndDate: {
          gte: now,
          lte: futureDate,
        },
      },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            assignedTo: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        timeline: {
          select: {
            id: true,
            name: true,
            project: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { plannedEndDate: 'asc' },
      take: 20,
    });

    // Combine milestones and critical tasks
    const upcomingItems = [
      ...milestones.map((m) => ({
        type: 'MILESTONE',
        id: m.id,
        title: m.name,
        description: m.description,
        dueDate: m.dueDate,
        project: m.project,
        status: m.status,
        createdBy: m.createdBy,
      })),
      ...upcomingCriticalTasks.map((t) => ({
        type: 'CRITICAL_TASK',
        id: t.task.id,
        title: t.task.title,
        description: `Critical task in timeline: ${t.timeline.name}`,
        dueDate: t.plannedEndDate,
        project: t.timeline.project,
        status: t.timelineStatus,
        assignedTo: t.task.assignedTo,
      })),
    ].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    // Group by week
    const itemsByWeek = {};
    upcomingItems.forEach((item) => {
      const weekStart = new Date(item.dueDate);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start of week (Sunday)
      const weekKey = `Week of ${weekStart.toISOString().split('T')[0]}`;

      if (!itemsByWeek[weekKey]) {
        itemsByWeek[weekKey] = [];
      }
      itemsByWeek[weekKey].push(item);
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'UPCOMING_MILESTONES_VIEWED',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      data: {
        timeframe: {
          start: now.toISOString().split('T')[0],
          end: futureDate.toISOString().split('T')[0],
          days: daysFromNow,
        },
        summary: {
          totalMilestones: milestones.length,
          totalCriticalTasks: upcomingCriticalTasks.length,
          totalUpcomingItems: upcomingItems.length,
        },
        upcomingItems,
        groupedByWeek: itemsByWeek,
      },
    });
  } catch (error) {
    console.error('Get upcoming milestones error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
