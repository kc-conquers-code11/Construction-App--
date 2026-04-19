import prisma from '../config/database.js';
import {
  startOfWeek,
  endOfWeek,
  format,
  parseISO,
} from 'date-fns';


// Helper function to check permissions
const checkWPRPermission = async (userId, companyId, permissionCode) => {
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

const getWeekDates = (weekDate) => {
  const date = weekDate ? parseISO(weekDate) : new Date();
  const weekStart = startOfWeek(date, { weekStartsOn: 1 }); // Monday
  const weekEnd = endOfWeek(date, { weekStartsOn: 1 }); // Sunday

  return { weekStart, weekEnd };
};

const aggregateWeatherData = (weekDPRs, weekStart) => {
  const weatherStats = {
    days: [],
    weatherCodes: [],
    temperatures: [],
  };

  const currentDate = new Date(weekStart);

  for (let i = 0; i < 7; i++) {
    const dayString = currentDate.toDateString();
    const dpr = weekDPRs.find(d => new Date(d.date).toDateString() === dayString);
    
    const dayOfWeek = format(currentDate, 'EEE');
    weatherStats.days.push(dayOfWeek);

    if (dpr && dpr.weather) {
      const weatherCode = dpr.weather.toLowerCase();
      if (weatherCode.includes('sun') || weatherCode.includes('clear')) {
        weatherStats.weatherCodes.push('☀️');
      } else if (weatherCode.includes('cloud')) {
        weatherStats.weatherCodes.push('☁️');
      } else if (weatherCode.includes('rain')) {
        weatherStats.weatherCodes.push('🌧️');
      } else {
        weatherStats.weatherCodes.push('-'); 
      }
    } else {
      weatherStats.weatherCodes.push('-');
    }

    if (dpr && dpr.temperature) {
      weatherStats.temperatures.push(dpr.temperature);
    } else {
      weatherStats.temperatures.push('');
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return weatherStats;
};

// 🚨 UPDATED: Fixed Worker Math fallback for older DPRs
const aggregateAttendanceData = (weekDPRs, weekStart) => {
  const daysOfWeek = [];
  const currentDate = new Date(weekStart);
  
  let totalWorkers = 0;
  let totalStaff = 0;

  for (let i = 0; i < 7; i++) {
    const dayString = currentDate.toDateString();
    const dpr = weekDPRs.find(d => new Date(d.date).toDateString() === dayString);

    let staff = dpr?.staffPresent || 0;
    let workers = dpr?.workersPresent || 0;

    // Fallback: If workers is 0 but totalWorkers is > 0, calculate the difference
    if (workers === 0 && (dpr?.totalWorkers || 0) > 0) {
      workers = dpr.totalWorkers - staff;
      if (workers < 0) workers = 0;
    }

    const total = workers + staff;

    daysOfWeek.push({
      date: format(currentDate, 'dd'),
      workers: workers,
      staff: staff,
      total: total,
    });

    totalWorkers += workers;
    totalStaff += staff;

    currentDate.setDate(currentDate.getDate() + 1);
  }

  const avgWorkers = Math.round(totalWorkers / 7);
  const avgStaff = Math.round(totalStaff / 7);

  return {
    daily: daysOfWeek,
    summary: {
      totalWorkers,
      totalStaff,
      avgWorkers,
      avgStaff,
      totalPresent: totalWorkers + totalStaff,
      chartData: daysOfWeek.map((day) => day.total),
    },
  };
};

// 🚨 UPDATED: Gets Specific Dates and specializations
const getSubcontractorSummary = (weekDPRs) => {
  const map = {};
  
  weekDPRs.forEach((dpr) => {
    if (!dpr.subcontractorDetails) return;
    
    let sub = dpr.subcontractorDetails;
    if (typeof sub === 'string') {
      try { sub = JSON.parse(sub); } catch (e) { return; }
    }
    
    if (sub.name) {
      if (!map[sub.name]) {
        map[sub.name] = { name: sub.name, workersCount: 0, notes: [], dates: [] };
      }
      
      const workers = parseInt(sub.workers) || 0;
      map[sub.name].workersCount += workers;
      
      // Save the exact date they were assigned
      const assignedDate = format(new Date(dpr.date), 'dd MMM');
      if (!map[sub.name].dates.includes(assignedDate)) {
        map[sub.name].dates.push(assignedDate);
      }
      
      if (sub.notes && !map[sub.name].notes.includes(sub.notes)) {
        map[sub.name].notes.push(sub.notes);
      }
    }
  });

  return Object.values(map).map(sc => ({
    name: sc.name,
    specialization: sc.notes.join(', ') || 'General Work',
    dates: sc.dates.join(', ')
  }));
};

const getEquipmentSummary = (weekDPRs) => {
  const map = {};
  
  weekDPRs.forEach((dpr) => {
    if (!dpr.equipmentUsage) return;
    
    let eqList = dpr.equipmentUsage;
    if (typeof eqList === 'string') {
      try { eqList = JSON.parse(eqList); } catch (e) { return; }
    }
    
    if (Array.isArray(eqList)) {
      eqList.forEach((eq) => {
        if (!map[eq.name]) map[eq.name] = { name: eq.name, hrsUsed: 0 };
        map[eq.name].hrsUsed += parseFloat(eq.hours) || 0;
      });
    }
  });

  return Object.values(map)
    .sort((a, b) => b.hrsUsed - a.hrsUsed)
    .slice(0, 5)
    .map(eq => ({
      name: eq.name,
      hrsUsed: `${eq.hrsUsed} hrs`,
      fuel: '-', 
    }));
};

const getProgressSummary = async (projectId, weekStart, weekEnd, previousWeekEnd, weekDPRs) => {
  const currentProject = await prisma.project.findUnique({
    where: { id: projectId },
    select: { progress: true },
  });

  const todayProgressAdded = weekDPRs.length > 0 ? 1.5 * weekDPRs.length : 0; 
  const currentOverallProgress = currentProject?.progress || 0;

  return {
    todayProgressAdded: `+${todayProgressAdded}%`,
    currentOverallProgress: `${currentOverallProgress}%`,
    weeklyProgress: weekDPRs.map((dpr, index) => ({
      date: dpr.date,
      dayProgress: `${index + 1}.5%`,
      workDescription: dpr.workDescription?.substring(0, 50),
    })),
  };
};

const getTaskSummary = (weekDPRs) => {
  const tasksMap = {};

  weekDPRs.forEach((dpr) => {
    if (!dpr.completedWork) return;

    // Example format: "Foundation Pouring (100%) Subtasks: x, y"
    let rawWork = dpr.completedWork;
    
    let taskName = rawWork;
    let percentStr = "0%";
    let percentVal = 0;
    
    // Separate subtasks out of the name
    if (rawWork.includes('Subtasks:')) {
      taskName = rawWork.split('Subtasks:')[0].trim();
    }

    // Extract percentage using Regex
    const pctMatch = taskName.match(/\((\d+)%\)/);
    if (pctMatch) {
      percentVal = parseInt(pctMatch[1]);
      percentStr = `${percentVal}%`;
      taskName = taskName.replace(pctMatch[0], '').trim();
    }

    let status = percentVal >= 100 ? 'Completed' : 'In Progress';
    if (taskName === "") return;

    // Keep the highest progress for the week if task spans multiple days
    if (!tasksMap[taskName] || tasksMap[taskName].progress < percentVal) {
      tasksMap[taskName] = {
        name: taskName,
        status: status,
        progress: percentVal,
        display: percentStr // Will output "100%" instead of "0/0"
      };
    }
  });

  return Object.values(tasksMap);
};

const getMaterialsSummary = async (projectId, weekStart, weekEnd) => {
  const consumedMaterials = await prisma.materialConsumption.findMany({
    where: {
      projectId,
      consumedAt: { gte: weekStart, lte: weekEnd },
    },
    include: {
      material: { select: { id: true, name: true, unit: true } },
    },
    orderBy: { consumedAt: 'desc' },
    take: 5,
  });

  const consumed = consumedMaterials.map((m) => ({
    name: m.material?.name || 'Unknown Material',
    quantity: `${m.quantity} ${m.material?.unit || m.unit || ''}`,
    date: format(m.consumedAt, 'dd MMM'),
  }));

  return { consumed, requested: [] };
};

const getPhotosSummary = async (projectId, weekStart, weekEnd) => {
  const photos = await prisma.dPRPhoto.findMany({
    where: {
      dpr: { projectId, date: { gte: weekStart, lte: weekEnd } },
    },
    include: {
      dpr: { select: { date: true, reportNo: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 9, 
  });

  return photos.map((photo) => ({
    id: photo.id,
    url: photo.imageUrl,
    thumbnail: photo.thumbnailUrl || photo.imageUrl,
    title: photo.title || `DPR Photo - ${format(photo.dpr.date, 'dd MMM')}`,
    date: photo.dpr.date,
    dprNo: photo.dpr.reportNo,
  }));
};

const getDocumentsSummary = async (projectId, weekStart, weekEnd) => {
  const documents = await prisma.document.findMany({
    where: {
      projectId,
      createdAt: { gte: weekStart, lte: weekEnd },
    },
    orderBy: { createdAt: 'desc' },
    take: 9,
  });

  return documents.map((doc) => ({
    id: doc.id,
    title: doc.title,
    url: doc.fileUrl,
    type: doc.documentType,
    fileType: doc.fileType,
    date: doc.createdAt,
  }));
};

const getNextWeekPlanning = async (projectId, weekStart, weekEnd) => {
  const lastDPR = await prisma.dailyProgressReport.findFirst({
    where: { projectId, date: { gte: weekStart, lte: weekEnd } },
    orderBy: { date: 'desc' },
  });

  if (!lastDPR) {
    return [
      { task: 'Continue ongoing work', description: '' },
    ];
  }

  const nextDayPlan = lastDPR.nextDayPlan || '';
  const tasks = [];

  if (nextDayPlan) {
    const sentences = nextDayPlan.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    sentences.slice(0, 3).forEach((sentence) => {
      tasks.push({
        task: sentence.trim().substring(0, 50),
        description: sentence.trim(),
      });
    });
  }

  while (tasks.length < 1) {
    tasks.push({ task: 'Continue ongoing work', description: '' });
  }

  return tasks;
};

// ============================================
// MAIN WPR CONTROLLER
// ============================================

export const getWeeklyProgressReport = async (req, res) => {
  try {
    const { projectId, weekDate } = req.query;

    if (!projectId) {
      return res.status(400).json({ success: false, message: 'Project ID is required' });
    }

    const hasPermission = await checkWPRPermission(req.user.userId, req.user.companyId, 'PROJECT_READ');
    if (!hasPermission) return res.status(403).json({ success: false, message: 'Permission denied' });

    const project = await prisma.project.findFirst({
      where: { id: projectId, companyId: req.user.companyId },
    });

    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    const { weekStart, weekEnd } = getWeekDates(weekDate);
    const previousWeekEnd = new Date(weekStart);
    previousWeekEnd.setDate(previousWeekEnd.getDate() - 1);

    const weekDPRs = await prisma.dailyProgressReport.findMany({
      where: { projectId, date: { gte: weekStart, lte: weekEnd } },
      include: { preparedBy: { select: { name: true } } },
      orderBy: { date: 'asc' },
    });

    if (weekDPRs.length === 0) {
      return res.json({
        success: true,
        message: 'No DPRs found for this week',
        data: null,
        hasData: false,
      });
    }

    const weatherData = aggregateWeatherData(weekDPRs, weekStart);
    const attendanceData = aggregateAttendanceData(weekDPRs, weekStart);
    const subcontractorData = getSubcontractorSummary(weekDPRs);
    const equipmentData = getEquipmentSummary(weekDPRs);
    const tasksData = getTaskSummary(weekDPRs);

    const [
      progressData,
      materialsData,
      photosData,
      documentsData,
      nextWeekPlanning,
    ] = await Promise.all([
      getProgressSummary(projectId, weekStart, weekEnd, previousWeekEnd, weekDPRs),
      getMaterialsSummary(projectId, weekStart, weekEnd),
      getPhotosSummary(projectId, weekStart, weekEnd),
      getDocumentsSummary(projectId, weekStart, weekEnd),
      getNextWeekPlanning(projectId, weekStart, weekEnd),
    ]);

    const wpr = {
      projectInfo: { id: project.id, name: project.name, projectId: project.projectId, location: project.location },
      weekInfo: {
        startDate: weekStart, endDate: weekEnd,
        weekNumber: format(weekStart, 'w'), year: format(weekStart, 'yyyy'),
        display: `${format(weekStart, 'dd MMM')} - ${format(weekEnd, 'dd MMM yyyy')}`,
      },
      weather: weatherData.days.map((day, idx) => ({
        day, code: weatherData.weatherCodes[idx], temp: weatherData.temperatures[idx],
      })),
      description: '', // 🚨 Empty description intentionally
      attendance: attendanceData,
      subcontractors: subcontractorData,
      progress: {
        todayAdded: progressData.todayProgressAdded,
        currentOverall: progressData.currentOverallProgress,
        weeklyBreakdown: progressData.weeklyProgress,
      },
      tasks: tasksData.map((task) => ({
        name: task.name, completed: task.display, status: task.status, progress: task.progress,
      })),
      materials: materialsData,
      equipment: equipmentData,
      photos: photosData,
      documents: documentsData,
      nextWeekPlanning: nextWeekPlanning,
      summary: {
        totalDPRs: weekDPRs.length,
        daysCovered: weekDPRs.length,
        totalAttendance: attendanceData.summary.totalPresent,
      },
      generatedAt: new Date(),
      generatedBy: req.user.name,
    };

    res.json({ success: true, data: wpr, hasData: true });
  } catch (error) {
    console.error('Error generating WPR:', error);
    res.status(500).json({ success: false, message: 'Failed to generate WPR' });
  }
};

// ============================================
// ADDITIONAL WPR CONTROLLER FUNCTIONS
// ============================================

export const getProjectsWPRSummary = async (req, res) => {
  try {
    const { weekDate, projectIds } = req.query;

    const hasPermission = await checkWPRPermission(req.user.userId, req.user.companyId, 'PROJECT_READ');
    if (!hasPermission) return res.status(403).json({ success: false, message: 'Permission denied' });

    const { weekStart, weekEnd } = getWeekDates(weekDate);

    let where = { companyId: req.user.companyId };
    if (projectIds) where.id = { in: projectIds.split(',') };

    const projects = await prisma.project.findMany({
      where,
      select: { id: true, name: true, projectId: true, status: true, progress: true },
    });

    const summaries = await Promise.all(
      projects.map(async (project) => {
        const dprs = await prisma.dailyProgressReport.findMany({
          where: { projectId: project.id, date: { gte: weekStart, lte: weekEnd } },
          select: { workersPresent: true, staffPresent: true, totalWorkers: true }
        });

        let attendanceCount = 0;
        dprs.forEach(dpr => { 
           let w = dpr.workersPresent || 0;
           let s = dpr.staffPresent || 0;
           if (w === 0 && dpr.totalWorkers) w = dpr.totalWorkers - s;
           attendanceCount += (w > 0 ? w : 0) + s; 
        });

        return {
          id: project.id,
          name: project.name,
          projectId: project.projectId,
          status: project.status,
          progress: project.progress,
          dprCount: dprs.length,
          attendanceCount,
        };
      })
    );

    res.json({
      success: true, data: summaries,
      weekInfo: { startDate: weekStart, endDate: weekEnd, weekNumber: format(weekStart, 'w') },
    });
  } catch (error) {
    console.error('Error generating WPR summaries:', error);
    res.status(500).json({ success: false, message: 'Failed to generate weekly summaries' });
  }
};

export const exportWPRAsPDF = async (req, res) => {
  try {
    const wprResponse = await getWeeklyProgressReport(req, res);
    if (res.headersSent) return;

    res.json({ success: true, message: 'WPR data ready for PDF export', exportFormat: 'pdf' });
  } catch (error) {
    console.error('Error exporting WPR:', error);
    res.status(500).json({ success: false, message: 'Failed to export WPR' });
  }
};

export const compareWPR = async (req, res) => {
  try {
    const { projectId, week1Date, week2Date } = req.query;

    if (!projectId || !week1Date || !week2Date) {
      return res.status(400).json({ success: false, message: 'Missing parameters' });
    }

    const hasPermission = await checkWPRPermission(req.user.userId, req.user.companyId, 'PROJECT_READ');
    if (!hasPermission) return res.status(403).json({ success: false, message: 'Permission denied' });

    const week1 = getWeekDates(week1Date);
    const week2 = getWeekDates(week2Date);

    const [dprsWeek1, dprsWeek2] = await Promise.all([
      prisma.dailyProgressReport.findMany({ where: { projectId, date: { gte: week1.weekStart, lte: week1.weekEnd } } }),
      prisma.dailyProgressReport.findMany({ where: { projectId, date: { gte: week2.weekStart, lte: week2.weekEnd } } }),
    ]);

    let attendance1 = 0;
    dprsWeek1.forEach(dpr => {
       let w = dpr.workersPresent || 0;
       if (w === 0 && dpr.totalWorkers) w = dpr.totalWorkers - (dpr.staffPresent || 0);
       attendance1 += (w > 0 ? w : 0) + (dpr.staffPresent || 0);
    });

    let attendance2 = 0;
    dprsWeek2.forEach(dpr => {
       let w = dpr.workersPresent || 0;
       if (w === 0 && dpr.totalWorkers) w = dpr.totalWorkers - (dpr.staffPresent || 0);
       attendance2 += (w > 0 ? w : 0) + (dpr.staffPresent || 0);
    });

    const dpr1Count = dprsWeek1.length;
    const dpr2Count = dprsWeek2.length;

    const comparison = {
      week1: { startDate: week1.weekStart, endDate: week1.weekEnd, attendance: attendance1, dprCount: dpr1Count },
      week2: { startDate: week2.weekStart, endDate: week2.weekEnd, attendance: attendance2, dprCount: dpr2Count },
      changes: {
        attendanceChange: attendance2 - attendance1,
        attendancePercent: attendance1 > 0 ? ((attendance2 - attendance1) / attendance1) * 100 : 0,
        dprChange: dpr2Count - dpr1Count,
      },
    };

    res.json({ success: true, data: comparison });
  } catch (error) {
    console.error('Error comparing WPRs:', error);
    res.status(500).json({ success: false, message: 'Failed to compare weekly reports' });
  }
};

// ============================================
// CREATE WPR (SAVE TO DATABASE)
// ============================================
export const createWPR = async (req, res) => {
  try {
    const {
      projectId,
      weekStartDate,
      weekEndDate,
      description,
      previewData,
      nextWeekPlanning // Array of objects [{task, description}]
    } = req.body;

    // 1. Basic Validation
    if (!projectId || !weekStartDate || !weekEndDate) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // 2. Fetch Project info to ensure we have the human-readable Project ID
    const project = await prisma.project.findUnique({ 
      where: { id: projectId },
      select: { projectId: true } 
    });

    const wprDate = new Date(weekStartDate);
    
    // 3. CLEANUP: Delete any existing WPR for this exact project and week
    // This prevents the "Unique constraint" crash and allows "Overwriting" 
    await prisma.weeklyProgressReport.deleteMany({
      where: {
        projectId,
        weekStartDate: wprDate
      }
    });

    // 4. TRANSFORM: Convert Next Week Planning array into a text block for the description field
    // Since the database only has a String 'description' field, we merge them
    let finalDescription = description || '';
    if (nextWeekPlanning && Array.isArray(nextWeekPlanning) && nextWeekPlanning.length > 0) {
      const planningText = nextWeekPlanning
        .map(p => `- ${p.task}: ${p.description}`)
        .join('\n');
      finalDescription += `\n\n[Next Week Planning]\n${planningText}`;
    }

    // 5. GENERATE: Unique Report Number (WPR-PROJ002-W12-4DigitRandom)
    const weekNumber = format(wprDate, 'w');
    const reportNo = `WPR-${project?.projectId || 'PRJ'}-W${weekNumber}-${Math.floor(1000 + Math.random() * 9000)}`;

    // 6. SAVE: Push to PostgreSQL via Prisma
    const newWPR = await prisma.weeklyProgressReport.create({
      data: {
        reportNo: reportNo,
        projectId: projectId,
        // Check for both 'id' and 'userId' depending on your specific middleware structure
        preparedById: req.user.id || req.user.userId, 
        weekStartDate: wprDate,
        weekEndDate: new Date(weekEndDate),
        description: finalDescription,
        aggregatedData: previewData || {}, // Ensure it's an object, never null
        status: 'TODO', // Must match one of your enum values (TODO, IN_PROGRESS, etc.)
      }
    });

    res.status(201).json({
      success: true,
      message: 'Weekly Progress Report created successfully',
      data: newWPR
    });

  } catch (error) {
    // This will print the exact DB error (e.g. "Missing Column") to your console
    console.error('--- CRITICAL WPR SAVE ERROR ---');
    console.error(error); 
    console.error('-------------------------------');
    
    res.status(500).json({ 
      success: false, 
      message: 'Failed to save WPR to database',
      error: error.message 
    });
  }
};

// ============================================
// GET ALL SAVED WPRs FOR A PROJECT
// ============================================
export const getSavedWPRs = async (req, res) => {
  try {
    const { projectId } = req.query;

    if (!projectId) {
      return res.status(400).json({ success: false, message: 'Project ID is required' });
    }

    const wprs = await prisma.weeklyProgressReport.findMany({
      where: { projectId },
      orderBy: { weekStartDate: 'desc' },
      include: {
        preparedBy: { select: { name: true } },
        approvedBy: { select: { name: true } }
      }
    });

    res.status(200).json({
      success: true,
      data: wprs
    });
  } catch (error) {
    console.error('Error fetching saved WPRs:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch saved WPRs' });
  }
};

// ============================================
// UPDATE WPR (Edit Description Only)
// ============================================
export const updateWPR = async (req, res) => {
  try {
    const { id } = req.params;
    const { description } = req.body;

    if (!id) {
      return res.status(400).json({ success: false, message: 'WPR ID is required' });
    }

    const updatedWPR = await prisma.weeklyProgressReport.update({
      where: { id },
      data: { 
        description: description 
      },
      include: {
        preparedBy: { select: { name: true } }
      }
    });

    res.status(200).json({
      success: true,
      message: 'WPR description updated successfully',
      data: updatedWPR
    });
  } catch (error) {
    console.error('Error updating WPR:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update WPR',
      error: error.message 
    });
  }
};