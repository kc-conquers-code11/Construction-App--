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

// Upload DPR Photo
export const uploadDPRPhoto = async (req, res) => {
  try {
    // Check DPR_PHOTO_UPLOAD permission
    const hasPermission = await checkDPRPermission(
      req.user.userId,
      req.user.companyId,
      'DPR_PHOTO_UPLOAD'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to upload DPR photos',
      });
    }

    const { dprId, title, description } = req.body;

    if (!dprId) {
      return res.status(400).json({
        success: false,
        message: 'DPR ID is required',
      });
    }

    // Check if DPR exists and belongs to company
    const dpr = await prisma.dailyProgressReport.findFirst({
      where: {
        id: dprId,
        project: {
          companyId: req.user.companyId,
        },
      },
      include: {
        project: {
          select: {
            name: true,
            createdById: true,
          },
        },
      },
    });

    if (!dpr) {
      return res.status(404).json({
        success: false,
        message: 'DPR not found in your company',
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
          message: 'You do not have access to upload photos to this DPR',
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

    // Validate file type - UPDATED to allow documents
    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf', 
      'application/msword', 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 
      'text/plain', 
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'Only image or document files are allowed (JPEG, PNG, PDF, DOCX, TXT)',
      });
    }

    // Upload file - FORCE LOCAL FOR TESTING (Cloudflare commented out)
    let fileUrl;
    let thumbnailUrl = null;
    let uploadResponse;

    console.log(
      '⚠️ Using local upload for DPR photos (Cloudflare disabled for testing)'
    );
    uploadResponse = await uploadLocal(file, 'dpr-photos');
    fileUrl = uploadResponse.url;

    // For local, use same URL as thumbnail
    thumbnailUrl = fileUrl;

    // Create DPR photo record
    const dprPhoto = await prisma.dPRPhoto.create({
      data: {
        title: title || `DPR Photo - ${new Date().toLocaleDateString()}`,
        description: description || null,
        imageUrl: fileUrl,
        thumbnailUrl: thumbnailUrl,
        dprId: dprId,
        uploadedById: req.user.userId,
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'DPR_PHOTO_UPLOADED',
        entityType: 'DPR_PHOTO',
        entityId: dprPhoto.id,
        newData: {
          title: dprPhoto.title,
          dprId: dprId,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    // Send notification to DPR preparer and project manager
    const notifications = [];

    if (dpr.preparedById !== req.user.userId) {
      notifications.push({
        userId: dpr.preparedById,
        title: 'New Photo Added to DPR',
        message: `New photo added to DPR: ${dpr.reportNo}`,
        type: 'DPR',
        relatedId: dprId,
      });
    }

    if (
      dpr.project.createdById !== req.user.userId &&
      dpr.project.createdById !== dpr.preparedById
    ) {
      notifications.push({
        userId: dpr.project.createdById,
        title: 'New Photo Added to DPR',
        message: `New photo added to DPR: ${dpr.reportNo}`,
        type: 'DPR',
        relatedId: dprId,
      });
    }

    if (notifications.length > 0) {
      await prisma.notification.createMany({
        data: notifications,
      });
    }

    res.status(201).json({
      success: true,
      message: 'DPR photo uploaded successfully',
      data: dprPhoto,
      storageInfo: {
        environment: process.env.NODE_ENV,
        storageType: 'Local', 
        publicUrl: fileUrl,
      },
    });
  } catch (error) {
    console.error('Upload DPR photo error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload DPR photo',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Get DPR Photos
export const getDPRPhotos = async (req, res) => {
  try {
    const { dprId } = req.params;
    const { page = 1, limit = 20 } = req.query;
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
        message: 'You do not have permission to view DPR photos',
      });
    }

    // Check if DPR exists and belongs to company
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
          message: 'You do not have access to view photos for this DPR',
        });
      }
    }

    const [photos, total] = await Promise.all([
      prisma.dPRPhoto.findMany({
        where: { dprId },
        include: {
          uploadedBy: {
            select: {
              id: true,
              name: true,
              designation: true,
              profilePicture: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.dPRPhoto.count({ where: { dprId } }),
    ]);

    // Group photos by upload date
    const photosByDate = photos.reduce((acc, photo) => {
      const date = new Date(photo.createdAt).toLocaleDateString();
      if (!acc[date]) {
        acc[date] = [];
      }
      acc[date].push(photo);
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        photos,
        groupedByDate: photosByDate,
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get DPR photos error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get DPR Photo by ID
export const getDPRPhotoById = async (req, res) => {
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
        message: 'You do not have permission to view DPR photos',
      });
    }

    const photo = await prisma.dPRPhoto.findFirst({
      where: { id },
      include: {
        dpr: {
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
            designation: true,
            profilePicture: true,
          },
        },
      },
    });

    if (!photo) {
      return res.status(404).json({
        success: false,
        message: 'DPR photo not found',
      });
    }

    // Check if DPR belongs to company
    if (photo.dpr.project.companyId !== req.user.companyId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Check if user has access to the DPR
    const dpr = photo.dpr;
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
          message: 'You do not have access to this DPR photo',
        });
      }
    }

    res.json({
      success: true,
      data: photo,
    });
  } catch (error) {
    console.error('Get DPR photo error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Delete DPR Photo
export const deleteDPRPhoto = async (req, res) => {
  try {
    const { id } = req.params;

    // Check DPR_PHOTO_UPLOAD permission (same as upload)
    const hasPermission = await checkDPRPermission(
      req.user.userId,
      req.user.companyId,
      'DPR_PHOTO_UPLOAD'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete DPR photos',
      });
    }

    const photo = await prisma.dPRPhoto.findFirst({
      where: { id },
      include: {
        dpr: {
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

    if (!photo) {
      return res.status(404).json({
        success: false,
        message: 'DPR photo not found',
      });
    }

    // Check if DPR belongs to company
    if (photo.dpr.project.companyId !== req.user.companyId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Check if user can delete this photo
    // Only photo uploader, DPR preparer, or admin can delete
    const isPhotoUploader = photo.uploadedById === req.user.userId;
    const isDPRPreparer = photo.dpr.preparedById === req.user.userId;

    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      if (!isPhotoUploader && !isDPRPreparer) {
        return res.status(403).json({
          success: false,
          message:
            'You can only delete your own photos or photos from DPRs you prepared',
        });
      }
    }

    // Delete file from storage - TEMPORARY LOCAL DELETE
    try {
      console.log(
        '⚠️ Deleting DPR photo from local storage (Cloudflare disabled for testing)'
      );
      await deleteLocal(photo.imageUrl);

      // Also delete thumbnail if it exists and is different
      if (photo.thumbnailUrl && photo.thumbnailUrl !== photo.imageUrl) {
        await deleteLocal(photo.thumbnailUrl);
      }
    } catch (storageError) {
      console.error('File deletion error:', storageError);
      // Continue with database deletion even if file deletion fails
    }

    // Delete DPR photo record from database
    await prisma.dPRPhoto.delete({
      where: { id },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'DPR_PHOTO_DELETED',
        entityType: 'DPR_PHOTO',
        entityId: id,
        oldData: {
          title: photo.title,
          imageUrl: photo.imageUrl,
          dprId: photo.dprId,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'DPR photo deleted successfully',
      data: {
        deletedId: id,
        title: photo.title,
      },
    });
  } catch (error) {
    console.error('Delete DPR photo error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Download DPR Photo
export const downloadDPRPhoto = async (req, res) => {
  try {
    const { id } = req.params;
    const { thumbnail = 'false' } = req.query;

    // Check DPR_READ permission
    const hasPermission = await checkDPRPermission(
      req.user.userId,
      req.user.companyId,
      'DPR_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to download DPR photos',
      });
    }

    const photo = await prisma.dPRPhoto.findFirst({
      where: { id },
      include: {
        dpr: {
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

    if (!photo) {
      return res.status(404).json({
        success: false,
        message: 'DPR photo not found',
      });
    }

    // Check if DPR belongs to company
    if (photo.dpr.project.companyId !== req.user.companyId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Check if user has access to the DPR
    const dpr = photo.dpr;
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
          message: 'You do not have access to this DPR photo',
        });
      }
    }

    console.log(
      '⚠️ Serving DPR photo locally (Cloudflare disabled for testing)'
    );

    // Choose which URL to serve (original or thumbnail)
    const urlToServe =
      thumbnail === 'true'
        ? photo.thumbnailUrl || photo.imageUrl
        : photo.imageUrl;

    // Extract local path from URL
    let localPath;

    // Handle different URL formats
    if (urlToServe.includes('http://localhost:5000/uploads')) {
      // URL format: http://localhost:5000/uploads/dpr-photos/filename
      const urlParts = urlToServe.split('http://localhost:5000/uploads/');
      if (urlParts.length > 1) {
        localPath = path.join(__dirname, '../../uploads', urlParts[1]);
      }
    } else if (urlToServe.startsWith('/uploads/')) {
      // Direct path format: /uploads/dpr-photos/filename
      localPath = path.join(__dirname, '../..', urlToServe);
    } else {
      // Try to construct path from filename
      const fileName = urlToServe.split('/').pop();
      localPath = path.join(__dirname, '../../uploads/dpr-photos', fileName);
    }

    // Check if file exists
    const fs = await import('fs');
    if (!fs.existsSync(localPath)) {
      console.error('DPR photo not found at path:', localPath);
      return res.status(404).json({
        success: false,
        message: 'DPR photo file not found on server',
        debug: {
          originalUrl: urlToServe,
          resolvedPath: localPath,
          photoId: id,
        },
      });
    }

    // Determine filename for download
    const downloadFilename = photo.title
      ? `${photo.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${localPath.split('.').pop()}`
      : `dpr_photo_${id}.${localPath.split('.').pop()}`;

    // Set appropriate headers
    const fileType =
      localPath.toLowerCase().endsWith('.jpg') ||
      localPath.toLowerCase().endsWith('.jpeg')
        ? 'image/jpeg'
        : localPath.toLowerCase().endsWith('.png')
          ? 'image/png'
          : localPath.toLowerCase().endsWith('.gif')
            ? 'image/gif'
            : 'application/octet-stream';

    res.setHeader('Content-Type', fileType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${downloadFilename}"` // Use inline for images to display in browser
    );

    // Send the file
    return res.sendFile(localPath);
  } catch (error) {
    console.error('Download DPR photo error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Update DPR Photo Details
export const updateDPRPhotoDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description } = req.body;

    // Check DPR_PHOTO_UPLOAD permission
    const hasPermission = await checkDPRPermission(
      req.user.userId,
      req.user.companyId,
      'DPR_PHOTO_UPLOAD'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update DPR photos',
      });
    }

    const photo = await prisma.dPRPhoto.findFirst({
      where: { id },
      include: {
        dpr: {
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

    if (!photo) {
      return res.status(404).json({
        success: false,
        message: 'DPR photo not found',
      });
    }

    // Check if DPR belongs to company
    if (photo.dpr.project.companyId !== req.user.companyId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Check if user can update this photo
    // Only photo uploader, DPR preparer, or admin can update
    const isPhotoUploader = photo.uploadedById === req.user.userId;
    const isDPRPreparer = photo.dpr.preparedById === req.user.userId;

    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      if (!isPhotoUploader && !isDPRPreparer) {
        return res.status(403).json({
          success: false,
          message:
            'You can only update your own photos or photos from DPRs you prepared',
        });
      }
    }

    const updatedPhoto = await prisma.dPRPhoto.update({
      where: { id },
      data: {
        title,
        description,
      },
    });

    res.json({
      success: true,
      message: 'DPR photo details updated successfully',
      data: updatedPhoto,
    });
  } catch (error) {
    console.error('Update DPR photo details error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get DPR Photo Statistics
export const getDPRPhotoStatistics = async (req, res) => {
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
        message: 'You do not have permission to view DPR photo statistics',
      });
    }

    // Check if DPR exists and belongs to company
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

    const [totalPhotos, photosByUploader, recentPhotos] = await Promise.all([
      // Total photos count
      prisma.dPRPhoto.count({
        where: { dprId },
      }),

      // Photos grouped by uploader
      prisma.dPRPhoto.groupBy({
        by: ['uploadedById'],
        where: { dprId },
        _count: true,
      }),

      // Recent photos (last 10)
      prisma.dPRPhoto.findMany({
        where: { dprId },
        include: {
          uploadedBy: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Get uploader details
    const uploaderIds = photosByUploader.map((item) => item.uploadedById);
    const uploaders = await prisma.user.findMany({
      where: {
        id: { in: uploaderIds },
      },
      select: {
        id: true,
        name: true,
        designation: true,
      },
    });

    const uploaderMap = uploaders.reduce((acc, uploader) => {
      acc[uploader.id] = uploader;
      return acc;
    }, {});

    const statistics = {
      totalPhotos,
      photosByUploader: photosByUploader.map((item) => ({
        uploader: uploaderMap[item.uploadedById] || {
          id: item.uploadedById,
          name: 'Unknown',
        },
        count: item._count,
      })),
      recentPhotos: recentPhotos.map((photo) => ({
        id: photo.id,
        title: photo.title,
        uploadedBy: photo.uploadedBy.name,
        uploadedAt: photo.createdAt,
      })),
    };

    res.json({
      success: true,
      data: statistics,
    });
  } catch (error) {
    console.error('Get DPR photo statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};