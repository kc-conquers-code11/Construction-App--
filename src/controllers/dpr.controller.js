// src/controllers/dpr.controller.js
import prisma from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';

// Helper function to check DPR permissions
const checkDPRPermission = async (userId, companyId, permissionCode) => {
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

// Helper to generate DPR report number
const generateDPRReportNo = async (companyId, prefix = 'DPR') => {
  const settings = await prisma.companySettings.findUnique({
    where: { companyId },
  });

  const dprPrefix = settings?.dprPrefix || prefix;
  const year = new Date().getFullYear().toString().slice(-2);
  const month = (new Date().getMonth() + 1).toString().padStart(2, '0');

  // Get the latest DPR for this company to increment serial
  const latestDPR = await prisma.dailyProgressReport.findFirst({
    where: {
      reportNo: {
        startsWith: `${dprPrefix}${year}${month}`,
      },
    },
    orderBy: { reportNo: 'desc' },
    select: { reportNo: true },
  });

  let serial = 1;
  if (latestDPR && latestDPR.reportNo) {
    const lastSerial = parseInt(latestDPR.reportNo.slice(-4)) || 0;
    serial = lastSerial + 1;
  }

  return `${dprPrefix}${year}${month}${serial.toString().padStart(4, '0')}`;
};

// Helper function to check material permissions
const checkMaterialPermission = async (userId, companyId, permissionCode) => {
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

// ============================================
// NEW HELPER FUNCTIONS FOR ATTENDANCE & BUDGET
// ============================================

// Helper function to calculate labor cost from attendance
const calculateLaborCostFromAttendance = async (attendances) => {
  let totalCost = 0;
  let workersPresent = 0;
  let staffPresent = 0;

  for (const attendance of attendances) {
    totalCost += attendance.totalPayable || 0;

    if (attendance.workerType === 'SITE_STAFF') {
      staffPresent++;
    } else {
      workersPresent++;
    }
  }

  return {
    totalCost,
    workersPresent,
    staffPresent,
    totalAttendances: attendances.length,
  };
};

const getAttendanceForDate = async (projectId, date, companyId) => {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const attendances = await prisma.workerAttendance.findMany({
    where: {
      projectId,
      date: {
        gte: startOfDay,
        lte: endOfDay,
      },
      status: { in: ['PRESENT', 'LATE', 'HALF_DAY'] },
    },
    include: {
      siteStaff: {
        select: {
          id: true,
          name: true,
          designation: true,
          dailyWageRate: true,
          workerId: true,
        },
      },
      subcontractorWorker: {
        include: {
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
    },
    orderBy: {
      checkInTime: 'asc',
    },
  });

  return attendances;
};

// Helper function to process material consumption
const consumeMaterialFromDPRLogic = async ({
  dprId,
  materialId,
  quantity,
  unit,
  remarks,
  userId,
  projectId,
}) => {
  return await prisma.$transaction(async (tx) => {
    // Get material
    const material = await tx.material.findUnique({
      where: { id: materialId },
    });

    if (!material) {
      throw new Error('Material not found');
    }

    // Check stock in project inventory
    const inventory = await tx.inventory.findFirst({
      where: {
        materialId,
        projectId,
        location: 'PROJECT',
      },
    });

    if (!inventory || inventory.quantityAvailable < quantity) {
      throw new Error(
        `Insufficient stock for ${material.name}. Available: ${inventory?.quantityAvailable || 0} ${material.unit}`
      );
    }

    // FIFO from batches (oldest purchaseDate first). Without schema changes, we treat `MaterialBatch.quantity`
    // as remaining quantity for consumption tracking.
    const batches = await tx.materialBatch.findMany({
      where: {
        materialId,
        projectId,
        quantity: { gt: 0 },
      },
      orderBy: { purchaseDate: 'asc' },
    });

    let remaining = quantity;
    let totalCost = 0;
    let runningStock = inventory.quantityAvailable;
    const breakdown = [];

    for (const batch of batches) {
      if (remaining <= 0) break;
      const useQty = Math.min(remaining, batch.quantity);
      if (useQty <= 0) continue;

      await tx.materialBatch.update({
        where: { id: batch.id },
        data: { quantity: { decrement: useQty } },
      });

      totalCost += useQty * batch.unitPrice;
      breakdown.push({
        batchId: batch.id,
        qty: useQty,
        unitPrice: batch.unitPrice,
        batchNumber: batch.batchNumber || null,
      });

      await tx.stockTransaction.create({
        data: {
          materialId,
          projectId,
          transactionType: 'CONSUMPTION',
          quantity: useQty,
          previousStock: runningStock,
          newStock: runningStock - useQty,
          referenceId: batch.id,
          referenceType: 'MATERIAL_BATCH',
          createdById: userId,
          notes: `Consumed from batch ${batch.batchNumber || batch.id} in DPR${dprId ? `: ${dprId}` : ''}`,
        },
      });

      runningStock -= useQty;
      remaining -= useQty;
    }

    // Fallback: legacy data may have inventory but no batches.
    if (remaining > 0) {
      const fallbackRate = inventory.averageRate || material.unitPrice || 0;
      totalCost += remaining * fallbackRate;
      breakdown.push({
        batchId: null,
        qty: remaining,
        unitPrice: fallbackRate,
        batchNumber: null,
      });

      await tx.stockTransaction.create({
        data: {
          materialId,
          projectId,
          transactionType: 'CONSUMPTION',
          quantity: remaining,
          previousStock: runningStock,
          newStock: runningStock - remaining,
          referenceId: dprId,
          referenceType: 'CONSUMPTION',
          createdById: userId,
          notes: `Consumed using average rate (no batches found) in DPR${dprId ? `: ${dprId}` : ''}`,
        },
      });

      runningStock -= remaining;
      remaining = 0;
    }

    // Update inventory (value based on FIFO cost).
    const newAvailable = inventory.quantityAvailable - quantity;
    const newTotalValue = Math.max(0, inventory.totalValue - totalCost);
    const newAvgRate = newAvailable > 0 ? newTotalValue / newAvailable : 0;

    await tx.inventory.update({
      where: { id: inventory.id },
      data: {
        quantityAvailable: newAvailable,
        quantityUsed: { increment: quantity },
        totalValue: newTotalValue,
        averageRate: newAvgRate,
      },
    });

    // Create consumption record
    const enrichedRemarks =
      (remarks ? `${remarks}\n` : '') +
      `BatchBreakdown=${JSON.stringify(breakdown)}`;

    const consumption = await tx.materialConsumption.create({
      data: {
        materialId,
        projectId,
        quantity,
        unit: unit || material.unit,
        remarks: enrichedRemarks,
        consumedById: userId,
        ratePerUnit: quantity > 0 ? totalCost / quantity : 0,
        totalCost,
        dprId,
      },
    });

    return consumption;
  });
};

// Helper to send notifications
const sendDPRNotifications = async (project, dpr, userId) => {
  try {
    const notifications = [];

    // Notify project manager/creator
    if (project.createdById && project.createdById !== userId) {
      notifications.push({
        userId: project.createdById,
        title: 'New DPR Created',
        message: `DPR ${dpr.reportNo} created for project: ${project.name} with ${dpr.attendanceCount || 0} workers`,
        type: 'DPR',
        relatedId: dpr.id,
      });
    }

    // Notify supervisors/managers
    const supervisors = await prisma.projectAssignment.findMany({
      where: {
        projectId: project.id,
        OR: [
          { designation: { contains: 'Manager', mode: 'insensitive' } },
          { designation: { contains: 'Supervisor', mode: 'insensitive' } },
          { designation: { contains: 'Engineer', mode: 'insensitive' } },
        ],
        userId: { not: userId },
      },
      select: { userId: true },
    });

    for (const sup of supervisors) {
      notifications.push({
        userId: sup.userId,
        title: 'New DPR Created',
        message: `DPR ${dpr.reportNo} created for project: ${project.name}`,
        type: 'DPR',
        relatedId: dpr.id,
      });
    }

    if (notifications.length > 0) {
      await prisma.notification.createMany({
        data: notifications,
      });
    }
  } catch (error) {
    console.error('Error sending DPR notifications:', error);
  }
};

// ============================================
// UPDATED CREATE DPR WITH ATTENDANCE INTEGRATION
// ============================================

const calculateLaborSummary = (attendances) => {
  let totalWorkers = 0;
  let totalStaff = 0;
  let totalPayable = 0;

  const workersByShift = {};
  const workersList = [];

  for (const attendance of attendances) {
    const workerName =
      attendance.siteStaff?.name ||
      attendance.subcontractorWorker?.name ||
      'Unknown';
    const workerType = attendance.workerType;
    const shiftName = attendance.shiftType?.name || 'Regular';
    const shiftMultiplier = attendance.shiftMultiplier || 1.0;
    const wageRate = attendance.wageRate || 0;
    const payable = attendance.totalPayable || 0;

    totalPayable += payable;

    if (workerType === 'SITE_STAFF') {
      totalStaff++;
    } else {
      totalWorkers++;
    }

    // Group by shift
    if (!workersByShift[shiftName]) {
      workersByShift[shiftName] = {
        count: 0,
        totalPayable: 0,
        multiplier: shiftMultiplier,
      };
    }
    workersByShift[shiftName].count++;
    workersByShift[shiftName].totalPayable += payable;

    // Add to workers list
    workersList.push({
      id: attendance.id,
      workerId: attendance.siteStaffId || attendance.subcontractorWorkerId,
      name: workerName,
      type: workerType,
      designation: attendance.siteStaff?.designation,
      contractor: attendance.subcontractorWorker?.contractor?.name,
      shift: {
        id: attendance.shiftTypeId,
        name: shiftName,
        multiplier: shiftMultiplier,
      },
      checkIn: attendance.checkInTime,
      checkOut: attendance.checkOutTime,
      totalHours: attendance.totalHours,
      wageRate: wageRate,
      totalPayable: payable,
      calculation: `${wageRate} × ${shiftMultiplier} = ${payable}`,
      status: attendance.status,
    });
  }

  return {
    totalAttendances: attendances.length,
    totalWorkers,
    totalStaff,
    totalPayable: parseFloat(totalPayable.toFixed(2)),
    byShift: workersByShift,
    workers: workersList,
  };
};
// Create DPR
export const createDPR = async (req, res) => {
  try {
    const {
      projectId,
      date,
      weather,
      temperature,
      humidity,
      workDescription,
      completedWork,
      pendingWork,
      challenges,
      totalWorkers,
      supervisorPresent,
      equipmentUsed,
      materialsUsed,
      materialsReceived,
      materialsRequired,
      safetyObservations,
      incidents,
      qualityChecks,
      issuesFound,
      nextDayPlan,

      // NEW FIELDS
      siteVisitors = [],
      equipmentUsage = [],
      subcontractorDetails = {},
      nextDayPlanning = {},
      materialsConsumed = [],
      photos = [],
      documents = [],
    } = req.body;

    // Check DPR_CREATE permission
    const hasPermission = await checkDPRPermission(
      req.user.userId,
      req.user.companyId,
      'DPR_CREATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create DPRs',
      });
    }

    // Check if project exists and belongs to company
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        companyId: req.user.companyId,
      },
      include: {
        activeBudget: true,
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found in your company',
      });
    }

    // Check if user is assigned to the project
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
          message: 'You must be assigned to this project to create DPRs',
        });
      }
    }

    // Check if DPR already exists for this project on this date
    const existingDPR = await prisma.dailyProgressReport.findFirst({
      where: {
        projectId,
        date: new Date(date),
      },
    });

    if (existingDPR) {
      return res.status(400).json({
        success: false,
        message: 'DPR already exists for this project on this date',
      });
    }

    // ===== GET ATTENDANCE FOR THE DAY WITH WAGE CALCULATION =====
    const attendances = await getAttendanceForDate(
      projectId,
      date,
      req.user.companyId
    );

    // Calculate labor summary with wage breakdown
    const laborSummary = calculateLaborSummary(attendances);

    // ===== Process material consumption =====
    const processedMaterials = [];
    let totalMaterialsCost = 0;

    for (const material of materialsConsumed) {
      if (material.materialId && material.quantity) {
        try {
          const consumption = await consumeMaterialFromDPRLogic({
            dprId: null, // Will be set after DPR creation
            materialId: material.materialId,
            quantity: material.quantity,
            unit: material.unit,
            remarks: material.remarks || 'Consumed in DPR',
            userId: req.user.userId,
            projectId,
          });
          processedMaterials.push(consumption);
          totalMaterialsCost += consumption.totalCost || 0;
        } catch (error) {
          console.error('Error consuming material:', error);
          // Continue with other materials, don't fail the whole DPR
        }
      }
    }

    // ===== Calculate equipment costs =====
    const equipmentCost = equipmentUsage.reduce((sum, eq) => {
      const hours = eq.hours || 0;
      const rate = eq.rate || 0;
      eq.cost = hours * rate;
      return sum + eq.cost;
    }, 0);

    // ===== Calculate total budget used =====
    const budgetUsed = {
      materials: totalMaterialsCost,
      labor: laborSummary.totalPayable,
      equipment: equipmentCost,
      total: totalMaterialsCost + laborSummary.totalPayable + equipmentCost,
    };

    // Generate DPR report number
    const reportNo = await generateDPRReportNo(req.user.companyId);

    // Create DPR with all fields including attendance summary
    const dpr = await prisma.dailyProgressReport.create({
      data: {
        reportNo,
        projectId,
        preparedById: req.user.userId,
        date: new Date(date),
        weather,
        temperature,
        humidity,
        workDescription,
        completedWork,
        pendingWork,
        challenges,
        totalWorkers: totalWorkers
          ? parseInt(totalWorkers)
          : laborSummary.totalAttendances,
        supervisorPresent:
          supervisorPresent === 'true' || supervisorPresent === true,
        equipmentUsed: equipmentUsed || JSON.stringify(equipmentUsage),
        materialsUsed,
        materialsReceived,
        materialsRequired,
        safetyObservations,
        incidents,
        qualityChecks,
        issuesFound,
        nextDayPlan: nextDayPlanning.description || nextDayPlan,

        // Attendance summary with wage details
        siteVisitors: siteVisitors,
        attendanceSummary: {
          total: laborSummary.totalAttendances,
          workers: laborSummary.totalWorkers,
          staff: laborSummary.totalStaff,
          totalPayable: laborSummary.totalPayable,
          byShift: laborSummary.byShift,
          workers: laborSummary.workers.map((w) => ({
            id: w.id,
            name: w.name,
            type: w.type,
            shift: w.shift.name,
            shiftMultiplier: w.shift.multiplier,
            wageRate: w.wageRate,
            totalPayable: w.totalPayable,
            calculation: w.calculation,
          })),
        },
        attendanceCount: laborSummary.totalAttendances,
        workersPresent: laborSummary.totalWorkers,
        staffPresent: laborSummary.totalStaff,
        laborCost: laborSummary.totalPayable,

        budgetUsed: budgetUsed.total,
        materialsCost: budgetUsed.materials,
        equipmentCost: budgetUsed.equipment,

        equipmentUsage: equipmentUsage,
        subcontractorDetails: subcontractorDetails,

        nextDayWorkers: nextDayPlanning.workers,
        nextDayMaterials: nextDayPlanning.materials,
        nextDayEquipment: nextDayPlanning.equipment,

        status: 'TODO',
      },
    });

    // Link material consumptions to DPR
    if (processedMaterials.length > 0) {
      await prisma.materialConsumption.updateMany({
        where: {
          id: { in: processedMaterials.map((m) => m.id) },
        },
        data: {
          dprId: dpr.id,
        },
      });
    }

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'DPR_CREATED',
        entityType: 'DAILY_PROGRESS_REPORT',
        entityId: dpr.id,
        newData: {
          reportNo: dpr.reportNo,
          projectId,
          date: dpr.date,
          attendanceCount: dpr.attendanceCount,
          laborCost: dpr.laborCost,
          budgetUsed: dpr.budgetUsed,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    // Send notifications
    await sendDPRNotifications(project, dpr, req.user.userId);

    // Fetch complete DPR with all relations for response
    const completeDPR = await prisma.dailyProgressReport.findUnique({
      where: { id: dpr.id },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            projectId: true,
          },
        },
        preparedBy: {
          select: {
            id: true,
            name: true,
            designation: true,
          },
        },
        materialConsumptions: {
          include: {
            material: {
              select: {
                id: true,
                name: true,
                unit: true,
              },
            },
          },
        },
        photos: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'DPR created successfully with attendance and wage data',
      data: completeDPR,
      summary: {
        attendance: {
          total: laborSummary.totalAttendances,
          workers: laborSummary.totalWorkers,
          staff: laborSummary.totalStaff,
          totalPayable: laborSummary.totalPayable,
          byShift: laborSummary.byShift,
        },
        materials: {
          consumed: processedMaterials.length,
          cost: totalMaterialsCost,
        },
        equipment: {
          used: equipmentUsage.length,
          cost: equipmentCost,
        },
        budget: budgetUsed,
      },
    });
  } catch (error) {
    console.error('Create DPR error:', error);

    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'DPR already exists for this project and date',
      });
    }

    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
};

// Get All DPRs
export const getAllDPRs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status,
      projectId,
      startDate,
      endDate,
      preparedById,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check DPR_READ permission
    const hasPermission = await checkDPRPermission(
      req.user.userId,
      req.user.companyId,
      'DPR_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view DPRs',
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
        { reportNo: { contains: search, mode: 'insensitive' } },
        { workDescription: { contains: search, mode: 'insensitive' } },
        { completedWork: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Add status filter
    if (status) {
      where.status = status;
    }

    // Add project filter
    if (projectId) {
      where.projectId = projectId;
    }

    // Add date range filter
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    // Add prepared by filter
    if (preparedById) {
      where.preparedById = preparedById;
    }

    // For non-admin users, apply additional filters
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

      const hasAllDPRsAccess = user.role?.rolePermissions.some(
        (rp) =>
          rp.permission.code === 'VIEW_ALL_DPRS' ||
          rp.permission.code === 'ALL_ACCESS' ||
          rp.permission.code === 'FULL_COMPANY_ACCESS'
      );

      if (!hasAllDPRsAccess) {
        // Get projects where user is assigned
        const userAssignments = await prisma.projectAssignment.findMany({
          where: { userId: req.user.userId },
          select: { projectId: true },
        });

        const assignedProjectIds = userAssignments.map((pa) => pa.projectId);

        // Get DPRs prepared by user
        const preparedDPRsCondition = { preparedById: req.user.userId };

        // Get DPRs from projects where user is assigned
        const projectDPRsCondition = {
          projectId: { in: assignedProjectIds },
        };

        // Combine conditions with OR
        where.AND = [
          {
            OR: [preparedDPRsCondition, projectDPRsCondition],
          },
        ];
      }
    }

    const [dprs, total] = await Promise.all([
      prisma.dailyProgressReport.findMany({
        where,
        include: {
          project: {
            select: {
              id: true,
              name: true,
              projectId: true,
            },
          },
          preparedBy: {
            select: {
              id: true,
              name: true,
              designation: true,
            },
          },
          approvedBy: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              photos: true,
              materialConsumptions: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { date: 'desc' },
      }),
      prisma.dailyProgressReport.count({ where }),
    ]);

    res.json({
      success: true,
      data: dprs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get DPRs error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get DPR by ID (UPDATED with attendance details)
export const getDPRById = async (req, res) => {
  try {
    const { id } = req.params;

    // Check DPR_READ permission
    const hasPermission = await checkDPRPermission(
      req.user.userId,
      req.user.companyId,
      'DPR_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view DPR details',
      });
    }

    const dpr = await prisma.dailyProgressReport.findFirst({
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
            location: true,
          },
        },
        preparedBy: {
          select: {
            id: true,
            name: true,
            designation: true,
            department: true,
            profilePicture: true,
          },
        },
        approvedBy: {
          select: {
            id: true,
            name: true,
            designation: true,
          },
        },
        photos: {
          include: {
            uploadedBy: {
              select: {
                id: true,
                name: true,
                designation: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        materialConsumptions: {
          include: {
            material: {
              select: {
                id: true,
                name: true,
                unit: true,
              },
            },
            consumedBy: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!dpr) {
      return res.status(404).json({
        success: false,
        message: 'DPR not found',
      });
    }

    // Check if user has access to this DPR
    const isDPRPreparer = dpr.preparedById === req.user.userId;

    // For non-admin users, they must be preparer or project member
    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      // Check if user is assigned to the project
      const isProjectMember = await prisma.projectAssignment.findFirst({
        where: {
          projectId: dpr.projectId,
          userId: req.user.userId,
        },
      });

      if (!isDPRPreparer && !isProjectMember) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this DPR',
        });
      }
    }

    // Get full attendance details for the day with wage calculation
    const attendances = await prisma.workerAttendance.findMany({
      where: {
        projectId: dpr.projectId,
        date: dpr.date,
      },
      include: {
        siteStaff: {
          select: {
            id: true,
            name: true,
            designation: true,
            workerId: true,
            dailyWageRate: true,
          },
        },
        subcontractorWorker: {
          include: {
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
      },
      orderBy: {
        checkInTime: 'asc',
      },
    });

    // Group attendance by type and calculate summary
    const attendanceByType = {
      siteStaff: attendances.filter((a) => a.workerType === 'SITE_STAFF'),
      subcontractor: attendances.filter(
        (a) => a.workerType === 'SUBCONTRACTOR'
      ),
    };

    const attendanceSummary = {
      total: attendances.length,
      siteStaff: attendanceByType.siteStaff.length,
      subcontractor: attendanceByType.subcontractor.length,
      totalHours: attendances.reduce((sum, a) => sum + (a.totalHours || 0), 0),
      totalPayable: attendances.reduce(
        (sum, a) => sum + (a.totalPayable || 0),
        0
      ),
      byShift: attendances.reduce((acc, a) => {
        const shift = a.shiftType?.name || 'Regular';
        if (!acc[shift]) {
          acc[shift] = {
            count: 0,
            totalPayable: 0,
            multiplier: a.shiftMultiplier || 1.0,
          };
        }
        acc[shift].count++;
        acc[shift].totalPayable += a.totalPayable || 0;
        return acc;
      }, {}),
      workersList: attendances.map((a) => ({
        id: a.id,
        name: a.siteStaff?.name || a.subcontractorWorker?.name,
        type: a.workerType,
        shift: a.shiftType?.name || 'Regular',
        shiftMultiplier: a.shiftMultiplier || 1.0,
        wageRate: a.wageRate || 0,
        totalPayable: a.totalPayable || 0,
        calculation: `${a.wageRate || 0} × ${a.shiftMultiplier || 1.0} = ${a.totalPayable || 0}`,
        checkIn: a.checkInTime,
        checkOut: a.checkOutTime,
        totalHours: a.totalHours,
      })),
    };

    res.json({
      success: true,
      data: {
        ...dpr,
        attendances: attendanceSummary,
        budget: {
          used: dpr.budgetUsed || 0,
          materials: dpr.materialsCost || 0,
          labor: dpr.laborCost || 0,
          equipment: dpr.equipmentCost || 0,
        },
      },
    });
  } catch (error) {
    console.error('Get DPR error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update DPR (Fixed schema mismatch)
export const updateDPR = async (req, res) => {
  try {
    const { id } = req.params;
    
    // 🚨 FIX: Extract ONLY the valid fields that match your Prisma Schema
    const {
      weather,
      workDescription,
      completedWork,
      pendingWork,
      challenges,
      safetyObservations,
      qualityChecks,
      issuesFound,
      nextDayPlan,
      // You can add other valid schema fields here if needed in the future
    } = req.body;

    // Check DPR_UPDATE permission
    const hasPermission = await checkDPRPermission(
      req.user.userId,
      req.user.companyId,
      'DPR_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update DPRs',
      });
    }

    // Check if DPR exists and belongs to company
    const dpr = await prisma.dailyProgressReport.findFirst({
      where: {
        id,
        project: {
          companyId: req.user.companyId,
        },
      },
    });

    if (!dpr) {
      return res.status(404).json({
        success: false,
        message: 'DPR not found',
      });
    }

    // Check if user can update this DPR
    const isDPRPreparer = dpr.preparedById === req.user.userId;

    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      if (!isDPRPreparer) {
        return res.status(403).json({
          success: false,
          message: 'You can only update DPRs you prepared',
        });
      }
    }

    // Check if DPR is already approved
    if (dpr.status === 'COMPLETED' && dpr.approvedById) {
      return res.status(400).json({
        success: false,
        message: 'Cannot update an approved DPR',
      });
    }

    // 🚨 Build the safe update object
    const validUpdates = {
      weather,
      workDescription,
      completedWork,
      pendingWork,
      challenges,
      safetyObservations,
      qualityChecks,
      issuesFound,
      nextDayPlan,
    };

    // Remove any undefined/null values so we don't accidentally overwrite existing data with null
    Object.keys(validUpdates).forEach(key => {
      if (validUpdates[key] === undefined) {
        delete validUpdates[key];
      }
    });

    // Final Prisma Update using ONLY the safe, valid fields
    const updatedDPR = await prisma.dailyProgressReport.update({
      where: { id },
      data: validUpdates,
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'DPR_UPDATED',
        entityType: 'DAILY_PROGRESS_REPORT',
        entityId: id,
        oldData: dpr,
        newData: updatedDPR,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'DPR updated successfully',
      data: updatedDPR,
    });
  } catch (error) {
    console.error('Update DPR error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Delete DPR
export const deleteDPR = async (req, res) => {
  try {
    const { id } = req.params;

    // Check DPR_DELETE permission
    const hasPermission = await checkDPRPermission(
      req.user.userId,
      req.user.companyId,
      'DPR_DELETE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete DPRs',
      });
    }

    // Check if DPR exists and belongs to company
    const dpr = await prisma.dailyProgressReport.findFirst({
      where: {
        id,
        project: {
          companyId: req.user.companyId,
        },
      },
      include: {
        _count: {
          select: {
            photos: true,
            materialConsumptions: true,
          },
        },
      },
    });

    if (!dpr) {
      return res.status(404).json({
        success: false,
        message: 'DPR not found',
      });
    }

    // Check if user can delete this DPR
    // Only DPR preparer or admin can delete
    const isDPRPreparer = dpr.preparedById === req.user.userId;

    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      if (!isDPRPreparer) {
        return res.status(403).json({
          success: false,
          message: 'You can only delete DPRs you prepared',
        });
      }
    }

    // Start transaction to delete related records
    await prisma.$transaction(async (tx) => {
      // Delete DPR photos
      await tx.dPRPhoto.deleteMany({
        where: { dprId: id },
      });

      // Delete material consumptions (but don't revert stock - handled by inventory system)
      await tx.materialConsumption.deleteMany({
        where: { dprId: id },
      });

      // Delete DPR
      await tx.dailyProgressReport.delete({
        where: { id },
      });
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'DPR_DELETED',
        entityType: 'DAILY_PROGRESS_REPORT',
        entityId: id,
        oldData: dpr,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'DPR deleted successfully',
    });
  } catch (error) {
    console.error('Delete DPR error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Approve DPR
export const approveDPR = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, comments } = req.body;

    // Check DPR_APPROVE permission
    const hasPermission = await checkDPRPermission(
      req.user.userId,
      req.user.companyId,
      'DPR_APPROVE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to approve DPRs',
      });
    }

    // Check if DPR exists and belongs to company
    const dpr = await prisma.dailyProgressReport.findFirst({
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
            createdById: true,
          },
        },
        preparedBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!dpr) {
      return res.status(404).json({
        success: false,
        message: 'DPR not found',
      });
    }

    // Check if DPR can be approved
    if (dpr.status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        message: 'DPR is already approved',
      });
    }

    // Update DPR status
    const updateData = {
      status: status || 'COMPLETED',
      approvedById: req.user.userId,
      approvedAt: new Date(),
    };

    const updatedDPR = await prisma.dailyProgressReport.update({
      where: { id },
      data: updateData,
    });

    // ===== UPDATE PROJECT PROGRESS BASED ON COMPLETED TASKS =====
    // Get total tasks in the project
    const totalTasks = await prisma.task.count({
      where: {
        projectId: dpr.projectId,
      },
    });

    if (totalTasks > 0) {
      // Get completed tasks in the project
      const completedTasks = await prisma.task.count({
        where: {
          projectId: dpr.projectId,
          status: 'COMPLETED',
        },
      });

      // Calculate progress percentage (completed tasks / total tasks * 100)
      const progressPercentage = Math.round(
        (completedTasks / totalTasks) * 100
      );

      // Update project progress
      await prisma.project.update({
        where: { id: dpr.projectId },
        data: {
          progress: progressPercentage,
        },
      });

      // Log progress update
      await prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          companyId: req.user.companyId,
          action: 'PROJECT_PROGRESS_UPDATED',
          entityType: 'PROJECT',
          entityId: dpr.projectId,
          newData: {
            progress: progressPercentage,
            totalTasks,
            completedTasks,
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });
    }

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'DPR_APPROVED',
        entityType: 'DAILY_PROGRESS_REPORT',
        entityId: id,
        oldData: { status: dpr.status },
        newData: { status: updatedDPR.status },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    // Send notification to DPR preparer
    await prisma.notification.create({
      data: {
        userId: dpr.preparedById,
        title: 'DPR Approved',
        message: `DPR ${dpr.reportNo} has been ${status === 'REVIEW' ? 'sent for review' : 'approved'}`,
        type: 'DPR',
        relatedId: id,
      },
    });

    res.json({
      success: true,
      message: `DPR ${status === 'REVIEW' ? 'sent for review' : 'approved'} successfully`,
      data: updatedDPR,
    });
  } catch (error) {
    console.error('Approve DPR error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get DPR Statistics (UPDATED with budget and attendance)
export const getDPRStatistics = async (req, res) => {
  try {
    const { projectId, startDate, endDate } = req.query;

    // Check DPR_READ permission
    const hasPermission = await checkDPRPermission(
      req.user.userId,
      req.user.companyId,
      'DPR_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view DPR statistics',
      });
    }

    const where = {
      project: {
        companyId: req.user.companyId,
      },
    };

    // Add project filter
    if (projectId) {
      where.projectId = projectId;
    }

    // Add date range filter (last 30 days if not specified)
    const defaultStartDate = new Date();
    defaultStartDate.setDate(defaultStartDate.getDate() - 30);

    where.date = {
      gte: startDate ? new Date(startDate) : defaultStartDate,
    };

    if (endDate) {
      where.date.lte = new Date(endDate);
    }

    const [
      dprsByStatus,
      totalDPRs,
      photosCount,
      recentDPRs,
      budgetStats,
      attendanceStats,
    ] = await Promise.all([
      // DPRs grouped by status
      prisma.dailyProgressReport.groupBy({
        by: ['status'],
        where,
        _count: true,
      }),

      // Total DPRs
      prisma.dailyProgressReport.count({ where }),

      // Total photos uploaded
      prisma.dPRPhoto.count({
        where: {
          dpr: {
            project: {
              companyId: req.user.companyId,
            },
          },
        },
      }),

      // Recent DPRs (last 7)
      prisma.dailyProgressReport.findMany({
        where,
        include: {
          project: {
            select: {
              id: true,
              name: true,
            },
          },
          preparedBy: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              photos: true,
              materialConsumptions: true,
            },
          },
        },
        take: 7,
        orderBy: { date: 'desc' },
      }),

      // ===== NEW: Budget statistics =====
      prisma.dailyProgressReport.aggregate({
        where,
        _sum: {
          budgetUsed: true,
          materialsCost: true,
          laborCost: true,
          equipmentCost: true,
        },
        _avg: {
          budgetUsed: true,
        },
      }),

      // ===== NEW: Attendance statistics across DPRs =====
      prisma.dailyProgressReport.aggregate({
        where,
        _sum: {
          attendanceCount: true,
          workersPresent: true,
          staffPresent: true,
        },
        _avg: {
          attendanceCount: true,
        },
      }),
    ]);

    const statistics = {
      byStatus: dprsByStatus.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {}),
      total: totalDPRs,
      photosCount,
      recentDPRs,
      summary: {
        approved:
          dprsByStatus.find((item) => item.status === 'COMPLETED')?._count || 0,
        pending:
          dprsByStatus.find((item) => item.status === 'TODO')?._count || 0,
        inReview:
          dprsByStatus.find((item) => item.status === 'REVIEW')?._count || 0,
        inProgress:
          dprsByStatus.find((item) => item.status === 'IN_PROGRESS')?._count ||
          0,
      },
      // ===== NEW: Budget summary =====
      budget: {
        totalUsed: budgetStats._sum.budgetUsed || 0,
        materials: budgetStats._sum.materialsCost || 0,
        labor: budgetStats._sum.laborCost || 0,
        equipment: budgetStats._sum.equipmentCost || 0,
        averagePerDPR: budgetStats._avg.budgetUsed || 0,
      },
      // ===== NEW: Attendance summary =====
      attendance: {
        totalWorkers: attendanceStats._sum.attendanceCount || 0,
        siteStaff: attendanceStats._sum.staffPresent || 0,
        subcontractorWorkers: attendanceStats._sum.workersPresent || 0,
        averagePerDPR: attendanceStats._avg.attendanceCount || 0,
      },
    };

    res.json({
      success: true,
      data: statistics,
    });
  } catch (error) {
    console.error('Get DPR statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get DPRs by Project (UPDATED with budget summary)
export const getDPRsByProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { page = 1, limit = 10, status, startDate, endDate } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check DPR_READ permission
    const hasPermission = await checkDPRPermission(
      req.user.userId,
      req.user.companyId,
      'DPR_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view DPRs',
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
          projectId,
          userId: req.user.userId,
        },
      });

      if (!isProjectCreator && !isAssigned) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this project',
        });
      }
    }

    const where = {
      projectId,
    };

    // Add status filter
    if (status) {
      where.status = status;
    }

    // Add date range filter
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const [dprs, total, budgetSummary] = await Promise.all([
      prisma.dailyProgressReport.findMany({
        where,
        include: {
          preparedBy: {
            select: {
              id: true,
              name: true,
              designation: true,
            },
          },
          approvedBy: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              photos: true,
              materialConsumptions: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { date: 'desc' },
      }),
      prisma.dailyProgressReport.count({ where }),

      // ===== NEW: Budget summary for project =====
      prisma.dailyProgressReport.aggregate({
        where,
        _sum: {
          budgetUsed: true,
          materialsCost: true,
          laborCost: true,
          equipmentCost: true,
          attendanceCount: true,
        },
      }),
    ]);

    // Calculate progress metrics
    const approvedDPRs = dprs.filter(
      (dpr) => dpr.status === 'COMPLETED'
    ).length;
    const completionRate = total > 0 ? (approvedDPRs / total) * 100 : 0;

    const projectStats = {
      totalDPRs: total,
      approvedDPRs,
      pendingDPRs: total - approvedDPRs,
      completionRate: Math.round(completionRate * 100) / 100,
      totalPhotos: dprs.reduce((sum, dpr) => sum + dpr._count.photos, 0),
      // ===== NEW: Budget stats =====
      totalBudgetUsed: budgetSummary._sum.budgetUsed || 0,
      totalMaterialsCost: budgetSummary._sum.materialsCost || 0,
      totalLaborCost: budgetSummary._sum.laborCost || 0,
      totalEquipmentCost: budgetSummary._sum.equipmentCost || 0,
      totalAttendance: budgetSummary._sum.attendanceCount || 0,
    };

    res.json({
      success: true,
      data: {
        project: {
          id: project.id,
          name: project.name,
        },
        dprs,
        stats: projectStats,
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get DPRs by project error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Add material consumption to DPR
export const addMaterialConsumption = async (req, res) => {
  try {
    const { dprId } = req.params;
    const { materialId, quantity, unit, remarks } = req.body;

    // Check MATERIAL_CONSUME permission
    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'MATERIAL_CONSUME'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to consume materials',
      });
    }

    // Get DPR
    const dpr = await prisma.dailyProgressReport.findFirst({
      where: {
        id: dprId,
        project: {
          companyId: req.user.companyId,
        },
      },
      include: {
        project: true,
      },
    });

    if (!dpr) {
      return res.status(404).json({
        success: false,
        message: 'DPR not found',
      });
    }

    // Get material
    const material = await prisma.material.findFirst({
      where: {
        id: materialId,
        companyId: req.user.companyId,
      },
    });

    if (!material) {
      return res.status(404).json({
        success: false,
        message: 'Material not found',
      });
    }

    // Check stock availability
    const availableStock = material.stockQuantity || 0;
    const consumptionQuantity = parseFloat(quantity);

    if (consumptionQuantity > availableStock) {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock. Available: ${availableStock} ${material.unit}, Requested: ${consumptionQuantity} ${material.unit}`,
      });
    }

    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      // Reduce material stock
      const newStock = availableStock - consumptionQuantity;
      await tx.material.update({
        where: { id: materialId },
        data: {
          stockQuantity: newStock,
        },
      });

      // Create stock transaction record
      await tx.stockTransaction.create({
        data: {
          materialId,
          transactionType: 'CONSUMPTION',
          quantity: consumptionQuantity,
          previousStock: availableStock,
          newStock,
          referenceId: dprId,
          referenceType: 'DPR',
          notes: `Consumed in DPR: ${dpr.reportNo}`,
          createdById: req.user.userId,
        },
      });

      // Create material consumption record
      const consumption = await tx.materialConsumption.create({
        data: {
          dprId,
          materialId,
          quantity: consumptionQuantity,
          unit: unit || material.unit,
          remarks,
          consumedById: req.user.userId,
        },
      });

      // Check for stock alerts after consumption
      const minimumStock = material.minimumStock || 10;
      if (newStock <= minimumStock) {
        const alertType = newStock <= 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK';
        const message =
          newStock <= 0
            ? `${material.name} is out of stock after consumption in DPR ${dpr.reportNo}`
            : `${material.name} stock is low (${newStock} ${material.unit}) after consumption in DPR ${dpr.reportNo}`;

        await tx.stockAlert.create({
          data: {
            materialId,
            alertType,
            currentStock: newStock,
            threshold: minimumStock,
            message,
            isResolved: false,
            isNotified: false,
          },
        });
      }

      // ===== NEW: Update DPR materials cost and budget =====
      const materialCost = consumptionQuantity * (material.unitPrice || 0);
      await tx.dailyProgressReport.update({
        where: { id: dprId },
        data: {
          materialsCost: { increment: materialCost },
          budgetUsed: { increment: materialCost },
        },
      });

      return consumption;
    });

    res.status(201).json({
      success: true,
      message: 'Material consumption recorded successfully',
      data: result,
    });
  } catch (error) {
    console.error('Add material consumption error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get DPR material consumptions
export const getDPRMaterialConsumptions = async (req, res) => {
  try {
    const { dprId } = req.params;

    // Check DPR_READ permission
    const hasPermission = await checkDPRPermission(
      req.user.userId,
      req.user.companyId,
      'DPR_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view DPR material consumptions',
      });
    }

    const consumptions = await prisma.materialConsumption.findMany({
      where: {
        dprId,
        dpr: {
          project: {
            companyId: req.user.companyId,
          },
        },
      },
      include: {
        material: {
          select: {
            id: true,
            name: true,
            unit: true,
            stockQuantity: true,
          },
        },
        consumedBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Calculate totals
    const totalQuantity = consumptions.reduce((sum, c) => sum + c.quantity, 0);
    const totalCost = consumptions.reduce(
      (sum, c) => sum + (c.totalCost || 0),
      0
    );
    const uniqueMaterials = [...new Set(consumptions.map((c) => c.materialId))]
      .length;

    res.json({
      success: true,
      data: {
        consumptions,
        summary: {
          totalItems: consumptions.length,
          totalQuantity,
          totalCost,
          uniqueMaterials,
        },
      },
    });
  } catch (error) {
    console.error('Get DPR material consumptions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Material Consumption by DPR
export const getMaterialConsumptionByDPR = async (req, res) => {
  try {
    const { dprId } = req.params;

    // Check DPR_READ permission
    const dpr = await prisma.dailyProgressReport.findFirst({
      where: {
        id: dprId,
        project: {
          companyId: req.user.companyId,
        },
      },
    });

    if (!dpr) {
      return res.status(404).json({
        success: false,
        message: 'DPR not found',
      });
    }

    const consumptions = await prisma.materialConsumption.findMany({
      where: {
        dprId,
      },
      include: {
        material: {
          select: {
            id: true,
            name: true,
            unit: true,
            stockQuantity: true,
          },
        },
        consumedBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { consumedAt: 'desc' },
    });

    // Calculate totals
    const totalQuantity = consumptions.reduce((sum, c) => sum + c.quantity, 0);
    const totalCost = consumptions.reduce(
      (sum, c) => sum + (c.totalCost || 0),
      0
    );
    const uniqueMaterials = [...new Set(consumptions.map((c) => c.materialId))]
      .length;

    res.json({
      success: true,
      data: {
        dpr: {
          id: dpr.id,
          reportNo: dpr.reportNo,
          date: dpr.date,
          projectId: dpr.projectId,
        },
        consumptions,
        summary: {
          totalItems: consumptions.length,
          totalQuantity,
          totalCost,
          uniqueMaterials,
        },
      },
    });
  } catch (error) {
    console.error('Get material consumption by DPR error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Consume Material from DPR (Integrate with DPR)
export const consumeMaterialFromDPR = async (req, res) => {
  try {
    const { dprId, materialId, quantity, unit, remarks } = req.body;

    // Check MATERIAL_CONSUME permission
    const hasPermission = await checkMaterialPermission(
      req.user.userId,
      req.user.companyId,
      'MATERIAL_CONSUME'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to consume materials',
      });
    }

    // Get DPR
    const dpr = await prisma.dailyProgressReport.findFirst({
      where: {
        id: dprId,
        project: {
          companyId: req.user.companyId,
        },
      },
      include: {
        project: true,
      },
    });

    if (!dpr) {
      return res.status(404).json({
        success: false,
        message: 'DPR not found',
      });
    }

    // Get material
    const material = await prisma.material.findFirst({
      where: {
        id: materialId,
        companyId: req.user.companyId,
      },
    });

    if (!material) {
      return res.status(404).json({
        success: false,
        message: 'Material not found',
      });
    }

    // Check stock availability
    const availableStock = material.stockQuantity || 0;
    const consumptionQuantity = parseFloat(quantity);

    if (consumptionQuantity > availableStock) {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock. Available: ${availableStock} ${material.unit}, Requested: ${consumptionQuantity} ${material.unit}`,
        suggestion: 'Create a material request to replenish stock',
      });
    }

    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      // Reduce material stock
      const newStock = availableStock - consumptionQuantity;
      await tx.material.update({
        where: { id: materialId },
        data: {
          stockQuantity: newStock,
        },
      });

      // Calculate material cost
      const materialCost = consumptionQuantity * (material.unitPrice || 0);

      // Create stock transaction record
      await tx.stockTransaction.create({
        data: {
          materialId,
          transactionType: 'CONSUMPTION',
          quantity: consumptionQuantity,
          previousStock: availableStock,
          newStock,
          referenceId: dprId,
          referenceType: 'DPR',
          notes: `Consumed in DPR: ${dpr.reportNo} - ${remarks || ''}`,
          createdById: req.user.userId,
          projectId: dpr.projectId,
        },
      });

      // Create material consumption record
      const consumption = await tx.materialConsumption.create({
        data: {
          dprId,
          materialId,
          quantity: consumptionQuantity,
          unit: unit || material.unit,
          remarks,
          consumedById: req.user.userId,
          totalCost: materialCost,
        },
      });

      // Check for stock alerts after consumption
      const minimumStock = material.minimumStock || 10;
      if (newStock <= minimumStock) {
        const alertType = newStock <= 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK';
        const message =
          newStock <= 0
            ? `${material.name} is out of stock after consumption in DPR ${dpr.reportNo}`
            : `${material.name} stock is low (${newStock} ${material.unit}) after consumption in DPR ${dpr.reportNo}`;

        await tx.stockAlert.create({
          data: {
            materialId,
            alertType,
            currentStock: newStock,
            threshold: minimumStock,
            message,
            isResolved: false,
            isNotified: false,
          },
        });
      }

      // ===== NEW: Update DPR budget =====
      await tx.dailyProgressReport.update({
        where: { id: dprId },
        data: {
          materialsCost: { increment: materialCost },
          budgetUsed: { increment: materialCost },
        },
      });

      return consumption;
    });

    // Update DPR materialsUsed field
    await prisma.dailyProgressReport.update({
      where: { id: dprId },
      data: {
        materialsUsed: `${dpr.materialsUsed ? dpr.materialsUsed + ', ' : ''}${material.name}: ${quantity} ${unit || material.unit}`,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Material consumed successfully and stock updated',
      data: result,
      stockUpdate: {
        materialId,
        materialName: material.name,
        previousStock: availableStock,
        newStock: availableStock - consumptionQuantity,
        consumed: consumptionQuantity,
        unit: material.unit,
      },
    });
  } catch (error) {
    console.error('Consume material from DPR error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
