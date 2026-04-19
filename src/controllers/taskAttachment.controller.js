import prisma from '../config/database.js';
import {
  uploadToCloudflare,
  deleteFromCloudflare,
  uploadLocal,
  deleteLocal,
} from '../services/fileStorage.service.js';
import { fileURLToPath } from 'url';
import path from 'path';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Upload Task Attachment
export const uploadTaskAttachment = async (req, res) => {
  try {
    // Check TASK_UPDATE permission (since uploading attachment modifies task)
    const hasPermission = await checkTaskPermission(
      req.user.userId,
      req.user.companyId,
      'TASK_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to upload task attachments',
      });
    }

    const { taskId } = req.body;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        message: 'Task ID is required',
      });
    }

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
        message: 'Task not found in your company',
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
          message: 'You do not have access to upload attachments to this task',
        });
      }
    }

    // Check if file is uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    const file = req.file;

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return res.status(400).json({
        success: false,
        message: 'File size exceeds 10MB limit',
      });
    }

    // Validate file type
    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'application/msword', // .doc
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/vnd.ms-excel', // .xls
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-powerpoint', // .ppt
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
      'text/plain',
      'application/zip',
      'application/x-rar-compressed',
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'File type not allowed',
        allowedTypes: [
          'Images (JPEG, PNG, GIF, WebP)',
          'PDF',
          'Word documents',
          'Excel spreadsheets',
          'PowerPoint presentations',
          'Text files',
          'ZIP/RAR archives',
        ],
      });
    }

    // Upload file - FORCE LOCAL FOR TESTING
    let fileUrl;
    let uploadResponse;

    // TEMPORARY: Always use local upload for testing
    console.log('⚠️ Using local upload (Cloudflare disabled for testing)');
    uploadResponse = await uploadLocal(file, 'task-attachments');
    fileUrl = uploadResponse.url;

    // Optional: Keep original logic but add condition to force local -- 
    // if (process.env.NODE_ENV === 'production' && process.env.USE_CLOUDFLARE !== 'false') {
    //   uploadResponse = await uploadToCloudflare(file, 'task-attachments');
    //   fileUrl = uploadResponse.url;
    // } else {
    //   uploadResponse = await uploadLocal(file, 'task-attachments');
    //   fileUrl = uploadResponse.url;
    // }

    // Create attachment record in database
    const attachment = await prisma.taskAttachment.create({
      data: {
        fileName: file.originalname,
        fileUrl: fileUrl,
        fileType: file.mimetype,
        fileSize: file.size,
        taskId: taskId,
        uploadedById: req.user.userId,
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'TASK_ATTACHMENT_UPLOADED',
        entityType: 'TASK_ATTACHMENT',
        entityId: attachment.id,
        newData: {
          fileName: attachment.fileName,
          fileType: attachment.fileType,
          taskId: taskId,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    // Notify task creator and assignee about new attachment
    const notifications = [];

    if (task.createdById !== req.user.userId) {
      notifications.push({
        userId: task.createdById,
        title: 'New Attachment Added',
        message: `New file "${attachment.fileName}" added to task: "${task.title}"`,
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
        title: 'New Attachment Added',
        message: `New file "${attachment.fileName}" added to task: "${task.title}"`,
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
      message: 'File uploaded successfully',
      data: attachment,
      storageInfo: {
        environment: process.env.NODE_ENV,
        storageType:
          process.env.NODE_ENV === 'production' ? 'Cloudflare R2' : 'Local',
        publicUrl: fileUrl,
      },
    });
  } catch (error) {
    console.error('Upload task attachment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload file',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Get Task Attachments
export const getTaskAttachments = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { page = 1, limit = 20 } = req.query;
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
        message: 'You do not have permission to view task attachments',
      });
    }

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
          message: 'You do not have access to view attachments for this task',
        });
      }
    }

    const [attachments, total] = await Promise.all([
      prisma.taskAttachment.findMany({
        where: { taskId },
        include: {
          uploadedBy: {
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
      prisma.taskAttachment.count({ where: { taskId } }),
    ]);

    // Categorize attachments by type
    const categorizedAttachments = {
      images: attachments.filter((att) => att.fileType.startsWith('image/')),
      documents: attachments.filter(
        (att) =>
          att.fileType.startsWith('application/') ||
          att.fileType === 'text/plain'
      ),
      others: attachments.filter(
        (att) =>
          !att.fileType.startsWith('image/') &&
          !att.fileType.startsWith('application/') &&
          att.fileType !== 'text/plain'
      ),
    };

    res.json({
      success: true,
      data: {
        attachments,
        categorized: categorizedAttachments,
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get task attachments error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Attachment by ID
export const getAttachmentById = async (req, res) => {
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
        message: 'You do not have permission to view attachments',
      });
    }

    const attachment = await prisma.taskAttachment.findFirst({
      where: { id },
      include: {
        task: {
          include: {
            project: {
              select: {
                companyId: true,
              },
            },
          },
        },
        uploadedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            profilePicture: true,
          },
        },
      },
    });

    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found',
      });
    }

    // Check if attachment belongs to company
    if (attachment.task.project.companyId !== req.user.companyId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Check if user has access to the task
    const task = attachment.task;
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
          message: 'You do not have access to this attachment',
        });
      }
    }

    res.json({
      success: true,
      data: attachment,
    });
  } catch (error) {
    console.error('Get attachment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Delete Attachment
export const deleteAttachment = async (req, res) => {
  try {
    const { id } = req.params;

    // Check TASK_UPDATE permission
    const hasPermission = await checkTaskPermission(
      req.user.userId,
      req.user.companyId,
      'TASK_UPDATE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete attachments',
      });
    }

    const attachment = await prisma.taskAttachment.findFirst({
      where: { id },
      include: {
        task: {
          include: {
            project: {
              select: {
                companyId: true,
              },
            },
          },
        },
      },
    });

    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found',
      });
    }

    // Check if attachment belongs to company
    if (attachment.task.project.companyId !== req.user.companyId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Check if user can delete this attachment
    // Only attachment uploader, task creator, or admin can delete
    const isAttachmentUploader = attachment.uploadedById === req.user.userId;
    const isTaskCreator = attachment.task.createdById === req.user.userId;

    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      if (!isAttachmentUploader && !isTaskCreator) {
        return res.status(403).json({
          success: false,
          message: 'You can only delete your own attachments',
        });
      }
    }

    // Delete file from storage based on environment - for the cloudflare part
    // try {
    //   if (process.env.NODE_ENV === 'production') {
    //     // Delete from Cloudflare R2
    //     await deleteFromCloudflare(attachment.fileUrl);
    //   } else {
    //     // Delete from local storage
    //     await deleteLocal(attachment.fileUrl);
    //   }
    // } catch (storageError) {
    //   console.error('File deletion error:', storageError);
    //   // Continue with database deletion even if file deletion fails
    // }

    // Delete file from storage - TEMPORARY LOCAL DELETE
    try {
      console.log(
        '⚠️ Deleting from local storage (Cloudflare disabled for testing)'
      );
      await deleteLocal(attachment.fileUrl);
    } catch (storageError) {
      console.error('File deletion error:', storageError);
      // Continue with database deletion even if file deletion fails
    }

    // Delete attachment record from database
    await prisma.taskAttachment.delete({
      where: { id },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'TASK_ATTACHMENT_DELETED',
        entityType: 'TASK_ATTACHMENT',
        entityId: id,
        oldData: {
          fileName: attachment.fileName,
          fileUrl: attachment.fileUrl,
          taskId: attachment.taskId,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Attachment deleted successfully',
      data: {
        deletedId: id,
        fileName: attachment.fileName,
      },
    });
  } catch (error) {
    console.error('Delete attachment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// // Download Attachment (Original Version)
// export const downloadAttachment = async (req, res) => {
//   try {
//     const { id } = req.params;

//     // Check TASK_READ permission
//     const hasPermission = await checkTaskPermission(
//       req.user.userId,
//       req.user.companyId,
//       'TASK_READ'
//     );

//     if (!hasPermission) {
//       return res.status(403).json({
//         success: false,
//         message: 'You do not have permission to download attachments',
//       });
//     }

//     const attachment = await prisma.taskAttachment.findFirst({
//       where: { id },
//       include: {
//         task: {
//           include: {
//             project: {
//               select: {
//                 companyId: true,
//               },
//             },
//           },
//         },
//       },
//     });

//     if (!attachment) {
//       return res.status(404).json({
//         success: false,
//         message: 'Attachment not found',
//       });
//     }

//     // Check if attachment belongs to company
//     if (attachment.task.project.companyId !== req.user.companyId) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied',
//       });
//     }

//     // Check if user has access to the task
//     const task = attachment.task;
//     const isTaskCreator = task.createdById === req.user.userId;
//     const isTaskAssignee = task.assignedToId === req.user.userId;

//     // For non-admin users, they must be creator, assignee, or project member
//     if (
//       req.user.userType !== 'COMPANY_ADMIN' &&
//       req.user.userType !== 'SUPER_ADMIN'
//     ) {
//       // Check if user is assigned to the project
//       const isProjectMember = await prisma.projectAssignment.findFirst({
//         where: {
//           projectId: task.projectId,
//           userId: req.user.userId,
//         },
//       });

//       if (!isTaskCreator && !isTaskAssignee && !isProjectMember) {
//         return res.status(403).json({
//           success: false,
//           message: 'You do not have access to this attachment',
//         });
//       }
//     }

//     // For Cloudflare R2, we can redirect to the public URL
//     if (
//       process.env.NODE_ENV === 'production' &&
//       (attachment.fileUrl.includes('r2.cloudflarestorage.com') ||
//         attachment.fileUrl.includes('r2.dev'))
//     ) {
//       return res.redirect(attachment.fileUrl);
//     }

//     // For local files, extract the local path
//     if (attachment.fileUrl.includes('http://localhost:5000/uploads')) {
//       // Extract local path from URL
//       const urlParts = attachment.fileUrl.split('/uploads/');
//       if (urlParts.length > 1) {
//         const localPath = path.join(__dirname, '../../uploads', urlParts[1]);
//         return res.download(localPath, attachment.fileName);
//       }
//     }

//     // If fileUrl is already a local path
//     return res.download(attachment.fileUrl, attachment.fileName);
//   } catch (error) {
//     console.error('Download attachment error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//     });
//   }
// };

// Download Attachment
export const downloadAttachment = async (req, res) => {
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
        message: 'You do not have permission to download attachments',
      });
    }

    const attachment = await prisma.taskAttachment.findFirst({
      where: { id },
      include: {
        task: {
          include: {
            project: {
              select: {
                companyId: true,
              },
            },
          },
        },
      },
    });

    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found',
      });
    }

    // Check if attachment belongs to company
    if (attachment.task.project.companyId !== req.user.companyId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Check if user has access to the task
    const task = attachment.task;
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
          message: 'You do not have access to this attachment',
        });
      }
    }

    console.log('⚠️ Serving file locally (Cloudflare disabled for testing)');

    // Extract local path from URL
    let localPath;

    // Handle different URL formats
    if (attachment.fileUrl.includes('http://localhost:5000/uploads')) {
      // URL format: http://localhost:5000/uploads/task-attachments/filename
      const urlParts = attachment.fileUrl.split(
        'http://localhost:5000/uploads/'
      );
      if (urlParts.length > 1) {
        localPath = path.join(__dirname, '../../uploads', urlParts[1]);
      }
    } else if (attachment.fileUrl.startsWith('/uploads/')) {
      // Direct path format: /uploads/task-attachments/filename
      localPath = path.join(__dirname, '../..', attachment.fileUrl);
    } else {
      // Try to construct path from filename
      const fileName = attachment.fileUrl.split('/').pop();
      localPath = path.join(
        __dirname,
        '../../uploads/task-attachments',
        fileName
      );
    }

    // Check if file exists
    const fs = await import('fs');
    if (!fs.existsSync(localPath)) {
      console.error('File not found at path:', localPath);
      return res.status(404).json({
        success: false,
        message: 'File not found on server',
        debug: {
          originalUrl: attachment.fileUrl,
          resolvedPath: localPath,
          fileName: attachment.fileName,
        },
      });
    }

    // Set appropriate headers
    res.setHeader('Content-Type', attachment.fileType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${attachment.fileName}"`
    );

    // Send the file
    return res.sendFile(localPath);
  } catch (error) {
    console.error('Download attachment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Get Attachment Statistics
export const getAttachmentStatistics = async (req, res) => {
  try {
    const { taskId } = req.params;

    // Check TASK_READ permission
    const hasPermission = await checkTaskPermission(
      req.user.userId,
      req.user.companyId,
      'TASK_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view attachment statistics',
      });
    }

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
          message: 'You do not have access to this task',
        });
      }
    }

    const [totalAttachments, attachmentsByType, totalSize, recentAttachments] =
      await Promise.all([
        // Total attachments count
        prisma.taskAttachment.count({
          where: { taskId },
        }),

        // Attachments grouped by type
        prisma.taskAttachment.groupBy({
          by: ['fileType'],
          where: { taskId },
          _count: true,
        }),

        // Total size of all attachments
        prisma.taskAttachment.aggregate({
          where: { taskId },
          _sum: {
            fileSize: true,
          },
        }),

        // Recent attachments (last 5)
        prisma.taskAttachment.findMany({
          where: { taskId },
          include: {
            uploadedBy: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
      ]);

    // Categorize file types
    const categorizedTypes = {
      images: attachmentsByType
        .filter((att) => att.fileType.startsWith('image/'))
        .reduce((sum, att) => sum + att._count, 0),
      pdfs: attachmentsByType
        .filter((att) => att.fileType === 'application/pdf')
        .reduce((sum, att) => sum + att._count, 0),
      documents: attachmentsByType
        .filter(
          (att) =>
            att.fileType.includes('word') ||
            att.fileType.includes('excel') ||
            att.fileType.includes('powerpoint') ||
            att.fileType === 'text/plain'
        )
        .reduce((sum, att) => sum + att._count, 0),
      others: attachmentsByType
        .filter(
          (att) =>
            !att.fileType.startsWith('image/') &&
            att.fileType !== 'application/pdf' &&
            !att.fileType.includes('word') &&
            !att.fileType.includes('excel') &&
            !att.fileType.includes('powerpoint') &&
            att.fileType !== 'text/plain'
        )
        .reduce((sum, att) => sum + att._count, 0),
    };

    const statistics = {
      total: totalAttachments,
      byType: categorizedTypes,
      totalSize: totalSize._sum.fileSize || 0,
      totalSizeMB: totalSize._sum.fileSize
        ? (totalSize._sum.fileSize / (1024 * 1024)).toFixed(2)
        : 0,
      averageSize:
        totalAttachments > 0
          ? (totalSize._sum.fileSize || 0) / totalAttachments
          : 0,
      recentAttachments: recentAttachments.map((att) => ({
        id: att.id,
        fileName: att.fileName,
        fileType: att.fileType,
        fileSize: att.fileSize,
        uploadedBy: att.uploadedBy.name,
        uploadedAt: att.createdAt,
      })),
    };

    res.json({
      success: true,
      data: statistics,
    });
  } catch (error) {
    console.error('Get attachment statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
