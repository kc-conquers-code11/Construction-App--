// src/controllers/attendance.controller.js
import prisma from '../config/database.js';

// Helper function to check attendance permissions
const checkAttendancePermission = async (userId, companyId, permissionCode) => {
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

// Helper to check if user is assigned to a project
const isUserAssignedToProject = async (userId, projectId) => {
  const assignment = await prisma.projectAssignment.findFirst({
    where: {
      userId,
      projectId,
    },
  });
  return !!assignment;
};

// MARK ATTENDANCE FOR EMPLOYEES (Single or Bulk)
export const markAttendance = async (req, res) => {
  try {
    const { date, projectId, attendanceRecords } = req.body;

    // Check if user has permission to mark attendance
    const hasPermission = await checkAttendancePermission(
      req.user.userId,
      req.user.companyId,
      'ATTENDANCE_MARK'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to mark attendance',
      });
    }

    // Parse the date
    const attendanceDate = new Date(date);
    attendanceDate.setHours(0, 0, 0, 0);

    // Validate project exists and belongs to company
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

    // Process attendance records
    const results = [];
    const errors = [];

    for (const record of attendanceRecords) {
      try {
        const { userId, status, remarks } = record;

        // Check if user exists and belongs to company
        const user = await prisma.user.findFirst({
          where: {
            id: userId,
            companyId: req.user.companyId,
            userType: 'EMPLOYEE',
          },
        });

        if (!user) {
          errors.push({
            userId,
            error: 'User not found in your company',
          });
          continue;
        }

        // Check if user is assigned to this project
        const isAssigned = await isUserAssignedToProject(userId, projectId);
        if (!isAssigned) {
          errors.push({
            userId,
            name: user.name,
            error: 'User is not assigned to this project',
          });
          continue;
        }

        // Check if attendance already exists for this user, date, and project
        const existingAttendance = await prisma.attendance.findFirst({
          where: {
            userId,
            date: attendanceDate,
            projectId,
          },
        });

        let attendance;

        if (existingAttendance) {
          // Update existing attendance
          attendance = await prisma.attendance.update({
            where: { id: existingAttendance.id },
            data: {
              status,
              remarks,
              updatedAt: new Date(),
              markedById: req.user.userId,
            },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  employeeId: true,
                },
              },
              project: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          });

          results.push({
            action: 'updated',
            attendance,
          });
        } else {
          // Create new attendance
          attendance = await prisma.attendance.create({
            data: {
              userId,
              projectId,
              date: attendanceDate,
              status,
              remarks,
              markedById: req.user.userId,
            },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  employeeId: true,
                },
              },
              project: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          });

          results.push({
            action: 'created',
            attendance,
          });
        }

        // Log activity
        await prisma.auditLog.create({
          data: {
            userId: req.user.userId,
            companyId: req.user.companyId,
            action: existingAttendance
              ? 'ATTENDANCE_UPDATED'
              : 'ATTENDANCE_CREATED',
            entityType: 'ATTENDANCE',
            entityId: attendance.id,
            newData: {
              userId: user.id,
              userName: user.name,
              projectId,
              projectName: project.name,
              date: attendanceDate,
              status,
            },
            userAgent: req.headers['user-agent'],
          },
        });
      } catch (error) {
        errors.push({
          userId: record.userId,
          error: error.message,
        });
      }
    }

    res.status(201).json({
      success: true,
      message: `Attendance marked for ${results.length} employees`,
      summary: {
        total: attendanceRecords.length,
        successful: results.length,
        failed: errors.length,
      },
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Mark attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark attendance',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// GET ATTENDANCE BY DATE
export const getAttendanceByDate = async (req, res) => {
  try {
    const { date, projectId } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Date is required',
      });
    }

    // Check permission
    const hasPermission = await checkAttendancePermission(
      req.user.userId,
      req.user.companyId,
      'ATTENDANCE_VIEW'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view attendance',
      });
    }

    const attendanceDate = new Date(date);
    attendanceDate.setHours(0, 0, 0, 0);

    const where = {
      date: attendanceDate,
      user: {
        companyId: req.user.companyId,
        userType: 'EMPLOYEE',
      },
    };

    // Add project filter if provided
    if (projectId) {
      where.projectId = projectId;

      // Verify project belongs to company
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
    }

    // Get all employees in the company/project
    const employees = await prisma.user.findMany({
      where: {
        companyId: req.user.companyId,
        userType: 'EMPLOYEE',
        isActive: true,
        ...(projectId && {
          projectAssignments: {
            some: {
              projectId,
            },
          },
        }),
      },
      select: {
        id: true,
        name: true,
        employeeId: true,
        designation: true,
      },
      orderBy: { name: 'asc' },
    });

    // Get attendance records for the date
    const attendanceRecords = await prisma.attendance.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            employeeId: true,
            designation: true,
          },
        },
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
      },
    });

    // Create a map of attendance by user ID
    const attendanceMap = attendanceRecords.reduce((map, record) => {
      map[record.userId] = record;
      return map;
    }, {});

    // Combine employees with their attendance status
    const combinedData = employees.map((employee) => ({
      ...employee,
      attendance: attendanceMap[employee.id] || {
        status: 'NOT_MARKED',
        remarks: null,
      },
      hasAttendance: !!attendanceMap[employee.id],
    }));

    // Calculate summary statistics
    const summary = {
      totalEmployees: employees.length,
      marked: attendanceRecords.length,
      notMarked: employees.length - attendanceRecords.length,
      byStatus: attendanceRecords.reduce((acc, record) => {
        acc[record.status] = (acc[record.status] || 0) + 1;
        return acc;
      }, {}),
    };

    res.json({
      success: true,
      data: {
        date: attendanceDate,
        project: projectId ? await getProjectDetails(projectId) : null,
        employees: combinedData,
        summary,
      },
    });
  } catch (error) {
    console.error('Get attendance by date error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch attendance',
    });
  }
};

// Helper to get project details
const getProjectDetails = async (projectId) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      projectId: true,
    },
  });
  return project;
};

// GET ATTENDANCE BY DATE RANGE (Weekly/Monthly)
export const getAttendanceByDateRange = async (req, res) => {
  try {
    const { startDate, endDate, projectId, userId } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required',
      });
    }

    // Check permission
    const hasPermission = await checkAttendancePermission(
      req.user.userId,
      req.user.companyId,
      'ATTENDANCE_VIEW'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view attendance',
      });
    }

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const where = {
      date: {
        gte: start,
        lte: end,
      },
      user: {
        companyId: req.user.companyId,
        userType: 'EMPLOYEE',
      },
    };

    if (projectId) {
      where.projectId = projectId;
    }

    if (userId) {
      where.userId = userId;
    }

    const attendanceRecords = await prisma.attendance.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            employeeId: true,
            designation: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ date: 'asc' }, { user: { name: 'asc' } }],
    });

    // Group by date
    const groupedByDate = attendanceRecords.reduce((groups, record) => {
      const dateStr = record.date.toISOString().split('T')[0];
      if (!groups[dateStr]) {
        groups[dateStr] = {
          date: record.date,
          count: 0,
          records: [],
          summary: {},
        };
      }
      groups[dateStr].records.push(record);
      groups[dateStr].count++;

      // Update status summary for this date
      groups[dateStr].summary[record.status] =
        (groups[dateStr].summary[record.status] || 0) + 1;

      return groups;
    }, {});

    // Group by user (for individual reports)
    const groupedByUser = attendanceRecords.reduce((groups, record) => {
      if (!groups[record.userId]) {
        groups[record.userId] = {
          user: record.user,
          totalDays: 0,
          present: 0,
          absent: 0,
          late: 0,
          halfDay: 0,
          onLeave: 0,
          records: [],
        };
      }
      groups[record.userId].records.push(record);
      groups[record.userId].totalDays++;
      groups[record.userId][record.status.toLowerCase()]++;

      return groups;
    }, {});

    // Calculate overall summary
    const summary = {
      totalRecords: attendanceRecords.length,
      uniqueEmployees: Object.keys(groupedByUser).length,
      uniqueDates: Object.keys(groupedByDate).length,
      byStatus: attendanceRecords.reduce((acc, record) => {
        acc[record.status] = (acc[record.status] || 0) + 1;
        return acc;
      }, {}),
    };

    res.json({
      success: true,
      data: {
        dateRange: {
          start,
          end,
        },
        groupedByDate: Object.values(groupedByDate),
        groupedByUser: Object.values(groupedByUser),
        summary,
      },
    });
  } catch (error) {
    console.error('Get attendance by date range error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch attendance',
    });
  }
};

// GET EMPLOYEE ATTENDANCE (Individual)
export const getEmployeeAttendance = async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate, projectId } = req.query;

    // Check permission
    const hasPermission = await checkAttendancePermission(
      req.user.userId,
      req.user.companyId,
      'ATTENDANCE_VIEW'
    );

    if (!hasPermission && req.user.userId !== userId) {
      return res.status(403).json({
        success: false,
        message:
          "You do not have permission to view this employee's attendance",
      });
    }

    // Verify employee belongs to company
    const employee = await prisma.user.findFirst({
      where: {
        id: userId,
        companyId: req.user.companyId,
        userType: 'EMPLOYEE',
      },
      select: {
        id: true,
        name: true,
        employeeId: true,
        designation: true,
        department: true,
      },
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    const where = {
      userId,
      user: {
        companyId: req.user.companyId,
      },
    };

    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);

      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      where.date = {
        gte: start,
        lte: end,
      };
    }

    if (projectId) {
      where.projectId = projectId;
    }

    const attendanceRecords = await prisma.attendance.findMany({
      where,
      include: {
        project: {
          select: {
            id: true,
            name: true,
            projectId: true,
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    // Calculate statistics
    const totalDays = attendanceRecords.length;
    const present = attendanceRecords.filter(
      (r) => r.status === 'PRESENT'
    ).length;
    const absent = attendanceRecords.filter(
      (r) => r.status === 'ABSENT'
    ).length;
    const late = attendanceRecords.filter((r) => r.status === 'LATE').length;
    const halfDay = attendanceRecords.filter(
      (r) => r.status === 'HALF_DAY'
    ).length;
    const onLeave = attendanceRecords.filter(
      (r) => r.status === 'ON_LEAVE'
    ).length;

    const statistics = {
      totalDays,
      present,
      absent,
      late,
      halfDay,
      onLeave,
      attendanceRate: totalDays > 0 ? (present / totalDays) * 100 : 0,
      byProject: attendanceRecords.reduce((acc, record) => {
        const projectName = record.project?.name || 'Unknown';
        if (!acc[projectName]) {
          acc[projectName] = {
            count: 0,
            present: 0,
          };
        }
        acc[projectName].count++;
        if (record.status === 'PRESENT') {
          acc[projectName].present++;
        }
        return acc;
      }, {}),
    };

    res.json({
      success: true,
      data: {
        employee,
        attendance: attendanceRecords,
        statistics,
      },
    });
  } catch (error) {
    console.error('Get employee attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch employee attendance',
    });
  }
};

// UPDATE ATTENDANCE RECORD
export const updateAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, remarks } = req.body;

    // Check permission
    const hasPermission = await checkAttendancePermission(
      req.user.userId,
      req.user.companyId,
      'ATTENDANCE_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update attendance',
      });
    }

    // Get the attendance record
    const attendance = await prisma.attendance.findFirst({
      where: {
        id,
        user: {
          companyId: req.user.companyId,
        },
      },
      include: {
        user: true,
      },
    });

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found',
      });
    }

    const updatedAttendance = await prisma.attendance.update({
      where: { id },
      data: {
        status,
        remarks,
        updatedAt: new Date(),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            employeeId: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'ATTENDANCE_UPDATED',
        entityType: 'ATTENDANCE',
        entityId: id,
        oldData: {
          status: attendance.status,
          remarks: attendance.remarks,
        },
        newData: {
          status,
          remarks,
        },
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Attendance updated successfully',
      data: updatedAttendance,
    });
  } catch (error) {
    console.error('Update attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update attendance',
    });
  }
};

// DELETE ATTENDANCE RECORD
export const deleteAttendance = async (req, res) => {
  try {
    const { id } = req.params;

    // Check permission
    const hasPermission = await checkAttendancePermission(
      req.user.userId,
      req.user.companyId,
      'ATTENDANCE_DELETE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete attendance',
      });
    }

    // Get the attendance record
    const attendance = await prisma.attendance.findFirst({
      where: {
        id,
        user: {
          companyId: req.user.companyId,
        },
      },
    });

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found',
      });
    }

    await prisma.attendance.delete({
      where: { id },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'ATTENDANCE_DELETED',
        entityType: 'ATTENDANCE',
        entityId: id,
        oldData: attendance,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Attendance record deleted successfully',
    });
  } catch (error) {
    console.error('Delete attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete attendance',
    });
  }
};

// GET ATTENDANCE SUMMARY (Dashboard)
export const getAttendanceSummary = async (req, res) => {
  try {
    const { date, projectId } = req.query;

    // Check permission
    const hasPermission = await checkAttendancePermission(
      req.user.userId,
      req.user.companyId,
      'ATTENDANCE_VIEW'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view attendance summary',
      });
    }

    const today = date ? new Date(date) : new Date();
    today.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(today);
    startOfWeek.setDate(
      today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1)
    );

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    // Base where clause for filtering
    const baseWhere = {
      user: {
        companyId: req.user.companyId,
        userType: 'EMPLOYEE',
        isActive: true,
      },
    };

    if (projectId) {
      baseWhere.projectId = projectId;
    }

    // Get total employees count
    const totalEmployees = await prisma.user.count({
      where: {
        companyId: req.user.companyId,
        userType: 'EMPLOYEE',
        isActive: true,
        ...(projectId && {
          projectAssignments: {
            some: {
              projectId,
            },
          },
        }),
      },
    });

    // Today's attendance
    const todayAttendance = await prisma.attendance.groupBy({
      by: ['status'],
      where: {
        ...baseWhere,
        date: {
          gte: today,
          lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
        },
      },
      _count: true,
    });

    // Week attendance
    const weekAttendance = await prisma.attendance.count({
      where: {
        ...baseWhere,
        date: {
          gte: startOfWeek,
        },
      },
    });

    // Month attendance
    const monthAttendance = await prisma.attendance.groupBy({
      by: ['status'],
      where: {
        ...baseWhere,
        date: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      _count: true,
    });

    // Recent attendance records
    const recentAttendance = await prisma.attendance.findMany({
      where: baseWhere,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            employeeId: true,
            designation: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { date: 'desc' },
      take: 10,
    });

    // Format today's summary
    const todaySummary = {
      total: totalEmployees,
      marked: todayAttendance.reduce((sum, item) => sum + item._count, 0),
      notMarked:
        totalEmployees -
        todayAttendance.reduce((sum, item) => sum + item._count, 0),
      byStatus: todayAttendance.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {}),
    };

    // Format month summary
    const monthSummary = {
      totalDays:
        Math.ceil((endOfMonth - startOfMonth) / (1000 * 60 * 60 * 24)) + 1,
      totalRecords: monthAttendance.reduce((sum, item) => sum + item._count, 0),
      byStatus: monthAttendance.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {}),
    };

    res.json({
      success: true,
      data: {
        date: today,
        project: projectId ? await getProjectDetails(projectId) : null,
        summary: {
          today: todaySummary,
          week: {
            totalRecords: weekAttendance,
          },
          month: monthSummary,
        },
        recentAttendance,
      },
    });
  } catch (error) {
    console.error('Get attendance summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch attendance summary',
    });
  }
};
