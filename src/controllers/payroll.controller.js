// src/controllers/payroll.controller.js
import prisma from '../config/database.js';
import { recalculateBudgetSummary } from '../services/budget.service.js';

// Helper functions (same as above)
const checkPermission = async (userId, companyId, permissionCode) => {
  if (!userId) return false;
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
  return user.role?.rolePermissions.some(
    (rp) =>
      rp.permission.code === permissionCode ||
      rp.permission.code === 'ALL_ACCESS' ||
      rp.permission.code === 'FULL_COMPANY_ACCESS'
  );
};

const getUserIdFromRequest = (req) =>
  req.user?.userId ||
  req.headers['x-user-id'] ||
  req.query.userId ||
  req.body.userId;
const getCompanyIdFromRequest = (req) =>
  req.user?.companyId ||
  req.headers['x-company-id'] ||
  req.query.companyId ||
  req.body.companyId;

// Generate Payroll Number
const generatePayrollNo = async (companyId) => {
  const year = new Date().getFullYear();
  const month = (new Date().getMonth() + 1).toString().padStart(2, '0');

  const latestPayroll = await prisma.payroll.findFirst({
    where: {
      companyId,
      payrollNo: {
        startsWith: `PY${year}${month}`,
      },
    },
    orderBy: { payrollNo: 'desc' },
  });

  let serial = 1;
  if (latestPayroll) {
    const lastSerial = parseInt(latestPayroll.payrollNo.slice(-4)) || 0;
    serial = lastSerial + 1;
  }

  return `PY${year}${month}${serial.toString().padStart(4, '0')}`;
};

// Calculate Payroll for a period - Updated for daily-based calculation
export const calculatePayroll = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { periodFrom, periodTo, projectId, workerType } = req.body;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const hasPermission = await checkPermission(
      userId,
      companyId,
      'PAYROLL_CALCULATE'
    );
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to calculate payroll.',
      });
    }

    if (!periodFrom || !periodTo) {
      return res.status(400).json({
        success: false,
        message: 'Period from and to dates are required',
      });
    }

    const startDate = new Date(periodFrom);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(periodTo);
    endDate.setHours(23, 59, 59, 999);

    // Build attendance query
    const attendanceWhere = {
      project: { companyId },
      date: {
        gte: startDate,
        lte: endDate,
      },
      status: 'PRESENT',
      checkInTime: { not: null },
      checkOutTime: { not: null },
    };

    if (projectId) {
      attendanceWhere.projectId = projectId;
    }

    if (workerType) {
      attendanceWhere.workerType = workerType;
    }

    // Get all attendance records for the period with shift type included
    const attendances = await prisma.workerAttendance.findMany({
      where: attendanceWhere,
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
            workerId: true,
            contractor: {
              select: { name: true },
            },
          },
        },
        shiftType: true,
        project: {
          select: { id: true, name: true },
        },
      },
      orderBy: [{ workerType: 'asc' }, { date: 'asc' }],
    });

    // Group attendances by worker
    const workerGroups = {};

    for (const attendance of attendances) {
      const key = `${attendance.workerType}_${attendance.workerType === 'SITE_STAFF' ? attendance.siteStaffId : attendance.subcontractorWorkerId}`;

      if (!workerGroups[key]) {
        const worker =
          attendance.workerType === 'SITE_STAFF'
            ? attendance.siteStaff
            : attendance.subcontractorWorker;

        workerGroups[key] = {
          workerType: attendance.workerType,
          workerId:
            attendance.workerType === 'SITE_STAFF'
              ? attendance.siteStaffId
              : attendance.subcontractorWorkerId,
          workerName: worker?.name || 'Unknown',
          workerCode: worker?.workerId || '',
          designation:
            attendance.workerType === 'SITE_STAFF'
              ? worker?.designation
              : 'Subcontractor Worker',
          attendances: [],
          totalDays: 0,
          actualDays: 0,
          baseRate: 0,
          grossAmount: 0,
          shiftTypes: {},
          dailyBreakdown: [], // Daily breakdown for detailed calculation
        };
      }

      workerGroups[key].attendances.push(attendance);

      // Calculate days based on shift multiplier
      const multiplier = attendance.shiftMultiplier || 1.0;
      workerGroups[key].totalDays += multiplier;
      workerGroups[key].actualDays += 1;

      // Track shift types
      const shiftName = attendance.shiftType?.name || 'Regular';
      if (!workerGroups[key].shiftTypes[shiftName]) {
        workerGroups[key].shiftTypes[shiftName] = {
          count: 0,
          days: 0,
          amount: 0,
        };
      }
      workerGroups[key].shiftTypes[shiftName].count += 1;
      workerGroups[key].shiftTypes[shiftName].days += multiplier;

      // Get the base rate (use attendance's wageRate)
      if (workerGroups[key].baseRate === 0) {
        workerGroups[key].baseRate = attendance.wageRate || 0;
      }
    }

    // Calculate gross amounts using shift multiplier and create daily breakdown
    for (const key in workerGroups) {
      const worker = workerGroups[key];

      let totalGrossAmount = 0;
      worker.dailyBreakdown = [];

      for (const attendance of worker.attendances) {
        const multiplier = attendance.shiftMultiplier || 1.0;
        const rate = attendance.wageRate || worker.baseRate;
        const dailyAmount = rate * multiplier;
        totalGrossAmount += dailyAmount;

        // Add to daily breakdown
        worker.dailyBreakdown.push({
          date: attendance.date,
          shiftType: attendance.shiftType?.name || 'Regular',
          shiftMultiplier: multiplier,
          wageRate: rate,
          amount: dailyAmount,
          checkInTime: attendance.checkInTime,
          checkOutTime: attendance.checkOutTime,
          totalHours: attendance.totalHours,
          projectId: attendance.projectId,
          projectName: attendance.project?.name || 'Unknown',
        });

        // Track amount by shift type
        const shiftName = attendance.shiftType?.name || 'Regular';
        if (worker.shiftTypes[shiftName]) {
          worker.shiftTypes[shiftName].amount += dailyAmount;
        }
      }

      worker.grossAmount = totalGrossAmount;
    }

    const summary = {
      periodFrom: startDate,
      periodTo: endDate,
      totalWorkers: Object.keys(workerGroups).length,
      totalAttendance: attendances.length,
      totalDays: Object.values(workerGroups).reduce(
        (sum, w) => sum + w.totalDays,
        0
      ),
      totalAmount: Object.values(workerGroups).reduce(
        (sum, w) => sum + w.grossAmount,
        0
      ),
      workers: Object.values(workerGroups).map((w) => ({
        ...w,
        attendances: undefined, // Remove raw attendances to keep response manageable
      })),
    };

    res.json({
      success: true,
      message: 'Payroll calculated successfully',
      data: summary,
    });
  } catch (error) {
    console.error('Calculate payroll error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate payroll',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Create Payroll from calculation - Updated with shift multiplier and daily breakdown
export const createPayroll = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const {
      periodFrom,
      periodTo,
      workers,
      notes,
      periodType = 'CUSTOM',
    } = req.body;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const hasPermission = await checkPermission(
      userId,
      companyId,
      'PAYROLL_CREATE'
    );
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create payroll.',
      });
    }

    if (!periodFrom || !periodTo || !workers || !Array.isArray(workers)) {
      return res.status(400).json({
        success: false,
        message: 'Period from, period to, and workers array are required',
      });
    }

    const startDate = new Date(periodFrom);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(periodTo);
    endDate.setHours(23, 59, 59, 999);

    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      // Generate payroll number
      const payrollNo = await generatePayrollNo(companyId);

      // Calculate totals
      const totalWorkers = workers.length;
      const totalDays = workers.reduce((sum, w) => sum + w.totalDays, 0);
      const totalAmount = workers.reduce((sum, w) => sum + w.grossAmount, 0);

      // Create payroll
      const payroll = await tx.payroll.create({
        data: {
          payrollNo,
          companyId,
          periodFrom: startDate,
          periodTo: endDate,
          periodType,
          status: 'PENDING',
          totalWorkers,
          totalDays,
          totalAmount,
          netAmount: totalAmount,
          notes,
          createdById: userId,
        },
      });

      // Create payroll items for each worker
      const payrollItems = [];

      for (const worker of workers) {
        // Get attendance IDs for this worker in the period
        const attendanceWhere = {
          project: { companyId },
          date: { gte: startDate, lte: endDate },
          status: 'PRESENT',
          ...(worker.workerType === 'SITE_STAFF'
            ? { siteStaffId: worker.workerId }
            : { subcontractorWorkerId: worker.workerId }),
        };

        const attendances = await tx.workerAttendance.findMany({
          where: attendanceWhere,
          select: {
            id: true,
            shiftTypeId: true,
            shiftMultiplier: true,
            wageRate: true,
            totalPayable: true,
            date: true,
          },
        });

        const attendanceIds = attendances.map((a) => a.id);

        // Get current labour rate
        const labourRate = await tx.labourRate.findFirst({
          where: {
            companyId,
            workerType: worker.workerType,
            ...(worker.workerType === 'SITE_STAFF'
              ? { siteStaffId: worker.workerId }
              : { subcontractorWorkerId: worker.workerId }),
            isCurrent: true,
          },
        });

        // Create enhanced attendance summary with daily breakdown and shift details
        const attendanceSummary = {
          totalDays: worker.totalDays,
          actualDays: worker.actualDays,
          shiftTypes: worker.shiftTypes || {},
          dailyBreakdown: worker.dailyBreakdown || [], // Include daily breakdown
          calculationMethod: 'Daily Rate × Shift Multiplier',
        };

        // Determine shift type and multiplier for the payroll item
        // Use the most common shift type or first attendance's shift type
        const firstAttendance = attendances[0];
        const mostCommonShiftType = Object.keys(worker.shiftTypes || {}).reduce(
          (a, b) =>
            worker.shiftTypes[a]?.count > worker.shiftTypes[b]?.count ? a : b,
          'Regular'
        );
        const shiftType = await tx.shiftType.findFirst({
          where: {
            companyId,
            name:
              mostCommonShiftType !== 'Regular'
                ? mostCommonShiftType
                : undefined,
          },
        });

        const payrollItem = await tx.payrollItem.create({
          data: {
            payrollId: payroll.id,
            workerType: worker.workerType,
            siteStaffId:
              worker.workerType === 'SITE_STAFF' ? worker.workerId : null,
            subcontractorWorkerId:
              worker.workerType === 'SUBCONTRACTOR' ? worker.workerId : null,
            workerName: worker.workerName,
            workerId: worker.workerCode,
            designation: worker.designation,
            labourRateId: labourRate?.id,
            baseRate: worker.baseRate,
            totalDays: worker.totalDays,
            actualDays: worker.actualDays,
            shiftTypeId: shiftType?.id || null,
            shiftMultiplier: firstAttendance?.shiftMultiplier || 1.0,
            attendanceSummary: attendanceSummary,
            attendanceIds: attendanceIds,
            grossAmount: worker.grossAmount,
            deductions: worker.deductions || 0,
            bonus: worker.bonus || 0,
            netAmount:
              worker.grossAmount -
              (worker.deductions || 0) +
              (worker.bonus || 0),
            deductionDetails: worker.deductionDetails,
            bonusDetails: worker.bonusDetails,
            notes: worker.notes,
          },
        });

        payrollItems.push(payrollItem);
      }

      // Update payroll with actual items count
      const updatedPayroll = await tx.payroll.update({
        where: { id: payroll.id },
        data: {
          totalWorkers: payrollItems.length,
        },
        include: {
          items: true,
        },
      });

      return updatedPayroll;
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId,
        companyId,
        action: 'PAYROLL_CREATED',
        entityType: 'PAYROLL',
        entityId: result.id,
        newData: {
          payrollNo: result.payrollNo,
          periodFrom: result.periodFrom,
          periodTo: result.periodTo,
          totalWorkers: result.totalWorkers,
          totalAmount: result.totalAmount,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message: 'Payroll created successfully',
      data: result,
    });
  } catch (error) {
    console.error('Create payroll error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payroll',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Get All Payrolls
export const getAllPayrolls = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const hasPermission = await checkPermission(
      userId,
      companyId,
      'PAYROLL_READ'
    );
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view payrolls.',
      });
    }

    const {
      page = 1,
      limit = 10,
      status,
      fromDate,
      toDate,
      search = '',
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      companyId,
      ...(status && { status }),
      ...(fromDate &&
        toDate && {
          periodFrom: { gte: new Date(fromDate) },
          periodTo: { lte: new Date(toDate) },
        }),
      ...(search && {
        OR: [
          { payrollNo: { contains: search, mode: 'insensitive' } },
          { notes: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [payrolls, total] = await Promise.all([
      prisma.payroll.findMany({
        where,
        include: {
          createdBy: {
            select: { id: true, name: true },
          },
          processedBy: {
            select: { id: true, name: true },
          },
          approvedBy: {
            select: { id: true, name: true },
          },
          _count: {
            select: { items: true },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.payroll.count({ where }),
    ]);

    res.json({
      success: true,
      data: payrolls,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get payrolls error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Payroll by ID - Updated with shift type and daily breakdown
export const getPayrollById = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { id } = req.params;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const hasPermission = await checkPermission(
      userId,
      companyId,
      'PAYROLL_READ'
    );
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view payrolls.',
      });
    }

    const payroll = await prisma.payroll.findFirst({
      where: {
        id,
        companyId,
      },
      include: {
        items: {
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
                workerId: true,
                contractor: {
                  select: { name: true },
                },
              },
            },
            labourRate: true,
            shiftType: {
              select: {
                id: true,
                name: true,
                multiplier: true,
                description: true,
              },
            },
          },
        },
        createdBy: {
          select: { id: true, name: true },
        },
        processedBy: {
          select: { id: true, name: true },
        },
        approvedBy: {
          select: { id: true, name: true },
        },
        paidBy: {
          select: { id: true, name: true },
        },
      },
    });

    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Payroll not found',
      });
    }

    // Calculate shift type summary
    const shiftTypeSummary = {};
    payroll.items.forEach((item) => {
      const attendanceSummary = item.attendanceSummary;
      if (attendanceSummary?.shiftTypes) {
        Object.entries(attendanceSummary.shiftTypes).forEach(
          ([shiftName, data]) => {
            if (!shiftTypeSummary[shiftName]) {
              shiftTypeSummary[shiftName] = {
                count: 0,
                days: 0,
                amount: 0,
              };
            }
            shiftTypeSummary[shiftName].count += data.count;
            shiftTypeSummary[shiftName].days += data.days;
            shiftTypeSummary[shiftName].amount += data.amount;
          }
        );
      }
    });

    res.json({
      success: true,
      data: {
        ...payroll,
        shiftTypeSummary,
        calculationSummary: {
          method: 'Daily Rate × Shift Multiplier',
          description:
            'Each day is calculated as: Base Daily Rate × Shift Multiplier',
        },
      },
    });
  } catch (error) {
    console.error('Get payroll error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update Payroll Status
export const updatePayrollStatus = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { id } = req.params;
    const { status, notes, paymentMethod, paymentReference } = req.body;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    // Check specific permissions based on status
    let permissionCode = 'PAYROLL_UPDATE';
    if (status === 'PROCESSED') permissionCode = 'PAYROLL_PROCESS';
    if (status === 'PAID') permissionCode = 'PAYROLL_PAY';
    if (status === 'APPROVED') permissionCode = 'PAYROLL_APPROVE';
    if (status === 'CANCELLED') permissionCode = 'PAYROLL_CANCEL';

    const hasPermission = await checkPermission(
      userId,
      companyId,
      permissionCode
    );
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: `You do not have permission to ${permissionCode.replace('PAYROLL_', '').toLowerCase()} payroll.`,
      });
    }

    const payroll = await prisma.payroll.findFirst({
      where: {
        id,
        companyId,
      },
    });

    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Payroll not found',
      });
    }

    const updateData = { status };

    if (status === 'PROCESSED') {
      updateData.processedById = userId;
      updateData.processedAt = new Date();
    } else if (status === 'PAID') {
      updateData.paidById = userId;
      updateData.paidAt = new Date();
      updateData.paymentMethod = paymentMethod;
      updateData.paymentReference = paymentReference;
    } else if (status === 'APPROVED') {
      updateData.approvedById = userId;
      updateData.approvedAt = new Date();
    } else if (status === 'CANCELLED') {
      updateData.rejectionReason = notes;
    }

    const updatedPayroll = await prisma.$transaction(async (tx) => {
      const payrollUpdate = await tx.payroll.update({
        where: { id },
        data: updateData,
        include: {
          items: true,
        },
      });

      // If status is PAID, sync with budget
      if (status === 'PAID') {
        // Group amounts by projectId
        const projectAmounts = {};

        for (const item of payrollUpdate.items) {
          const summary = item.attendanceSummary || {};
          const dailyBreakdown = summary.dailyBreakdown || [];

          for (const day of dailyBreakdown) {
            const pId = day.projectId;
            const amount = day.amount || 0;

            if (pId) {
              projectAmounts[pId] = (projectAmounts[pId] || 0) + amount;
            }
          }
        }

        // For each project, create budget transactions
        for (const [projectId, amount] of Object.entries(projectAmounts)) {
          if (amount <= 0) continue;

          // Find active budget for project
          const activeBudget = await tx.budget.findFirst({
            where: {
              projectId,
              isActive: true,
              companyId,
            },
            include: {
              categories: {
                where: { category: 'LABOR' },
              },
            },
          });

          if (activeBudget && activeBudget.categories.length > 0) {
            const laborCategory = activeBudget.categories[0];

            // Create budget transaction
            await tx.budgetTransaction.create({
              data: {
                transactionNo: `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                budgetId: activeBudget.id,
                categoryId: laborCategory.id,
                payrollId: id,
                amount: amount,
                totalAmount: amount,
                transactionType: 'EXPENSE',
                status: 'DISBURSED',
                description: `Payroll Payment - ${payrollUpdate.payrollNo}`,
                transactionDate: new Date(),
                disbursedDate: new Date(),
                createdById: userId,
              },
            });

            // Update category spent amount
            await tx.budgetCategoryAllocation.update({
              where: { id: laborCategory.id },
              data: {
                spentAmount: { increment: amount },
                remainingAmount: { decrement: amount },
              },
            });

            // Recalculate budget summary
            await recalculateBudgetSummary(activeBudget.id, tx);
          }
        }
      }

      return payrollUpdate;
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId,
        companyId,
        action: `PAYROLL_${status}`,
        entityType: 'PAYROLL',
        entityId: id,
        oldData: { status: payroll.status },
        newData: { status: updatedPayroll.status },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: `Payroll ${status.toLowerCase()} successfully`,
      data: updatedPayroll,
    });
  } catch (error) {
    console.error('Update payroll status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Daily Payroll Summary - NEW function for daily-based reporting
export const getDailyPayrollSummary = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { date } = req.query;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const hasPermission = await checkPermission(
      userId,
      companyId,
      'PAYROLL_READ'
    );
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view payroll summary.',
      });
    }

    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // Get all attendances for the day with shift types
    const attendances = await prisma.workerAttendance.findMany({
      where: {
        project: { companyId },
        date: {
          gte: targetDate,
          lt: nextDay,
        },
        status: 'PRESENT',
        checkInTime: { not: null },
      },
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
            workerId: true,
          },
        },
        shiftType: true,
        project: {
          select: { id: true, name: true },
        },
      },
    });

    // Group by shift type
    const shiftTypeSummary = {};
    let totalPayable = 0;
    let totalWorkers = 0;

    attendances.forEach((attendance) => {
      const shiftName = attendance.shiftType?.name || 'Regular';
      const multiplier = attendance.shiftMultiplier || 1.0;
      const wageRate = attendance.wageRate || 0;
      const amount = wageRate * multiplier;

      if (!shiftTypeSummary[shiftName]) {
        shiftTypeSummary[shiftName] = {
          count: 0,
          totalAmount: 0,
          multiplier: attendance.shiftMultiplier || 1.0,
        };
      }

      shiftTypeSummary[shiftName].count++;
      shiftTypeSummary[shiftName].totalAmount += amount;
      totalPayable += amount;
      totalWorkers++;
    });

    const summary = {
      date: targetDate,
      totalWorkers,
      totalPayable,
      byShiftType: shiftTypeSummary,
      calculationMethod: 'Daily Rate × Shift Multiplier',
    };

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('Get daily payroll summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Delete Payroll (only if PENDING)
export const deletePayroll = async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const companyId = getCompanyIdFromRequest(req);
    const { id } = req.params;

    if (!userId || !companyId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const hasPermission = await checkPermission(
      userId,
      companyId,
      'PAYROLL_DELETE'
    );
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete payrolls.',
      });
    }

    const payroll = await prisma.payroll.findFirst({
      where: {
        id,
        companyId,
      },
    });

    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Payroll not found',
      });
    }

    if (payroll.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        message: 'Only pending payrolls can be deleted',
      });
    }

    // Delete payroll items first (cascade should handle this, but just in case)
    await prisma.payrollItem.deleteMany({
      where: { payrollId: id },
    });

    // Delete payroll
    await prisma.payroll.delete({
      where: { id },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId,
        companyId,
        action: 'PAYROLL_DELETED',
        entityType: 'PAYROLL',
        entityId: id,
        oldData: payroll,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Payroll deleted successfully',
    });
  } catch (error) {
    console.error('Delete payroll error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
