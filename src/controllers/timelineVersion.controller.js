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

// 1. CREATE TIMELINE VERSION
export const createTimelineVersion = async (req, res) => {
  try {
    const { id: timelineId } = req.params;
    const {
      name,
      description,
      startDate,
      endDate,
      changesSummary,
      copyFromVersion,
      isBaseline = false,
    } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required',
      });
    }

    const parsedStartDate = new Date(startDate);
    const parsedEndDate = new Date(endDate);

    if (isNaN(parsedStartDate) || isNaN(parsedEndDate)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid dates provided',
      });
    }

    if (parsedStartDate > parsedEndDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date cannot be after end date',
      });
    }

    let sourceVersionNumber = null;
    if (copyFromVersion) {
      sourceVersionNumber = parseInt(copyFromVersion);
      if (isNaN(sourceVersionNumber)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid source version number provided for copy',
        });
      }
    }

    // Check TIMELINE_VERSION_CREATE permission
    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_VERSION_CREATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create timeline versions',
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

    // Check if timeline can have new versions
    if (['LOCKED', 'ARCHIVED'].includes(access.timeline.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot create versions for timeline with status: ${access.timeline.status}`,
      });
    }

    // Get current version number
    const currentVersion = await prisma.timelineVersion.findFirst({
      where: { timelineId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });

    const newVersionNumber = (currentVersion?.versionNumber || 0) + 1;

    const newVersion = await prisma.$transaction(async (tx) => {
      // Create new version
      const version = await tx.timelineVersion.create({
        data: {
          timelineId,
          versionNumber: newVersionNumber,
          name: name || `Version ${newVersionNumber}`,
          description,
          startDate: parsedStartDate,
          endDate: parsedEndDate,
          status: 'DRAFT',
          isBaseline,
          changesSummary,
          createdById: req.user.userId,
        },
      });

      // If copying from another version, copy tasks
      if (sourceVersionNumber !== null) {
        const sourceVersion = await tx.timelineVersion.findFirst({
          where: {
            timelineId,
            versionNumber: sourceVersionNumber,
          },
        });

        if (sourceVersion) {
          const sourceTasks = await tx.timelineTask.findMany({
            where: {
              timelineVersionId: sourceVersion.id,
            },
          });

          // Create new tasks for this version (Snapshot of TimelineTasks)
          if (sourceTasks.length > 0) {
            const newTasks = sourceTasks.map((task) => ({
              timelineId,
              timelineVersionId: version.id,
              taskId: task.taskId,
              month: task.month,
              year: task.year,
              week: task.week,
              weekOfMonth: task.weekOfMonth,
              order: task.order,
              plannedStartDate: task.plannedStartDate,
              plannedEndDate: task.plannedEndDate,
              timelineStatus: task.timelineStatus,
              isCritical: task.isCritical,
              notes: task.notes,
            }));

            await tx.timelineTask.createMany({
              data: newTasks,
            });
          }
        }
      }

      // If setting as baseline, unset previous baseline
      if (isBaseline) {
        await tx.timelineVersion.updateMany({
          where: {
            timelineId,
            id: { not: version.id },
            isBaseline: true,
          },
          data: {
            isBaseline: false,
          },
        });

        // Also update timeline's baseline flag
        await tx.timeline.update({
          where: { id: timelineId },
          data: {
            isBaseline: true,
            currentVersion: newVersionNumber,
          },
        });
      }

      // Log version creation
      await tx.timelineHistory.create({
        data: {
          timelineId,
          timelineVersionId: version.id,
          action: 'VERSION_CREATED',
          entityType: 'TIMELINE_VERSION',
          entityId: version.id,
          performedById: req.user.userId,
          notes: `Created version ${newVersionNumber}: ${changesSummary || 'No summary'}`,
        },
      });

      return version;
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'TIMELINE_VERSION_CREATED',
        entityType: 'TIMELINE_VERSION',
        entityId: newVersion.id,
        newData: {
          timelineId,
          versionNumber: newVersionNumber,
          name,
          changesSummary,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message: 'Timeline version created successfully',
      data: newVersion,
    });
  } catch (error) {
    console.error('Create timeline version error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 2. GET ALL TIMELINE VERSIONS
export const getTimelineVersions = async (req, res) => {
  try {
    const { id: timelineId } = req.params;
    const { page = 1, limit = 10, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check TIMELINE_VERSION_READ permission
    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_VERSION_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view timeline versions',
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
    if (status) where.status = status;

    const [versions, total] = await Promise.all([
      prisma.timelineVersion.findMany({
        where,
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          approvedBy: {
            select: {
              id: true,
              name: true,
            },
          },
          submittedBy: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              timelineTasks: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { versionNumber: 'desc' },
      }),
      prisma.timelineVersion.count({ where }),
    ]);

    res.json({
      success: true,
      data: versions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get timeline versions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 3. GET TIMELINE VERSION DETAILS
export const getTimelineVersionById = async (req, res) => {
  try {
    const { id: timelineId, version: versionNumber } = req.params;

    const vNum = parseInt(versionNumber);
    if (isNaN(vNum)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid version number' });
    }

    // Check TIMELINE_VERSION_READ permission
    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_VERSION_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view timeline version details',
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

    const version = await prisma.timelineVersion.findFirst({
      where: {
        timelineId,
        versionNumber: vNum,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            designation: true,
          },
        },
        approvedBy: {
          select: {
            id: true,
            name: true,
          },
        },
        submittedBy: {
          select: {
            id: true,
            name: true,
          },
        },
        timelineTasks: {
          include: {
            task: {
              select: {
                id: true,
                title: true,
                description: true,
                status: true,
                priority: true,
                progress: true,
                startDate: true,
                dueDate: true,
                estimatedHours: true,
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
        },
      },
    });

    if (!version) {
      return res.status(404).json({
        success: false,
        message: 'Timeline version not found',
      });
    }

    res.json({
      success: true,
      data: version,
    });
  } catch (error) {
    console.error('Get timeline version error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 4. UPDATE TIMELINE VERSION
export const updateTimelineVersion = async (req, res) => {
  try {
    const { id: timelineId, version: versionNumber } = req.params;
    const updates = req.body;

    const vNum = parseInt(versionNumber);
    if (isNaN(vNum)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid version number' });
    }

    // Check TIMELINE_VERSION_UPDATE permission
    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_VERSION_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update timeline versions',
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

    // Get the version
    const version = await prisma.timelineVersion.findFirst({
      where: {
        timelineId,
        versionNumber: vNum,
      },
    });

    if (!version) {
      return res.status(404).json({
        success: false,
        message: 'Timeline version not found',
      });
    }

    // Check if version can be updated
    if (version.status !== 'DRAFT') {
      return res.status(400).json({
        success: false,
        message: `Only DRAFT versions can be updated. Current status: ${version.status}`,
      });
    }

    // Only creator or admin can update
    if (!access.isAdmin && version.createdById !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only update versions you created',
      });
    }

    // Safely parse dates and fix incorrect naming from previous implementation
    if (updates.startDate) {
      const parsedStart = new Date(updates.startDate);
      if (isNaN(parsedStart))
        return res
          .status(400)
          .json({ success: false, message: 'Invalid start date' });
      updates.startDate = parsedStart;
    }
    if (updates.endDate) {
      const parsedEnd = new Date(updates.endDate);
      if (isNaN(parsedEnd))
        return res
          .status(400)
          .json({ success: false, message: 'Invalid end date' });
      updates.endDate = parsedEnd;
    }

    const finalStart = updates.startDate || version.startDate;
    const finalEnd = updates.endDate || version.endDate;

    if (finalStart > finalEnd) {
      return res.status(400).json({
        success: false,
        message: 'Start date cannot be after end date',
      });
    }

    // STRIP PROTECTED FIELDS: Prevent users from overriding backend-controlled values
    delete updates.id;
    delete updates.timelineId;
    delete updates.versionNumber;
    delete updates.status; // Status must be updated via approval endpoints
    delete updates.isBaseline; // Must be updated via setVersionAsBaseline
    delete updates.createdById;

    const updatedVersion = await prisma.$transaction(async (tx) => {
      const oldVersion = { ...version };

      // Update version
      const updated = await tx.timelineVersion.update({
        where: { id: version.id },
        data: updates,
      });

      // Log update in history
      await tx.timelineHistory.create({
        data: {
          timelineId,
          timelineVersionId: version.id,
          action: 'VERSION_UPDATED',
          entityType: 'TIMELINE_VERSION',
          entityId: version.id,
          performedById: req.user.userId,
          changes: {
            old: oldVersion,
            new: updated,
          },
          notes: 'Version details updated',
        },
      });

      return updated;
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'TIMELINE_VERSION_UPDATED',
        entityType: 'TIMELINE_VERSION',
        entityId: version.id,
        newData: updates,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Timeline version updated successfully',
      data: updatedVersion,
    });
  } catch (error) {
    console.error('Update timeline version error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 5. DELETE TIMELINE VERSION
export const deleteTimelineVersion = async (req, res) => {
  try {
    const { id: timelineId, version: versionNumber } = req.params;

    const vNum = parseInt(versionNumber);
    if (isNaN(vNum)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid version number' });
    }

    // Check TIMELINE_VERSION_DELETE permission
    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_VERSION_DELETE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete timeline versions',
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

    // Get the version
    const version = await prisma.timelineVersion.findFirst({
      where: {
        timelineId,
        versionNumber: vNum,
      },
    });

    if (!version) {
      return res.status(404).json({
        success: false,
        message: 'Timeline version not found',
      });
    }

    // Check if version can be deleted
    if (version.status !== 'DRAFT') {
      return res.status(400).json({
        success: false,
        message: `Only DRAFT versions can be deleted. Current status: ${version.status}`,
      });
    }

    // Only creator or admin can delete
    if (!access.isAdmin && version.createdById !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete versions you created',
      });
    }

    // Cannot delete the only version
    const versionCount = await prisma.timelineVersion.count({
      where: { timelineId },
    });

    if (versionCount <= 1) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete the only version of a timeline',
      });
    }

    await prisma.$transaction(async (tx) => {
      // Delete version tasks
      await tx.timelineTask.deleteMany({
        where: { timelineVersionId: version.id },
      });

      // Delete version history
      await tx.timelineHistory.deleteMany({
        where: { timelineVersionId: version.id },
      });

      // Delete version approvals
      await tx.timelineApproval.deleteMany({
        where: { timelineVersionId: version.id },
      });

      // Delete version
      await tx.timelineVersion.delete({
        where: { id: version.id },
      });
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'TIMELINE_VERSION_DELETED',
        entityType: 'TIMELINE_VERSION',
        entityId: version.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Timeline version deleted successfully',
    });
  } catch (error) {
    console.error('Delete timeline version error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 6. SET VERSION AS BASELINE
export const setVersionAsBaseline = async (req, res) => {
  try {
    const { id: timelineId, version: versionNumber } = req.params;

    const vNum = parseInt(versionNumber);
    if (isNaN(vNum)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid version number' });
    }

    // Check TIMELINE_VERSION_SET_BASELINE permission
    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_VERSION_SET_BASELINE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to set timeline baselines',
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

    // Get the version
    const version = await prisma.timelineVersion.findFirst({
      where: {
        timelineId,
        versionNumber: vNum,
      },
    });

    if (!version) {
      return res.status(404).json({
        success: false,
        message: 'Timeline version not found',
      });
    }

    // Check if version can be set as baseline (must be approved)
    if (version.status !== 'APPROVED' && version.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: `Only APPROVED or ACTIVE versions can be set as baseline. Current status: ${version.status}`,
      });
    }

    const updatedVersion = await prisma.$transaction(async (tx) => {
      // Unset previous baseline
      await tx.timelineVersion.updateMany({
        where: {
          timelineId,
          id: { not: version.id },
          isBaseline: true,
        },
        data: {
          isBaseline: false,
        },
      });

      // Set this version as baseline
      const updated = await tx.timelineVersion.update({
        where: { id: version.id },
        data: {
          isBaseline: true,
        },
      });

      // Update timeline's current version
      await tx.timeline.update({
        where: { id: timelineId },
        data: {
          isBaseline: true,
          currentVersion: version.versionNumber,
        },
      });

      // Log baseline setting
      await tx.timelineHistory.create({
        data: {
          timelineId,
          timelineVersionId: version.id,
          action: 'VERSION_SET_BASELINE',
          entityType: 'TIMELINE_VERSION',
          entityId: version.id,
          performedById: req.user.userId,
          notes: `Set version ${version.versionNumber} as baseline`,
        },
      });

      return updated;
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'TIMELINE_BASELINE_SET',
        entityType: 'TIMELINE_VERSION',
        entityId: version.id,
        newData: {
          timelineId,
          versionNumber: version.versionNumber,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Version set as baseline successfully',
      data: updatedVersion,
    });
  } catch (error) {
    console.error('Set version as baseline error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 7. SUBMIT VERSION FOR APPROVAL
export const submitVersionForApproval = async (req, res) => {
  try {
    const { id: timelineId, version: versionNumber } = req.params;
    const { approverId, comments } = req.body;

    if (!approverId) {
      return res.status(400).json({
        success: false,
        message: 'Approver ID is required',
      });
    }

    const vNum = parseInt(versionNumber);
    if (isNaN(vNum)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid version number' });
    }

    // Check TIMELINE_SUBMIT permission
    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_SUBMIT'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to submit versions for approval',
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

    // Get the version
    const version = await prisma.timelineVersion.findFirst({
      where: {
        timelineId,
        versionNumber: vNum,
      },
    });

    if (!version) {
      return res.status(404).json({
        success: false,
        message: 'Timeline version not found',
      });
    }

    // Check if version can be submitted
    if (version.status !== 'DRAFT') {
      return res.status(400).json({
        success: false,
        message: `Only DRAFT versions can be submitted. Current status: ${version.status}`,
      });
    }

    // Only creator can submit
    if (!access.isAdmin && version.createdById !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the version creator can submit for approval',
      });
    }

    // Validate approver exists and has permission
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

    const updatedVersion = await prisma.$transaction(async (tx) => {
      // Update version status
      const updated = await tx.timelineVersion.update({
        where: { id: version.id },
        data: {
          status: 'PENDING_REVIEW',
          submittedById: req.user.userId,
          submittedAt: new Date(),
        },
      });

      // Create approval request
      await tx.timelineApproval.create({
        data: {
          timelineId,
          timelineVersionId: version.id,
          approvalType: 'VERSION_APPROVAL',
          entityType: 'TIMELINE_VERSION',
          entityId: version.id,
          requestedById: req.user.userId,
          approverId: approverId,
          status: 'PENDING',
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        },
      });

      // Log submission
      await tx.timelineHistory.create({
        data: {
          timelineId,
          timelineVersionId: version.id,
          action: 'VERSION_SUBMITTED',
          entityType: 'TIMELINE_VERSION',
          entityId: version.id,
          performedById: req.user.userId,
          notes: comments || 'Submitted for review',
        },
      });

      // Create notification for approver
      await tx.notification.create({
        data: {
          userId: approverId,
          title: 'Timeline Version Review Requested',
          message: `Timeline version "${version.name}" has been submitted for your review`,
          type: 'TIMELINE',
          relatedId: version.id,
        },
      });

      return updated;
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'TIMELINE_VERSION_SUBMITTED',
        entityType: 'TIMELINE_VERSION',
        entityId: version.id,
        newData: { approverId, comments },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Version submitted for approval successfully',
      data: updatedVersion,
    });
  } catch (error) {
    console.error('Submit version error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 8. APPROVE/REJECT VERSION
export const approveRejectVersion = async (req, res) => {
  try {
    const { id: timelineId, version: versionNumber } = req.params;
    const { action, rejectionReason } = req.body; // action: 'approve' or 'reject'

    if (action !== 'approve' && action !== 'reject') {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Use "approve" or "reject"',
      });
    }

    const vNum = parseInt(versionNumber);
    if (isNaN(vNum)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid version number' });
    }

    // Check TIMELINE_APPROVE permission
    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_APPROVE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to approve/reject versions',
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

    // Get the version
    const version = await prisma.timelineVersion.findFirst({
      where: {
        timelineId,
        versionNumber: vNum,
      },
    });

    if (!version) {
      return res.status(404).json({
        success: false,
        message: 'Timeline version not found',
      });
    }

    // Check if version is pending review
    if (version.status !== 'PENDING_REVIEW') {
      return res.status(400).json({
        success: false,
        message: `Version is not pending review. Current status: ${version.status}`,
      });
    }

    // Check if user is the assigned approver
    const approvalRequest = await prisma.timelineApproval.findFirst({
      where: {
        timelineVersionId: version.id,
        approverId: req.user.userId,
        status: 'PENDING',
      },
    });

    if (!approvalRequest && !access.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned as approver for this version',
      });
    }

    const updatedVersion = await prisma.$transaction(async (tx) => {
      let newStatus;
      let decision;

      if (action === 'approve') {
        newStatus = 'APPROVED';
        decision = 'APPROVED';
      } else if (action === 'reject') {
        newStatus = 'DRAFT';
        decision = 'REJECTED';
      }

      // Update version
      const updated = await tx.timelineVersion.update({
        where: { id: version.id },
        data: {
          status: newStatus,
          approvedById: action === 'approve' ? req.user.userId : null,
          approvedAt: action === 'approve' ? new Date() : null,
          rejectionReason: action === 'reject' ? rejectionReason : null,
        },
      });

      // Update approval request
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

      // If approving, deactivate other active versions
      if (action === 'approve') {
        await tx.timelineVersion.updateMany({
          where: {
            timelineId,
            id: { not: version.id },
            status: 'ACTIVE',
          },
          data: {
            status: 'APPROVED',
          },
        });

        // Set this version as active
        await tx.timelineVersion.update({
          where: { id: version.id },
          data: {
            status: 'ACTIVE',
          },
        });

        // Update timeline status if needed
        await tx.timeline.update({
          where: { id: timelineId },
          data: {
            status: 'ACTIVE',
            currentVersion: version.versionNumber,
          },
        });
      }

      // Log approval/rejection
      await tx.timelineHistory.create({
        data: {
          timelineId,
          timelineVersionId: version.id,
          action:
            action === 'approve' ? 'VERSION_APPROVED' : 'VERSION_REJECTED',
          entityType: 'TIMELINE_VERSION',
          entityId: version.id,
          performedById: req.user.userId,
          notes:
            rejectionReason ||
            (action === 'approve' ? 'Version approved' : 'Version rejected'),
        },
      });

      // Notify version creator
      await tx.notification.create({
        data: {
          userId: version.createdById,
          title: action === 'approve' ? 'Version Approved' : 'Version Rejected',
          message: `Your timeline version "${version.name}" has been ${action === 'approve' ? 'approved' : 'rejected'}`,
          type: 'TIMELINE',
          relatedId: version.id,
        },
      });

      return updated;
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action:
          action === 'approve'
            ? 'TIMELINE_VERSION_APPROVED'
            : 'TIMELINE_VERSION_REJECTED',
        entityType: 'TIMELINE_VERSION',
        entityId: version.id,
        newData: { action, rejectionReason },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: `Version ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
      data: updatedVersion,
    });
  } catch (error) {
    console.error('Approve/reject version error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// 9. COMPARE TWO VERSIONS
export const compareVersions = async (req, res) => {
  try {
    const { id: timelineId, version1, version2 } = req.params;

    const v1Num = parseInt(version1);
    const v2Num = parseInt(version2);

    if (isNaN(v1Num) || isNaN(v2Num)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid version numbers provided',
      });
    }

    // Check TIMELINE_COMPARE permission
    const hasPermission = await checkTimelinePermission(
      req.user.userId,
      req.user.companyId,
      'TIMELINE_COMPARE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to compare timeline versions',
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

    // Get both versions
    const [v1, v2] = await Promise.all([
      prisma.timelineVersion.findFirst({
        where: {
          timelineId,
          versionNumber: v1Num,
        },
        include: {
          timelineTasks: {
            include: {
              task: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  priority: true,
                  progress: true,
                },
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
      }),
      prisma.timelineVersion.findFirst({
        where: {
          timelineId,
          versionNumber: v2Num,
        },
        include: {
          timelineTasks: {
            include: {
              task: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  priority: true,
                  progress: true,
                },
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
      }),
    ]);

    if (!v1 || !v2) {
      return res.status(404).json({
        success: false,
        message: 'One or both versions not found',
      });
    }

    // Compare tasks
    const v1TaskIds = new Set(v1.timelineTasks.map((tt) => tt.taskId));
    const v2TaskIds = new Set(v2.timelineTasks.map((tt) => tt.taskId));

    const addedTasks = v2.timelineTasks.filter(
      (tt) => !v1TaskIds.has(tt.taskId)
    );
    const removedTasks = v1.timelineTasks.filter(
      (tt) => !v2TaskIds.has(tt.taskId)
    );

    // Find modified tasks (same task but different scheduling)
    const modifiedTasks = [];
    const v1TaskMap = new Map(v1.timelineTasks.map((tt) => [tt.taskId, tt]));
    const v2TaskMap = new Map(v2.timelineTasks.map((tt) => [tt.taskId, tt]));

    for (const [taskId, v1Task] of v1TaskMap.entries()) {
      if (v2TaskMap.has(taskId)) {
        const v2Task = v2TaskMap.get(taskId);
        const changes = {};

        // Check for scheduling differences
        if (v1Task.year !== v2Task.year)
          changes.year = { from: v1Task.year, to: v2Task.year };
        if (v1Task.month !== v2Task.month)
          changes.month = { from: v1Task.month, to: v2Task.month };
        if (v1Task.week !== v2Task.week)
          changes.week = { from: v1Task.week, to: v2Task.week };
        if (v1Task.weekOfMonth !== v2Task.weekOfMonth)
          changes.weekOfMonth = {
            from: v1Task.weekOfMonth,
            to: v2Task.weekOfMonth,
          };
        if (v1Task.timelineStatus !== v2Task.timelineStatus)
          changes.timelineStatus = {
            from: v1Task.timelineStatus,
            to: v2Task.timelineStatus,
          };
        if (v1Task.isCritical !== v2Task.isCritical)
          changes.isCritical = {
            from: v1Task.isCritical,
            to: v2Task.isCritical,
          };

        if (Object.keys(changes).length > 0) {
          modifiedTasks.push({
            task: v1Task.task,
            changes,
          });
        }
      }
    }

    // Compare timeline dates
    const timelineChanges = {};
    if (v1.startDate.getTime() !== v2.startDate.getTime()) {
      timelineChanges.startDate = { from: v1.startDate, to: v2.startDate };
    }
    if (v1.endDate.getTime() !== v2.endDate.getTime()) {
      timelineChanges.endDate = { from: v1.endDate, to: v2.endDate };
    }
    if (v1.name !== v2.name) {
      timelineChanges.name = { from: v1.name, to: v2.name };
    }

    res.json({
      success: true,
      data: {
        version1: {
          id: v1.id,
          versionNumber: v1.versionNumber,
          name: v1.name,
          startDate: v1.startDate,
          endDate: v1.endDate,
          status: v1.status,
        },
        version2: {
          id: v2.id,
          versionNumber: v2.versionNumber,
          name: v2.name,
          startDate: v2.startDate,
          endDate: v2.endDate,
          status: v2.status,
        },
        comparison: {
          timelineChanges,
          summary: {
            totalTasksV1: v1.timelineTasks.length,
            totalTasksV2: v2.timelineTasks.length,
            addedTasks: addedTasks.length,
            removedTasks: removedTasks.length,
            modifiedTasks: modifiedTasks.length,
          },
          details: {
            addedTasks: addedTasks.map((tt) => ({
              taskId: tt.task.id,
              title: tt.task.title,
              scheduled: {
                year: tt.year,
                month: tt.month,
                week: tt.week,
              },
            })),
            removedTasks: removedTasks.map((tt) => ({
              taskId: tt.task.id,
              title: tt.task.title,
            })),
            modifiedTasks,
          },
        },
      },
    });
  } catch (error) {
    console.error('Compare versions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
