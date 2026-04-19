// src/controllers/worker.controller.js
import prisma from '../config/database.js';
import { uploadLocal, deleteLocal } from '../services/fileStorage.service.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const checkWorkerPermission = async (userId, companyId, permissionCode) => {
  // If no userId provided, it's an unauthenticated request - DENY
  if (!userId) {
    return false;
  }

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

const getCompanyIdFromRequest = (req) => {
  // Priority 1: From authenticated user
  if (req.user?.companyId) {
    return req.user.companyId;
  }

  // Priority 2: From header (manually provided by authorized personnel)
  if (req.headers['x-company-id']) {
    return req.headers['x-company-id'];
  }

  // Priority 3: From query parameter
  if (req.query.companyId) {
    return req.query.companyId;
  }

  // Priority 4: From body
  if (req.body.companyId) {
    return req.body.companyId;
  }

  return null;
};

const getUserIdFromRequest = (req) => {
  // Priority 1: From authenticated user
  if (req.user?.userId) {
    return req.user.userId;
  }

  // Priority 2: From header (manually provided by authorized personnel)
  if (req.headers['x-user-id']) {
    return req.headers['x-user-id'];
  }

  // Priority 3: From query parameter
  if (req.query.userId) {
    return req.query.userId;
  }

  // Priority 4: From body
  if (req.body.userId) {
    return req.body.userId;
  }

  return null;
};

const generateWorkerId = async (companyId, prefix = 'SS') => {
  const year = new Date().getFullYear().toString().slice(-2);
  const month = (new Date().getMonth() + 1).toString().padStart(2, '0');

  const latestWorker = await prisma.siteStaff.findFirst({
    where: {
      companyId,
      workerId: {
        startsWith: `${prefix}${year}${month}`,
      },
    },
    orderBy: { workerId: 'desc' },
    select: { workerId: true },
  });

  let serial = 1;
  if (latestWorker && latestWorker.workerId) {
    const lastSerial = parseInt(latestWorker.workerId.slice(-4)) || 0;
    serial = lastSerial + 1;
  }

  return `${prefix}${year}${month}${serial.toString().padStart(4, '0')}`;
};

const uploadWorkerDocument = async (file, folder, fileNamePrefix) => {
  try {
    const uploadDir = path.join(__dirname, `../../uploads/${folder}`);

    const fs = await import('fs');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const fileExt = path.extname(file.originalname).toLowerCase();

    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
    if (!allowedExtensions.includes(fileExt)) {
      throw new Error(
        'Invalid file format. Allowed: JPG, JPEG, PNG, WebP, PDF'
      );
    }

    const fileName = `${fileNamePrefix}_${uniqueSuffix}${fileExt}`;
    const filePath = path.join(uploadDir, fileName);

    await fs.promises.rename(file.path, filePath);

    const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
    const fileUrl = `${baseUrl}/uploads/${folder}/${fileName}`;

    return {
      success: true,
      url: fileUrl,
      fileName: file.originalname,
      storedName: fileName,
      filePath: filePath,
      size: file.size,
      mimetype: file.mimetype,
    };
  } catch (error) {
    console.error('Worker document upload error:', error);
    throw new Error('Failed to upload worker document');
  }
};

export const createSiteStaff = async (req, res) => {
  try {
    // Get the user performing this action
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message:
          'Authentication required. User ID and Company ID must be provided.',
      });
    }

    // Check permission - only authorized personnel can create workers
    const hasPermission = await checkWorkerPermission(
      userId,
      companyId,
      'WORKER_CREATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message:
          'You do not have permission to create workers. Required permission: WORKER_CREATE',
      });
    }

    const {
      name,
      phone,
      alternatePhone,
      email,
      aadharNumber,
      panNumber,
      address,
      designation,
      skillSet,
      experience,
      dailyWageRate,
      overtimeRate,
      bankName,
      bankAccount,
      bankIfsc,
      dateOfJoining,
      dateOfBirth,
      emergencyContact,
      emergencyPhone,
      notes,
    } = req.body;

    // Check if worker with same phone or aadhar already exists
    if (phone) {
      const existingWorker = await prisma.siteStaff.findFirst({
        where: {
          companyId,
          OR: [{ phone }, ...(aadharNumber ? [{ aadharNumber }] : [])],
        },
      });

      if (existingWorker) {
        return res.status(400).json({
          success: false,
          message: 'Worker with this phone or Aadhar already exists',
        });
      }
    }

    // Generate worker ID
    const workerId = await generateWorkerId(companyId);

    // Handle file uploads
    let profilePictureUrl = null;
    if (req.files?.profilePicture) {
      const uploadResult = await uploadWorkerDocument(
        req.files.profilePicture[0],
        'worker-profiles',
        `worker_${workerId}`
      );
      profilePictureUrl = uploadResult.url;
    }

    let aadharCopyUrl = null;
    if (req.files?.aadharCopy) {
      const uploadResult = await uploadWorkerDocument(
        req.files.aadharCopy[0],
        'worker-documents',
        `aadhar_${workerId}`
      );
      aadharCopyUrl = uploadResult.url;
    }

    let panCopyUrl = null;
    if (req.files?.panCopy) {
      const uploadResult = await uploadWorkerDocument(
        req.files.panCopy[0],
        'worker-documents',
        `pan_${workerId}`
      );
      panCopyUrl = uploadResult.url;
    }

    // Create site staff
    const siteStaff = await prisma.siteStaff.create({
      data: {
        companyId,
        workerId,
        name,
        phone,
        alternatePhone,
        email,
        aadharNumber,
        panNumber,
        address,
        designation,
        skillSet: skillSet
          ? Array.isArray(skillSet)
            ? skillSet
            : [skillSet]
          : [],
        experience: experience ? parseInt(experience) : null,
        dailyWageRate: parseFloat(dailyWageRate || 500),
        overtimeRate: parseFloat(overtimeRate || 1.5),
        bankName,
        bankAccount,
        bankIfsc,
        profilePicture: profilePictureUrl,
        aadharCopy: aadharCopyUrl,
        panCopy: panCopyUrl,
        dateOfJoining: dateOfJoining ? new Date(dateOfJoining) : new Date(),
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        emergencyContact,
        emergencyPhone,
        notes,
        status: 'ACTIVE',
        isAvailable: true,
        createdById: userId,
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId,
        companyId,
        action: 'SITE_STAFF_CREATED',
        entityType: 'SITE_STAFF',
        entityId: siteStaff.id,
        newData: {
          workerId: siteStaff.workerId,
          name: siteStaff.name,
          designation: siteStaff.designation,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message: 'Site staff worker created successfully',
      data: siteStaff,
    });
  } catch (error) {
    console.error('Create site staff error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create site staff worker',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

export const getAllSiteStaff = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message:
          'Authentication required. User ID and Company ID must be provided.',
      });
    }

    const hasPermission = await checkWorkerPermission(
      userId,
      companyId,
      'WORKER_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message:
          'You do not have permission to view workers. Required permission: WORKER_READ',
      });
    }

    const {
      page = 1,
      limit = 20,
      search = '',
      status,
      designation,
      isAvailable,
      projectId,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      companyId,
    };

    // Add search filter
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { workerId: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { aadharNumber: { contains: search, mode: 'insensitive' } },
        { designation: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Add status filter
    if (status) {
      where.status = status;
    }

    // Add designation filter
    if (designation) {
      where.designation = { contains: designation, mode: 'insensitive' };
    }

    // Add availability filter
    if (isAvailable !== undefined) {
      where.isAvailable = isAvailable === 'true';
    }

    // Filter by project assignment
    if (projectId) {
      where.projectAssignments = {
        some: {
          projectId,
          isActive: true,
        },
      };
    }

    const [workers, total] = await Promise.all([
      prisma.siteStaff.findMany({
        where,
        include: {
          projectAssignments: {
            where: {
              isActive: true,
            },
            include: {
              project: {
                select: {
                  id: true,
                  name: true,
                  projectId: true,
                },
              },
            },
            take: 5,
          },
          subtaskAssignments: {
            where: {
              status: {
                notIn: ['COMPLETED', 'VERIFIED', 'REJECTED'],
              },
            },
            include: {
              subtask: {
                select: {
                  id: true,
                  description: true,
                },
              },
              task: {
                select: {
                  id: true,
                  title: true,
                },
              },
              project: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
            take: 5,
            orderBy: { createdAt: 'desc' },
          },
          _count: {
            select: {
              projectAssignments: {
                where: { isActive: true },
              },
              subtaskAssignments: true,
              attendances: {
                where: {
                  date: {
                    gte: new Date(new Date().setHours(0, 0, 0, 0)),
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
      prisma.siteStaff.count({ where }),
    ]);

    // Get today's attendance for each worker
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const workersWithAttendance = await Promise.all(
      workers.map(async (worker) => {
        const todayAttendance = await prisma.workerAttendance.findFirst({
          where: {
            workerType: 'SITE_STAFF',
            siteStaffId: worker.id,
            date: {
              gte: today,
              lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
            },
          },
        });

        return {
          ...worker,
          todayAttendance,
        };
      })
    );

    res.json({
      success: true,
      data: workersWithAttendance,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get site staff error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getSiteStaffById = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { id } = req.params;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message:
          'Authentication required. User ID and Company ID must be provided.',
      });
    }

    const hasPermission = await checkWorkerPermission(
      userId,
      companyId,
      'WORKER_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message:
          'You do not have permission to view worker details. Required permission: WORKER_READ',
      });
    }

    const worker = await prisma.siteStaff.findFirst({
      where: {
        id,
        companyId,
      },
      include: {
        projectAssignments: {
          include: {
            project: {
              select: {
                id: true,
                name: true,
                projectId: true,
                status: true,
              },
            },
            createdBy: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        subtaskAssignments: {
          include: {
            subtask: {
              select: {
                id: true,
                description: true,
                isCompleted: true,
              },
            },
            task: {
              select: {
                id: true,
                title: true,
                description: true,
                status: true,
              },
            },
            project: {
              select: {
                id: true,
                name: true,
              },
            },
            assignedBy: {
              select: {
                id: true,
                name: true,
              },
            },
            verifiedBy: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        attendances: {
          orderBy: { date: 'desc' },
          take: 30,
          include: {
            project: {
              select: {
                id: true,
                name: true,
              },
            },
            markedBy: {
              select: {
                id: true,
                name: true,
              },
            },
            verifiedBy: {
              select: {
                id: true,
                name: true,
              },
            },
            subtaskAssignment: {
              select: {
                id: true,
                subtask: {
                  select: {
                    description: true,
                  },
                },
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
        _count: {
          select: {
            projectAssignments: true,
            subtaskAssignments: true,
            attendances: true,
          },
        },
      },
    });

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found',
      });
    }

    // Calculate attendance statistics
    const totalDays = worker.attendances.length;
    const presentDays = worker.attendances.filter(
      (a) => a.status === 'PRESENT'
    ).length;
    const totalHours = worker.attendances.reduce(
      (sum, a) => sum + (a.totalHours || 0),
      0
    );
    const totalOvertime = worker.attendances.reduce(
      (sum, a) => sum + (a.overtimeHours || 0),
      0
    );
    const totalEarnings = worker.attendances.reduce(
      (sum, a) => sum + (a.totalPayable || 0),
      0
    );

    res.json({
      success: true,
      data: {
        ...worker,
        statistics: {
          totalDays,
          presentDays,
          attendanceRate: totalDays > 0 ? (presentDays / totalDays) * 100 : 0,
          totalHours: parseFloat(totalHours.toFixed(2)),
          totalOvertime: parseFloat(totalOvertime.toFixed(2)),
          totalEarnings: parseFloat(totalEarnings.toFixed(2)),
        },
      },
    });
  } catch (error) {
    console.error('Get site staff by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const updateSiteStaff = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { id } = req.params;
    const updates = req.body;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message:
          'Authentication required. User ID and Company ID must be provided.',
      });
    }

    const hasPermission = await checkWorkerPermission(
      userId,
      companyId,
      'WORKER_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message:
          'You do not have permission to update workers. Required permission: WORKER_UPDATE',
      });
    }

    const worker = await prisma.siteStaff.findFirst({
      where: {
        id,
        companyId,
      },
    });

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found',
      });
    }

    // Handle file uploads
    if (req.files?.profilePicture) {
      const uploadResult = await uploadWorkerDocument(
        req.files.profilePicture[0],
        'worker-profiles',
        `worker_${worker.workerId}`
      );
      updates.profilePicture = uploadResult.url;

      // Delete old profile picture if exists
      if (worker.profilePicture) {
        try {
          await deleteLocal(worker.profilePicture);
        } catch (error) {
          console.error('Error deleting old profile picture:', error);
        }
      }
    }

    if (req.files?.aadharCopy) {
      const uploadResult = await uploadWorkerDocument(
        req.files.aadharCopy[0],
        'worker-documents',
        `aadhar_${worker.workerId}`
      );
      updates.aadharCopy = uploadResult.url;

      if (worker.aadharCopy) {
        try {
          await deleteLocal(worker.aadharCopy);
        } catch (error) {
          console.error('Error deleting old aadhar copy:', error);
        }
      }
    }

    if (req.files?.panCopy) {
      const uploadResult = await uploadWorkerDocument(
        req.files.panCopy[0],
        'worker-documents',
        `pan_${worker.workerId}`
      );
      updates.panCopy = uploadResult.url;

      if (worker.panCopy) {
        try {
          await deleteLocal(worker.panCopy);
        } catch (error) {
          console.error('Error deleting old pan copy:', error);
        }
      }
    }

    // Parse numeric fields
    if (updates.experience) updates.experience = parseInt(updates.experience);
    if (updates.dailyWageRate)
      updates.dailyWageRate = parseFloat(updates.dailyWageRate);
    if (updates.overtimeRate)
      updates.overtimeRate = parseFloat(updates.overtimeRate);
    if (updates.dateOfJoining)
      updates.dateOfJoining = new Date(updates.dateOfJoining);
    if (updates.dateOfBirth)
      updates.dateOfBirth = new Date(updates.dateOfBirth);

    // Handle skillSet
    if (updates.skillSet) {
      updates.skillSet = Array.isArray(updates.skillSet)
        ? updates.skillSet
        : [updates.skillSet];
    }

    const updatedWorker = await prisma.siteStaff.update({
      where: { id },
      data: updates,
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId,
        companyId,
        action: 'SITE_STAFF_UPDATED',
        entityType: 'SITE_STAFF',
        entityId: id,
        oldData: worker,
        newData: updatedWorker,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Worker updated successfully',
      data: updatedWorker,
    });
  } catch (error) {
    console.error('Update site staff error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const deleteSiteStaff = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { id } = req.params;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message:
          'Authentication required. User ID and Company ID must be provided.',
      });
    }

    const hasPermission = await checkWorkerPermission(
      userId,
      companyId,
      'WORKER_DELETE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message:
          'You do not have permission to delete workers. Required permission: WORKER_DELETE',
      });
    }

    const worker = await prisma.siteStaff.findFirst({
      where: {
        id,
        companyId,
      },
    });

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found',
      });
    }

    // Check for active assignments
    const activeAssignments = await prisma.siteStaffAssignment.count({
      where: {
        siteStaffId: id,
        isActive: true,
      },
    });

    if (activeAssignments > 0) {
      return res.status(400).json({
        success: false,
        message:
          'Cannot delete worker with active project assignments. Please deactivate assignments first.',
      });
    }

    const activeSubtasks = await prisma.subtaskAssignment.count({
      where: {
        workerType: 'SITE_STAFF',
        siteStaffId: id,
        status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'] },
      },
    });

    if (activeSubtasks > 0) {
      return res.status(400).json({
        success: false,
        message:
          'Cannot delete worker with active subtask assignments. Please complete or reassign tasks first.',
      });
    }

    // Delete files
    try {
      if (worker.profilePicture) await deleteLocal(worker.profilePicture);
      if (worker.aadharCopy) await deleteLocal(worker.aadharCopy);
      if (worker.panCopy) await deleteLocal(worker.panCopy);
    } catch (error) {
      console.error('Error deleting worker files:', error);
    }

    // Delete worker
    await prisma.siteStaff.delete({
      where: { id },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId,
        companyId,
        action: 'SITE_STAFF_DELETED',
        entityType: 'SITE_STAFF',
        entityId: id,
        oldData: worker,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Worker deleted successfully',
    });
  } catch (error) {
    console.error('Delete site staff error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const assignSiteStaffToProject = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { workerId, projectId } = req.params;
    const {
      startDate,
      endDate,
      designation,
      dailyWageRate,
      overtimeRate,
      notes,
    } = req.body;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message:
          'Authentication required. User ID and Company ID must be provided.',
      });
    }

    const hasPermission = await checkWorkerPermission(
      userId,
      companyId,
      'WORKER_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message:
          'You do not have permission to assign workers to projects. Required permission: WORKER_UPDATE',
      });
    }

    // Check if worker exists
    const worker = await prisma.siteStaff.findFirst({
      where: {
        id: workerId,
        companyId,
      },
    });

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found',
      });
    }

    // Check if project exists
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        companyId,
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found',
      });
    }

    // Check for existing active assignment
    const existingAssignment = await prisma.siteStaffAssignment.findFirst({
      where: {
        siteStaffId: workerId,
        projectId,
        isActive: true,
      },
    });

    if (existingAssignment) {
      return res.status(400).json({
        success: false,
        message: 'Worker is already assigned to this project',
      });
    }

    const assignment = await prisma.siteStaffAssignment.create({
      data: {
        siteStaffId: workerId,
        projectId,
        assignedDate: new Date(),
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        designation: designation || worker.designation,
        dailyWageRate: parseFloat(dailyWageRate || worker.dailyWageRate),
        overtimeRate: parseFloat(overtimeRate || worker.overtimeRate),
        isActive: true,
        status: 'ACTIVE',
        notes,
        createdById: userId,
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId,
        companyId,
        action: 'SITE_STAFF_ASSIGNED',
        entityType: 'SITE_STAFF_ASSIGNMENT',
        entityId: assignment.id,
        newData: {
          workerId: worker.workerId,
          workerName: worker.name,
          projectId: project.projectId,
          projectName: project.name,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message: 'Worker assigned to project successfully',
      data: assignment,
    });
  } catch (error) {
    console.error('Assign site staff error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// // src/controllers/worker.controller.js (Updated punch in/out functions)

// // FIXED: Mark Worker Attendance (Punch In) - Updated with shift type and wage calculation
// export const markWorkerPunchIn = async (req, res) => {
//   try {
//     // This is the person PERFORMING the action (supervisor, manager, etc.)
//     const userId = getUserIdFromRequest(req);
//     const companyId = getCompanyIdFromRequest(req);

//     if (!userId || !companyId) {
//       return res.status(401).json({
//         success: false,
//         message:
//           'Authentication required. User ID and Company ID must be provided.',
//       });
//     }

//     // Check if the person marking attendance has permission
//     const hasPermission = await checkWorkerPermission(
//       userId,
//       companyId,
//       'WORKER_ATTENDANCE_MARK'
//     );

//     if (!hasPermission) {
//       return res.status(403).json({
//         success: false,
//         message:
//           'You do not have permission to mark worker attendance. Required permission: WORKER_ATTENDANCE_MARK',
//       });
//     }

//     const {
//       workerType,
//       workerId,
//       projectId,
//       latitude,
//       longitude,
//       notes,
//       subtaskAssignmentId,
//       shiftTypeId, // NEW: Add shift type
//     } = req.body;

//     if (!workerType || !workerId || !projectId) {
//       return res.status(400).json({
//         success: false,
//         message: 'Worker type, worker ID, and project ID are required',
//       });
//     }

//     if (!req.file) {
//       return res.status(400).json({
//         success: false,
//         message: 'Worker photo is required for check-in',
//       });
//     }

//     // Validate worker exists
//     let worker = null;
//     if (workerType === 'SITE_STAFF') {
//       worker = await prisma.siteStaff.findFirst({
//         where: {
//           id: workerId,
//           companyId,
//         },
//       });
//     } else if (workerType === 'SUBCONTRACTOR') {
//       worker = await prisma.subcontractorWorker.findFirst({
//         where: {
//           id: workerId,
//           contractor: {
//             companyId,
//           },
//         },
//         include: {
//           contractor: {
//             select: {
//               id: true,
//               name: true,
//             },
//           },
//         },
//       });
//     } else {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid worker type. Must be SITE_STAFF or SUBCONTRACTOR',
//       });
//     }

//     if (!worker) {
//       return res.status(404).json({
//         success: false,
//         message: 'Worker not found',
//       });
//     }

//     // Check if worker is assigned to project
//     if (workerType === 'SITE_STAFF') {
//       const assignment = await prisma.siteStaffAssignment.findFirst({
//         where: {
//           siteStaffId: workerId,
//           projectId,
//           isActive: true,
//         },
//       });

//       if (!assignment) {
//         return res.status(400).json({
//           success: false,
//           message: 'Worker is not assigned to this project',
//         });
//       }
//     }

//     // Get shift type multiplier if provided
//     let shiftMultiplier = 1.0;
//     let shiftType = null;

//     if (shiftTypeId) {
//       shiftType = await prisma.shiftType.findFirst({
//         where: {
//           id: shiftTypeId,
//           companyId,
//           isActive: true,
//         },
//       });
//       if (shiftType) {
//         shiftMultiplier = shiftType.multiplier;
//       }
//     }

//     const today = new Date();
//     today.setHours(0, 0, 0, 0);

//     // Check if already punched in today
//     const existingAttendance = await prisma.workerAttendance.findFirst({
//       where: {
//         workerType,
//         ...(workerType === 'SITE_STAFF'
//           ? { siteStaffId: workerId }
//           : { subcontractorWorkerId: workerId }),
//         date: {
//           gte: today,
//           lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
//         },
//         projectId,
//       },
//     });

//     if (existingAttendance && existingAttendance.checkInTime) {
//       return res.status(400).json({
//         success: false,
//         message: 'Worker has already punched in today',
//         data: existingAttendance,
//       });
//     }

//     // Upload check-in image
//     const uploadResult = await uploadWorkerDocument(
//       req.file,
//       'worker-attendance',
//       `checkin_${workerType}_${workerId}`
//     );

//     // Get worker's wage rate (from their current labour rate)
//     let wageRate = 0;
//     let overtimeRate = 1.5;

//     if (workerType === 'SITE_STAFF') {
//       // Get current labour rate from LabourRate table
//       const currentRate = await prisma.labourRate.findFirst({
//         where: {
//           companyId,
//           workerType: 'SITE_STAFF',
//           siteStaffId: workerId,
//           isCurrent: true,
//         },
//       });

//       wageRate = currentRate?.rate || worker.dailyWageRate || 500;
//       overtimeRate = worker.overtimeRate || 1.5;
//     } else {
//       const currentRate = await prisma.labourRate.findFirst({
//         where: {
//           companyId,
//           workerType: 'SUBCONTRACTOR',
//           subcontractorWorkerId: workerId,
//           isCurrent: true,
//         },
//       });

//       wageRate = currentRate?.rate || worker.wageRate || 500;
//       overtimeRate = worker.overtimeRate || 1.5;
//     }

//     // Create or update attendance with shift info
//     let attendance;

//     if (existingAttendance) {
//       // Update existing record
//       attendance = await prisma.workerAttendance.update({
//         where: { id: existingAttendance.id },
//         data: {
//           checkInTime: new Date(),
//           checkInLatitude: latitude ? parseFloat(latitude) : null,
//           checkInLongitude: longitude ? parseFloat(longitude) : null,
//           checkInImageUrl: uploadResult.url,
//           checkInNotes: notes,
//           wageRate,
//           overtimeRate,
//           markedById: userId,
//           status: 'PRESENT',
//           subtaskAssignmentId: subtaskAssignmentId || null,
//           shiftTypeId: shiftTypeId || null,
//           shiftMultiplier,
//         },
//       });
//     } else {
//       // Create new record
//       attendance = await prisma.workerAttendance.create({
//         data: {
//           workerType,
//           ...(workerType === 'SITE_STAFF'
//             ? { siteStaffId: workerId, subcontractorWorkerId: null }
//             : { subcontractorWorkerId: workerId, siteStaffId: null }),
//           projectId,
//           date: today,
//           status: 'PRESENT',
//           checkInTime: new Date(),
//           checkInLatitude: latitude ? parseFloat(latitude) : null,
//           checkInLongitude: longitude ? parseFloat(longitude) : null,
//           checkInImageUrl: uploadResult.url,
//           checkInNotes: notes,
//           wageRate,
//           overtimeRate,
//           markedById: userId,
//           subtaskAssignmentId: subtaskAssignmentId || null,
//           shiftTypeId: shiftTypeId || null,
//           shiftMultiplier,
//         },
//       });
//     }

//     // Log activity
//     await prisma.auditLog.create({
//       data: {
//         userId,
//         companyId,
//         action: 'WORKER_ATTENDANCE_PUNCH_IN',
//         entityType: 'WORKER_ATTENDANCE',
//         entityId: attendance.id,
//         newData: {
//           workerType,
//           workerName: worker.name,
//           projectId,
//           checkInTime: attendance.checkInTime,
//           shiftTypeId: attendance.shiftTypeId,
//           shiftMultiplier: attendance.shiftMultiplier,
//           wageRate: attendance.wageRate,
//         },
//         ipAddress: req.ip,
//         userAgent: req.headers['user-agent'],
//       },
//     });

//     res.json({
//       success: true,
//       message: 'Worker punched in successfully',
//       data: {
//         ...attendance,
//         workerName: worker.name,
//         shiftMultiplier,
//         wageRate,
//         estimatedPay: wageRate * shiftMultiplier, // Will be actualized on punch out
//       },
//     });
//   } catch (error) {
//     console.error('Mark worker punch in error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to mark worker punch in',
//       error: process.env.NODE_ENV === 'development' ? error.message : undefined,
//     });
//   }
// };

// // FIXED: Mark Worker Attendance (Punch Out) - Calculate pay based on shift multiplier
// export const markWorkerPunchOut = async (req, res) => {
//   try {
//     const userId = getUserIdFromRequest(req);
//     const companyId = getCompanyIdFromRequest(req);
//     const { attendanceId, latitude, longitude, notes } = req.body;

//     if (!userId || !companyId) {
//       return res.status(401).json({
//         success: false,
//         message:
//           'Authentication required. User ID and Company ID must be provided.',
//       });
//     }

//     const hasPermission = await checkWorkerPermission(
//       userId,
//       companyId,
//       'WORKER_ATTENDANCE_MARK'
//     );

//     if (!hasPermission) {
//       return res.status(403).json({
//         success: false,
//         message:
//           'You do not have permission to mark worker attendance. Required permission: WORKER_ATTENDANCE_MARK',
//       });
//     }

//     if (!req.file) {
//       return res.status(400).json({
//         success: false,
//         message: 'Worker photo is required for check-out',
//       });
//     }

//     // Get attendance record with shift type
//     const attendance = await prisma.workerAttendance.findUnique({
//       where: { id: attendanceId },
//       include: {
//         shiftType: true,
//       },
//     });

//     if (!attendance) {
//       return res.status(404).json({
//         success: false,
//         message: 'Attendance record not found',
//       });
//     }

//     if (attendance.checkOutTime) {
//       return res.status(400).json({
//         success: false,
//         message: 'Worker has already punched out',
//       });
//     }

//     // Upload check-out image
//     const uploadResult = await uploadWorkerDocument(
//       req.file,
//       'worker-attendance',
//       `checkout_${attendance.workerType}_${attendance.siteStaffId || attendance.subcontractorWorkerId}`
//     );

//     const checkOut = new Date();

//     // Calculate pay based on shift multiplier
//     // The shift multiplier determines the pay (1.0 = full day, 0.5 = half day, 1.5 = overtime day)
//     const shiftMultiplier = attendance.shiftMultiplier || 1.0;
//     const baseRate = attendance.wageRate || 0;

//     // Calculate total payable based on shift multiplier
//     // Daily wage is calculated as: Base Daily Rate × Shift Multiplier
//     const totalPayable = baseRate * shiftMultiplier;

//     // For reference, calculate hours (doesn't affect pay)
//     const checkIn = new Date(attendance.checkInTime);
//     const totalMinutes = (checkOut - checkIn) / (1000 * 60);
//     const totalHours = totalMinutes / 60;

//     // Update attendance
//     const updatedAttendance = await prisma.workerAttendance.update({
//       where: { id: attendanceId },
//       data: {
//         checkOutTime: checkOut,
//         checkOutLatitude: latitude ? parseFloat(latitude) : null,
//         checkOutLongitude: longitude ? parseFloat(longitude) : null,
//         checkOutImageUrl: uploadResult.url,
//         checkOutNotes: notes,
//         totalHours: parseFloat(totalHours.toFixed(2)),
//         totalPayable: parseFloat(totalPayable.toFixed(2)),
//       },
//     });

//     // Update subtask assignment if linked
//     if (attendance.subtaskAssignmentId) {
//       const subtaskAssignment = await prisma.subtaskAssignment.findUnique({
//         where: { id: attendance.subtaskAssignmentId },
//       });

//       if (subtaskAssignment) {
//         const newActualHours =
//           (subtaskAssignment.actualHours || 0) + totalHours;
//         const newActualWage =
//           (subtaskAssignment.actualWage || 0) + totalPayable;

//         await prisma.subtaskAssignment.update({
//           where: { id: attendance.subtaskAssignmentId },
//           data: {
//             actualHours: parseFloat(newActualHours.toFixed(2)),
//             actualWage: parseFloat(newActualWage.toFixed(2)),
//           },
//         });
//       }
//     }

//     // Log activity
//     await prisma.auditLog.create({
//       data: {
//         userId,
//         companyId,
//         action: 'WORKER_ATTENDANCE_PUNCH_OUT',
//         entityType: 'WORKER_ATTENDANCE',
//         entityId: attendance.id,
//         newData: {
//           checkOutTime: updatedAttendance.checkOutTime,
//           totalHours: updatedAttendance.totalHours,
//           totalPayable: updatedAttendance.totalPayable,
//           shiftMultiplier: attendance.shiftMultiplier,
//           baseRate: attendance.wageRate,
//         },
//         ipAddress: req.ip,
//         userAgent: req.headers['user-agent'],
//       },
//     });

//     // Get shift type details for response
//     const shiftType =
//       attendance.shiftType ||
//       (await prisma.shiftType.findUnique({
//         where: { id: attendance.shiftTypeId },
//       }));

//     res.json({
//       success: true,
//       message: 'Worker punched out successfully',
//       data: {
//         ...updatedAttendance,
//         calculation: {
//           baseRate: attendance.wageRate,
//           shiftMultiplier: attendance.shiftMultiplier,
//           shiftName: shiftType?.name || 'Regular',
//           totalPayable: updatedAttendance.totalPayable,
//           hoursWorked: updatedAttendance.totalHours,
//           calculationMethod: 'Daily Rate × Shift Multiplier',
//           formula: `${attendance.wageRate} × ${attendance.shiftMultiplier} = ${updatedAttendance.totalPayable}`,
//         },
//       },
//     });
//   } catch (error) {
//     console.error('Mark worker punch out error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to mark worker punch out',
//       error: process.env.NODE_ENV === 'development' ? error.message : undefined,
//     });
//   }
// };

// UPDATE bulkMarkWorkerAttendance function to be the primary attendance marking function
export const bulkMarkWorkerAttendance = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { date, projectId, attendanceData } = req.body;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message:
          'Authentication required. User ID and Company ID must be provided.',
      });
    }

    const hasPermission = await checkWorkerPermission(
      userId,
      companyId,
      'WORKER_ATTENDANCE_BULK_MARK'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message:
          'You do not have permission to bulk mark worker attendance. Required permission: WORKER_ATTENDANCE_BULK_MARK',
      });
    }

    if (!Array.isArray(attendanceData) || attendanceData.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Attendance data is required and must be an array',
      });
    }

    const attendanceDate = new Date(date);
    attendanceDate.setHours(0, 0, 0, 0);

    const results = [];
    const errors = [];

    for (const record of attendanceData) {
      try {
        const {
          workerType,
          workerId,
          status = 'PRESENT', // PRESENT or ABSENT
          shiftTypeId,
          notes,
        } = record;

        // Validate worker
        let worker = null;
        if (workerType === 'SITE_STAFF') {
          worker = await prisma.siteStaff.findFirst({
            where: {
              id: workerId,
              companyId,
            },
          });
        } else if (workerType === 'SUBCONTRACTOR') {
          worker = await prisma.subcontractorWorker.findFirst({
            where: {
              id: workerId,
              contractor: {
                companyId,
              },
            },
          });
        }

        if (!worker) {
          errors.push({
            workerId,
            error: 'Worker not found in your company',
          });
          continue;
        }

        // Check if attendance already exists
        const existingAttendance = await prisma.workerAttendance.findFirst({
          where: {
            workerType,
            ...(workerType === 'SITE_STAFF'
              ? { siteStaffId: workerId }
              : { subcontractorWorkerId: workerId }),
            date: {
              gte: attendanceDate,
              lt: new Date(attendanceDate.getTime() + 24 * 60 * 60 * 1000),
            },
            projectId,
          },
        });

        if (existingAttendance) {
          errors.push({
            workerId,
            workerName: worker.name,
            error: 'Attendance already marked for this date',
            existingAttendanceId: existingAttendance.id,
          });
          continue;
        }

        // Get shift type multiplier
        let shiftMultiplier = 1.0;
        let shiftType = null;

        if (shiftTypeId) {
          shiftType = await prisma.shiftType.findFirst({
            where: {
              id: shiftTypeId,
              companyId,
              isActive: true,
            },
          });
          if (shiftType) {
            shiftMultiplier = shiftType.multiplier;
          }
        }

        // Get worker's current labour rate
        let wageRate = 0;

        if (workerType === 'SITE_STAFF') {
          const currentRate = await prisma.labourRate.findFirst({
            where: {
              companyId,
              workerType: 'SITE_STAFF',
              siteStaffId: workerId,
              isCurrent: true,
            },
          });

          wageRate = currentRate?.rate || worker.dailyWageRate || 500;
        } else {
          const currentRate = await prisma.labourRate.findFirst({
            where: {
              companyId,
              workerType: 'SUBCONTRACTOR',
              subcontractorWorkerId: workerId,
              isCurrent: true,
            },
          });

          wageRate = currentRate?.rate || worker.wageRate || 500;
        }

        // Calculate daily wage based on shift multiplier
        // Daily wage = Labour Rate × Shift Multiplier
        const totalPayable = wageRate * shiftMultiplier;

        // Create attendance record
        const attendance = await prisma.workerAttendance.create({
          data: {
            workerType,
            siteStaffId: workerType === 'SITE_STAFF' ? workerId : null,
            subcontractorWorkerId:
              workerType === 'SUBCONTRACTOR' ? workerId : null,
            projectId,
            date: attendanceDate,
            status: status === 'PRESENT' ? 'PRESENT' : 'ABSENT',
            wageRate,
            totalPayable:
              status === 'PRESENT' ? parseFloat(totalPayable.toFixed(2)) : 0,
            shiftTypeId: shiftTypeId || null,
            shiftMultiplier: status === 'PRESENT' ? shiftMultiplier : 0,
            checkInNotes: notes,
            markedById: userId,
            isVerified: true,
            verifiedById: userId,
            verifiedAt: new Date(),
          },
        });

        results.push({
          success: true,
          workerId,
          workerName: worker.name,
          attendanceId: attendance.id,
          status: attendance.status,
          shiftMultiplier: attendance.shiftMultiplier,
          wageRate: attendance.wageRate,
          totalPayable: attendance.totalPayable,
          calculation:
            status === 'PRESENT'
              ? `${wageRate} × ${shiftMultiplier} = ${attendance.totalPayable}`
              : 'ABSENT - No payment',
        });
      } catch (error) {
        errors.push({
          workerId: record.workerId,
          error: error.message,
        });
      }
    }

    res.status(201).json({
      success: true,
      message: `Marked attendance for ${results.length} workers successfully`,
      summary: {
        total: attendanceData.length,
        successful: results.length,
        failed: errors.length,
        date: attendanceDate,
      },
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Bulk mark worker attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark bulk attendance',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Keep getWorkerAttendance as is - it already works for date-based queries
export const getWorkerAttendance = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message:
          'Authentication required. User ID and Company ID must be provided.',
      });
    }

    const hasPermission = await checkWorkerPermission(
      userId,
      companyId,
      'WORKER_ATTENDANCE_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message:
          'You do not have permission to view worker attendance. Required permission: WORKER_ATTENDANCE_READ',
      });
    }

    const {
      workerType,
      workerId,
      startDate,
      endDate,
      projectId,
      page = 1,
      limit = 30,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      project: {
        companyId,
      },
    };

    if (workerType && workerId) {
      where.workerType = workerType;
      if (workerType === 'SITE_STAFF') {
        where.siteStaffId = workerId;
      } else if (workerType === 'SUBCONTRACTOR') {
        where.subcontractorWorkerId = workerId;
      }
    }

    if (projectId) {
      where.projectId = projectId;
    }

    if (startDate || endDate) {
      where.date = {};
      if (startDate) {
        where.date.gte = new Date(startDate);
        where.date.gte.setHours(0, 0, 0, 0);
      }
      if (endDate) {
        where.date.lte = new Date(endDate);
        where.date.lte.setHours(23, 59, 59, 999);
      }
    }

    const [attendance, total] = await Promise.all([
      prisma.workerAttendance.findMany({
        where,
        include: {
          project: {
            select: {
              id: true,
              name: true,
              projectId: true,
            },
          },
          siteStaff: {
            select: {
              id: true,
              name: true,
              workerId: true,
              designation: true,
              dailyWageRate: true,
            },
          },
          subcontractorWorker: {
            select: {
              id: true,
              name: true,
              wageRate: true,
              contractor: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          shiftType: {
            select: {
              id: true,
              name: true,
              multiplier: true,
              description: true,
            },
          },
          markedBy: {
            select: {
              id: true,
              name: true,
            },
          },
          verifiedBy: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { date: 'desc' },
      }),
      prisma.workerAttendance.count({ where }),
    ]);

    // Calculate summary statistics with wage breakdown
    const totalPayable = attendance.reduce(
      (sum, a) => sum + (a.totalPayable || 0),
      0
    );
    const presentCount = attendance.filter(
      (a) => a.status === 'PRESENT'
    ).length;

    // Group by shift type
    const byShiftType = attendance.reduce((acc, a) => {
      if (a.status === 'PRESENT') {
        const shiftName = a.shiftType?.name || 'Regular';
        if (!acc[shiftName]) {
          acc[shiftName] = {
            count: 0,
            totalPayable: 0,
          };
        }
        acc[shiftName].count++;
        acc[shiftName].totalPayable += a.totalPayable || 0;
      }
      return acc;
    }, {});

    res.json({
      success: true,
      data: attendance,
      summary: {
        totalRecords: total,
        presentCount,
        absentCount: total - presentCount,
        totalPayable: parseFloat(totalPayable.toFixed(2)),
        byShiftType,
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get worker attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Keep verifyWorkerAttendance as is
export const verifyWorkerAttendance = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { id } = req.params;
    const { isVerified, verificationNotes } = req.body;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message:
          'Authentication required. User ID and Company ID must be provided.',
      });
    }

    const hasPermission = await checkWorkerPermission(
      userId,
      companyId,
      'WORKER_ATTENDANCE_VERIFY'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message:
          'You do not have permission to verify worker attendance. Required permission: WORKER_ATTENDANCE_VERIFY',
      });
    }

    const attendance = await prisma.workerAttendance.findFirst({
      where: {
        id,
        project: {
          companyId,
        },
      },
    });

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found',
      });
    }

    const updatedAttendance = await prisma.workerAttendance.update({
      where: { id },
      data: {
        isVerified: isVerified === true || isVerified === 'true',
        verificationNotes,
        verifiedById: userId,
        verifiedAt: new Date(),
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId,
        companyId,
        action: 'WORKER_ATTENDANCE_VERIFIED',
        entityType: 'WORKER_ATTENDANCE',
        entityId: id,
        oldData: { isVerified: attendance.isVerified },
        newData: { isVerified: updatedAttendance.isVerified },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: `Attendance ${isVerified ? 'verified' : 'rejected'} successfully`,
      data: updatedAttendance,
    });
  } catch (error) {
    console.error('Verify worker attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const assignSubtaskToWorker = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message:
          'Authentication required. User ID and Company ID must be provided.',
      });
    }

    const hasPermission = await checkWorkerPermission(
      userId,
      companyId,
      'WORKER_SUBTASK_ASSIGN'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message:
          'You do not have permission to assign subtasks to workers. Required permission: WORKER_SUBTASK_ASSIGN',
      });
    }

    const {
      workerType,
      workerId,
      subtaskId,
      taskId,
      projectId,
      startDate,
      dueDate,
      estimatedHours,
      priority = 'MEDIUM',
      notes,
    } = req.body;

    console.log('Assigning subtask:', {
      workerType,
      workerId,
      subtaskId,
      taskId,
      projectId,
    });

    if (!workerType || !workerId || !subtaskId || !taskId || !projectId) {
      return res.status(400).json({
        success: false,
        message:
          'Worker type, worker ID, subtask ID, task ID, and project ID are required',
      });
    }

    // Validate worker based on type
    let worker = null;
    let wageRate = 0;
    let overtimeRate = 1.5;

    if (workerType === 'SITE_STAFF') {
      worker = await prisma.siteStaff.findFirst({
        where: {
          id: workerId,
          companyId,
        },
      });

      if (worker) {
        wageRate = worker.dailyWageRate || 500;
        overtimeRate = worker.overtimeRate || 1.5;
      }
    } else if (workerType === 'SUBCONTRACTOR') {
      // FIXED: Properly query subcontractor worker with company validation
      worker = await prisma.subcontractorWorker.findFirst({
        where: {
          id: workerId,
          contractor: {
            companyId: companyId,
          },
        },
        include: {
          contractor: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (worker) {
        wageRate = worker.wageRate || 500;
        overtimeRate = worker.overtimeRate || 1.5;
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid worker type. Must be SITE_STAFF or SUBCONTRACTOR',
      });
    }

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found. Please verify the worker ID and company.',
      });
    }

    // Validate subtask exists and belongs to the task
    const subtask = await prisma.subtask.findUnique({
      where: { id: subtaskId },
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

    if (subtask.task.id !== taskId) {
      return res.status(400).json({
        success: false,
        message: 'Subtask does not belong to the specified task',
      });
    }

    // Check if task belongs to the project
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        projectId: projectId,
      },
    });

    if (!task) {
      return res.status(400).json({
        success: false,
        message: 'Task does not belong to the specified project',
      });
    }

    // Check if project belongs to the company
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        companyId: companyId,
      },
    });

    if (!project) {
      return res.status(400).json({
        success: false,
        message: 'Project not found in your company',
      });
    }

    // Check if already assigned
    const existingAssignment = await prisma.subtaskAssignment.findFirst({
      where: {
        workerType,
        ...(workerType === 'SITE_STAFF'
          ? { siteStaffId: workerId }
          : { subcontractorWorkerId: workerId }),
        subtaskId,
        status: {
          notIn: ['COMPLETED', 'VERIFIED', 'REJECTED'],
        },
      },
    });

    if (existingAssignment) {
      return res.status(400).json({
        success: false,
        message: 'This subtask is already assigned to the worker',
      });
    }

    // Calculate estimated wage
    const estimatedWage = estimatedHours
      ? estimatedHours * (wageRate / 8)
      : null;

    // Create the assignment
    const assignment = await prisma.subtaskAssignment.create({
      data: {
        workerType,
        siteStaffId: workerType === 'SITE_STAFF' ? workerId : null,
        subcontractorWorkerId: workerType === 'SUBCONTRACTOR' ? workerId : null,
        subtaskId,
        taskId,
        projectId,
        assignedDate: new Date(),
        startDate: startDate ? new Date(startDate) : new Date(),
        dueDate: dueDate ? new Date(dueDate) : null,
        status: 'PENDING',
        priority,
        estimatedHours: estimatedHours ? parseFloat(estimatedHours) : null,
        wageRate,
        overtimeRate,
        estimatedWage: estimatedWage
          ? parseFloat(estimatedWage.toFixed(2))
          : null,
        assignedById: userId,
        notes,
      },
      include: {
        siteStaff: {
          select: {
            id: true,
            name: true,
            workerId: true,
          },
        },
        subcontractorWorker: {
          select: {
            id: true,
            name: true,
            workerId: true,
            contractor: {
              select: {
                name: true,
              },
            },
          },
        },
        subtask: {
          select: {
            description: true,
          },
        },
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId,
        companyId,
        action: 'WORKER_SUBTASK_ASSIGNED',
        entityType: 'SUBTASK_ASSIGNMENT',
        entityId: assignment.id,
        newData: {
          workerType,
          workerId: worker.id,
          workerName: worker.name,
          subtaskId,
          taskId,
          projectId,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    // Prepare response data
    const responseData = {
      ...assignment,
      workerName:
        workerType === 'SITE_STAFF'
          ? assignment.siteStaff?.name
          : assignment.subcontractorWorker?.name,
      subtaskDescription: assignment.subtask?.description,
    };

    res.status(201).json({
      success: true,
      message: 'Subtask assigned to worker successfully',
      data: responseData,
    });
  } catch (error) {
    console.error('Assign subtask to worker error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign subtask to worker',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

export const getWorkerSubtaskAssignments = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message:
          'Authentication required. User ID and Company ID must be provided.',
      });
    }

    const hasPermission = await checkWorkerPermission(
      userId,
      companyId,
      'WORKER_SUBTASK_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message:
          'You do not have permission to view worker subtask assignments. Required permission: WORKER_SUBTASK_READ',
      });
    }

    const {
      workerType,
      workerId,
      status,
      projectId,
      taskId,
      page = 1,
      limit = 20,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      project: {
        companyId,
      },
    };

    if (workerType && workerId) {
      where.workerType = workerType;
      if (workerType === 'SITE_STAFF') {
        where.siteStaffId = workerId;
      } else if (workerType === 'SUBCONTRACTOR') {
        where.subcontractorWorkerId = workerId;
      }
    }

    if (status) {
      where.status = status;
    }

    if (projectId) {
      where.projectId = projectId;
    }

    if (taskId) {
      where.taskId = taskId;
    }

    const [assignments, total] = await Promise.all([
      prisma.subtaskAssignment.findMany({
        where,
        include: {
          siteStaff: {
            select: {
              id: true,
              name: true,
              workerId: true,
              designation: true,
            },
          },
          subcontractorWorker: {
            select: {
              id: true,
              name: true,
              contractor: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          subtask: {
            select: {
              id: true,
              description: true,
              isCompleted: true,
            },
          },
          task: {
            select: {
              id: true,
              title: true,
              description: true,
              status: true,
            },
          },
          project: {
            select: {
              id: true,
              name: true,
              projectId: true,
            },
          },
          assignedBy: {
            select: {
              id: true,
              name: true,
            },
          },
          verifiedBy: {
            select: {
              id: true,
              name: true,
            },
          },
          attendances: {
            select: {
              id: true,
              date: true,
              checkInTime: true,
              checkOutTime: true,
              totalHours: true,
            },
            orderBy: { date: 'desc' },
          },
          _count: {
            select: {
              attendances: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.subtaskAssignment.count({ where }),
    ]);

    res.json({
      success: true,
      data: assignments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get worker subtask assignments error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const updateSubtaskAssignmentStatus = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { id } = req.params;
    const { status, actualHours, completionNotes, qualityRating, feedback } =
      req.body;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message:
          'Authentication required. User ID and Company ID must be provided.',
      });
    }

    const hasPermission = await checkWorkerPermission(
      userId,
      companyId,
      'WORKER_SUBTASK_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message:
          'You do not have permission to update subtask assignments. Required permission: WORKER_SUBTASK_UPDATE',
      });
    }

    const assignment = await prisma.subtaskAssignment.findFirst({
      where: {
        id,
        project: {
          companyId,
        },
      },
      include: {
        subtask: true,
        task: true,
      },
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Subtask assignment not found',
      });
    }

    const updateData = { status };

    if (status === 'COMPLETED') {
      updateData.completedDate = new Date();
      updateData.completionNotes = completionNotes;
      updateData.qualityRating = qualityRating ? parseInt(qualityRating) : null;
      updateData.feedback = feedback;

      // Update subtask completion status
      await prisma.subtask.update({
        where: { id: assignment.subtaskId },
        data: { isCompleted: true },
      });
    }

    if (actualHours) {
      updateData.actualHours = parseFloat(actualHours);

      // Calculate actual wage
      if (assignment.wageRate) {
        const actualWage = parseFloat(actualHours) * (assignment.wageRate / 8);
        updateData.actualWage = parseFloat(actualWage.toFixed(2));
      }
    }

    const updatedAssignment = await prisma.subtaskAssignment.update({
      where: { id },
      data: updateData,
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId,
        companyId,
        action: 'WORKER_SUBTASK_STATUS_UPDATED',
        entityType: 'SUBTASK_ASSIGNMENT',
        entityId: id,
        newData: { status, actualHours, completionNotes },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Subtask assignment status updated successfully',
      data: updatedAssignment,
    });
  } catch (error) {
    console.error('Update subtask assignment status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const verifySubtaskCompletion = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { id } = req.params;
    const { isVerified, verificationNotes, qualityRating } = req.body;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message:
          'Authentication required. User ID and Company ID must be provided.',
      });
    }

    const hasPermission = await checkWorkerPermission(
      userId,
      companyId,
      'WORKER_SUBTASK_VERIFY'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message:
          'You do not have permission to verify subtask completion. Required permission: WORKER_SUBTASK_VERIFY',
      });
    }

    const assignment = await prisma.subtaskAssignment.findFirst({
      where: {
        id,
        project: {
          companyId,
        },
      },
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Subtask assignment not found',
      });
    }

    if (assignment.status !== 'COMPLETED') {
      return res.status(400).json({
        success: false,
        message: 'Only completed subtasks can be verified',
      });
    }

    const updatedAssignment = await prisma.subtaskAssignment.update({
      where: { id },
      data: {
        status: isVerified ? 'VERIFIED' : 'REJECTED',
        isVerified: isVerified === true || isVerified === 'true',
        verifiedById: userId,
        verifiedAt: new Date(),
        verificationNotes,
        qualityRating: qualityRating
          ? parseInt(qualityRating)
          : assignment.qualityRating,
      },
    });

    // If verified, mark subtask as completed in the task
    if (isVerified) {
      await prisma.subtask.update({
        where: { id: assignment.subtaskId },
        data: { isCompleted: true },
      });
    }

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId,
        companyId,
        action: 'WORKER_SUBTASK_VERIFIED',
        entityType: 'SUBTASK_ASSIGNMENT',
        entityId: id,
        oldData: {
          status: assignment.status,
          isVerified: assignment.isVerified,
        },
        newData: {
          status: updatedAssignment.status,
          isVerified: updatedAssignment.isVerified,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: `Subtask completion ${isVerified ? 'verified' : 'rejected'} successfully`,
      data: updatedAssignment,
    });
  } catch (error) {
    console.error('Verify subtask completion error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const removeSubtaskAssignment = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { id } = req.params;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message:
          'Authentication required. User ID and Company ID must be provided.',
      });
    }

    const hasPermission = await checkWorkerPermission(
      userId,
      companyId,
      'WORKER_SUBTASK_REMOVE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message:
          'You do not have permission to remove subtask assignments. Required permission: WORKER_SUBTASK_REMOVE',
      });
    }

    const assignment = await prisma.subtaskAssignment.findFirst({
      where: {
        id,
        project: {
          companyId,
        },
      },
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Subtask assignment not found',
      });
    }

    if (assignment.status === 'COMPLETED' || assignment.status === 'VERIFIED') {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove completed or verified assignments',
      });
    }

    // Check for linked attendance records
    const attendanceCount = await prisma.workerAttendance.count({
      where: { subtaskAssignmentId: id },
    });

    if (attendanceCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove assignment with linked attendance records',
      });
    }

    await prisma.subtaskAssignment.delete({
      where: { id },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId,
        companyId,
        action: 'WORKER_SUBTASK_REMOVED',
        entityType: 'SUBTASK_ASSIGNMENT',
        entityId: id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Subtask assignment removed successfully',
    });
  } catch (error) {
    console.error('Remove subtask assignment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getWorkerDashboardStats = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { workerType, workerId } = req.params;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message:
          'Authentication required. User ID and Company ID must be provided.',
      });
    }

    const hasPermission = await checkWorkerPermission(
      userId,
      companyId,
      'WORKER_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message:
          'You do not have permission to view worker statistics. Required permission: WORKER_READ',
      });
    }

    // Get worker details
    let worker = null;
    if (workerType === 'SITE_STAFF') {
      worker = await prisma.siteStaff.findFirst({
        where: {
          id: workerId,
          companyId,
        },
      });
    } else if (workerType === 'SUBCONTRACTOR') {
      worker = await prisma.subcontractorWorker.findFirst({
        where: {
          id: workerId,
          contractor: {
            companyId,
          },
        },
        include: {
          contractor: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
    }

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found',
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfWeek = new Date(today);
    startOfWeek.setDate(
      today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1)
    );

    // Get attendance statistics
    const [
      todayAttendance,
      weekAttendance,
      monthAttendance,
      totalAttendance,
      pendingSubtasks,
      inProgressSubtasks,
      completedSubtasks,
    ] = await Promise.all([
      // Today's attendance
      prisma.workerAttendance.findFirst({
        where: {
          workerType,
          ...(workerType === 'SITE_STAFF'
            ? { siteStaffId: workerId }
            : { subcontractorWorkerId: workerId }),
          date: {
            gte: today,
            lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
          },
        },
      }),

      // Week attendance
      prisma.workerAttendance.aggregate({
        where: {
          workerType,
          ...(workerType === 'SITE_STAFF'
            ? { siteStaffId: workerId }
            : { subcontractorWorkerId: workerId }),
          date: {
            gte: startOfWeek,
          },
        },
        _sum: {
          totalHours: true,
          totalPayable: true,
        },
        _count: true,
      }),

      // Month attendance
      prisma.workerAttendance.aggregate({
        where: {
          workerType,
          ...(workerType === 'SITE_STAFF'
            ? { siteStaffId: workerId }
            : { subcontractorWorkerId: workerId }),
          date: {
            gte: startOfMonth,
          },
        },
        _sum: {
          totalHours: true,
          totalPayable: true,
        },
        _count: true,
      }),

      // Total attendance
      prisma.workerAttendance.aggregate({
        where: {
          workerType,
          ...(workerType === 'SITE_STAFF'
            ? { siteStaffId: workerId }
            : { subcontractorWorkerId: workerId }),
        },
        _sum: {
          totalHours: true,
          totalPayable: true,
        },
        _count: true,
      }),

      // Pending subtasks
      prisma.subtaskAssignment.count({
        where: {
          workerType,
          ...(workerType === 'SITE_STAFF'
            ? { siteStaffId: workerId }
            : { subcontractorWorkerId: workerId }),
          status: { in: ['PENDING', 'ACCEPTED'] },
        },
      }),

      // In progress subtasks
      prisma.subtaskAssignment.count({
        where: {
          workerType,
          ...(workerType === 'SITE_STAFF'
            ? { siteStaffId: workerId }
            : { subcontractorWorkerId: workerId }),
          status: 'IN_PROGRESS',
        },
      }),

      // Completed subtasks
      prisma.subtaskAssignment.count({
        where: {
          workerType,
          ...(workerType === 'SITE_STAFF'
            ? { siteStaffId: workerId }
            : { subcontractorWorkerId: workerId }),
          status: { in: ['COMPLETED', 'VERIFIED'] },
        },
      }),
    ]);

    // Get recent activities
    const recentActivities = await prisma.$transaction([
      // Recent attendance
      prisma.workerAttendance.findMany({
        where: {
          workerType,
          ...(workerType === 'SITE_STAFF'
            ? { siteStaffId: workerId }
            : { subcontractorWorkerId: workerId }),
        },
        include: {
          project: {
            select: {
              name: true,
            },
          },
        },
        orderBy: { date: 'desc' },
        take: 5,
      }),
      // Recent subtask assignments
      prisma.subtaskAssignment.findMany({
        where: {
          workerType,
          ...(workerType === 'SITE_STAFF'
            ? { siteStaffId: workerId }
            : { subcontractorWorkerId: workerId }),
        },
        include: {
          subtask: {
            select: {
              description: true,
            },
          },
          task: {
            select: {
              title: true,
            },
          },
          project: {
            select: {
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    const stats = {
      worker: {
        id: worker.id,
        workerId: worker.workerId,
        name: worker.name,
        type: workerType,
        ...(workerType === 'SITE_STAFF'
          ? {
              designation: worker.designation,
              dailyWageRate: worker.dailyWageRate,
            }
          : {
              contractorName: worker.contractor?.name,
              wageRate: worker.wageRate,
            }),
      },
      attendance: {
        today: todayAttendance || null,
        week: {
          totalDays: weekAttendance._count,
          totalHours: parseFloat(
            (weekAttendance._sum.totalHours || 0).toFixed(2)
          ),
          totalEarnings: parseFloat(
            (weekAttendance._sum.totalPayable || 0).toFixed(2)
          ),
        },
        month: {
          totalDays: monthAttendance._count,
          totalHours: parseFloat(
            (monthAttendance._sum.totalHours || 0).toFixed(2)
          ),
          totalEarnings: parseFloat(
            (monthAttendance._sum.totalPayable || 0).toFixed(2)
          ),
        },
        overall: {
          totalDays: totalAttendance._count,
          totalHours: parseFloat(
            (totalAttendance._sum.totalHours || 0).toFixed(2)
          ),
          totalEarnings: parseFloat(
            (totalAttendance._sum.totalPayable || 0).toFixed(2)
          ),
        },
      },
      subtasks: {
        pending: pendingSubtasks,
        inProgress: inProgressSubtasks,
        completed: completedSubtasks,
        total: pendingSubtasks + inProgressSubtasks + completedSubtasks,
      },
      recentActivities: {
        attendance: recentActivities[0],
        assignments: recentActivities[1],
      },
    };

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Get worker dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
