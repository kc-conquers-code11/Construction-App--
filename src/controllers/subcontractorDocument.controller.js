// src/controllers/subcontractorDocument.controller.js
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

const checkSubcontractorPermission = async (
  userId,
  companyId,
  permissionCode
) => {
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

// Upload Contractor Document
export const uploadContractorDocument = async (req, res) => {
  try {
    // Check CONTRACTOR_DOCUMENT_UPLOAD permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_DOCUMENT_UPLOAD'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to upload contractor documents',
      });
    }

    const { contractorId } = req.params;

    const { title, description, documentType, isPublic, contractorProjectId } =
      req.body;

    if (!contractorId) {
      return res.status(400).json({
        success: false,
        message: 'Contractor ID is required',
      });
    }

    // Check if contractor exists and belongs to company
    const contractor = await prisma.contractor.findFirst({
      where: {
        id: contractorId,
        companyId: req.user.companyId,
      },
      include: {
        company: true,
      },
    });

    if (!contractor) {
      return res.status(404).json({
        success: false,
        message: 'Contractor not found in your company',
      });
    }

    // Check if contractor project exists if provided
    if (contractorProjectId) {
      const contractorProject = await prisma.contractorProject.findFirst({
        where: {
          id: contractorProjectId,
          contractorId,
          companyId: req.user.companyId,
        },
      });

      if (!contractorProject) {
        return res.status(404).json({
          success: false,
          message: 'Contractor project not found',
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

    // Validate file size (max 20MB for documents)
    const maxSize = 20 * 1024 * 1024; // 20MB
    if (file.size > maxSize) {
      return res.status(400).json({
        success: false,
        message: 'File size exceeds 20MB limit',
      });
    }

    // Validate file types
    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'application/zip',
      'application/x-rar-compressed',
      'application/x-7z-compressed',
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({
        success: false,
        message:
          'File type not allowed. Allowed types: Images, PDF, Word, Excel, PowerPoint, Text, Zip, RAR, 7z',
      });
    }

    // Upload file - decide based on environment
    let fileUrl;
    let uploadResponse;
    let storageType = 'Local';

    // if (
    //   process.env.NODE_ENV === 'production' ||
    //   process.env.USE_CLOUDFLARE !== 'false'
    // ) {
    //   console.log('📁 Uploading contractor document to Cloudflare R2');
    //   uploadResponse = await uploadToCloudflare(file, 'contractor-documents');
    //   fileUrl = uploadResponse.url;
    //   storageType = 'Cloudflare R2';
    // } else {
    //   console.log('📁 Uploading contractor document locally');
    //   uploadResponse = await uploadLocal(file, 'contractor-documents');
    //   fileUrl = uploadResponse.url;
    //   storageType = 'Local';
    // }

    console.log('📁 Uploading contractor document locally');
    uploadResponse = await uploadLocal(file, 'contractor-documents');
    fileUrl = uploadResponse.url;
    storageType = 'Local';

    // Create contractor document record
    const document = await prisma.contractorDocument.create({
      data: {
        contractorId,
        contractorProjectId: contractorProjectId || null,
        title: title || `Document - ${file.originalname}`,
        description: description || null,
        documentType: documentType || 'OTHER',
        fileUrl: fileUrl,
        fileType: file.mimetype,
        fileSize: file.size,
        uploadedById: req.user.userId,
        isPublic: isPublic === true || isPublic === 'true',
      },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'CONTRACTOR_DOCUMENT_UPLOADED',
        entityType: 'CONTRACTOR_DOCUMENT',
        entityId: document.id,
        newData: {
          title: document.title,
          documentType: document.documentType,
          contractorId: contractorId,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    // Send notification to contractor creator
    if (contractor.createdById && contractor.createdById !== req.user.userId) {
      await prisma.notification.create({
        data: {
          userId: contractor.createdById,
          title: 'New Document Uploaded',
          message: `New document uploaded for contractor: ${contractor.name}`,
          type: 'CONTRACTOR',
          relatedId: contractorId,
        },
      });
    }

    res.status(201).json({
      success: true,
      message: 'Contractor document uploaded successfully',
      data: document,
      storageInfo: {
        environment: process.env.NODE_ENV,
        storageType: storageType,
        publicUrl: fileUrl,
      },
    });
  } catch (error) {
    console.error('Upload contractor document error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload contractor document',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Get Contractor Documents
export const getContractorDocuments = async (req, res) => {
  try {
    const { contractorId } = req.params;
    const {
      page = 1,
      limit = 20,
      documentType,
      contractorProjectId,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check CONTRACTOR_DOCUMENT_READ permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_DOCUMENT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view contractor documents',
      });
    }

    // Check if contractor exists and belongs to company
    const contractor = await prisma.contractor.findFirst({
      where: {
        id: contractorId,
        companyId: req.user.companyId,
      },
    });

    if (!contractor) {
      return res.status(404).json({
        success: false,
        message: 'Contractor not found',
      });
    }

    const where = {
      contractorId,
    };

    // Add document type filter
    if (documentType) {
      where.documentType = documentType;
    }

    // Add project filter
    if (contractorProjectId) {
      where.contractorProjectId = contractorProjectId;
    }

    const [documents, total] = await Promise.all([
      prisma.contractorDocument.findMany({
        where,
        include: {
          uploadedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              designation: true,
            },
          },
          contractorProject: {
            select: {
              id: true,
              title: true,
              projectCode: true,
            },
          },
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.contractorDocument.count({ where }),
    ]);

    // Group documents by type for easier navigation
    const byType = await prisma.contractorDocument.groupBy({
      by: ['documentType'],
      where: {
        contractorId,
      },
      _count: true,
    });

    const typeSummary = byType.reduce((acc, item) => {
      acc[item.documentType] = item._count;
      return acc;
    }, {});

    // Calculate total file size
    const totalSize = documents.reduce(
      (sum, doc) => sum + (doc.fileSize || 0),
      0
    );

    res.json({
      success: true,
      data: {
        documents,
        contractor: {
          id: contractor.id,
          name: contractor.name,
        },
        summary: {
          total,
          totalSize,
          byType: typeSummary,
        },
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get contractor documents error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Contractor Document by ID
export const getContractorDocumentById = async (req, res) => {
  try {
    const { id } = req.params;

    // Check CONTRACTOR_DOCUMENT_READ permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_DOCUMENT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view contractor documents',
      });
    }

    const document = await prisma.contractorDocument.findFirst({
      where: { id },
      include: {
        contractor: {
          select: {
            id: true,
            name: true,
            companyId: true,
          },
        },
        contractorProject: {
          select: {
            id: true,
            title: true,
            projectCode: true,
          },
        },
        uploadedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            designation: true,
            profilePicture: true,
          },
        },
      },
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Contractor document not found',
      });
    }

    // Check if contractor belongs to company
    if (document.contractor.companyId !== req.user.companyId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    res.json({
      success: true,
      data: document,
    });
  } catch (error) {
    console.error('Get contractor document error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const deleteContractorDocument = async (req, res) => {
  try {
    const { id } = req.params;

    // Check CONTRACTOR_DOCUMENT_DELETE permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_DOCUMENT_DELETE'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete contractor documents',
      });
    }

    const document = await prisma.contractorDocument.findFirst({
      where: { id },
      include: {
        contractor: {
          select: {
            id: true,
            name: true,
            companyId: true,
          },
        },
      },
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Contractor document not found',
      });
    }

    // Check if contractor belongs to company
    if (document.contractor.companyId !== req.user.companyId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Check if user can delete this document
    // Only document uploader, contractor creator, or admin can delete
    const isDocumentUploader = document.uploadedById === req.user.userId;
    const contractor = await prisma.contractor.findFirst({
      where: { id: document.contractorId },
      select: { createdById: true },
    });

    const isContractorCreator = contractor?.createdById === req.user.userId;

    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      if (!isDocumentUploader && !isContractorCreator) {
        return res.status(403).json({
          success: false,
          message:
            'You can only delete your own documents or documents from contractors you created',
        });
      }
    }

    // Delete file from storage
    try {
      /* Commenting out Cloudflare for now to avoid SSL errors
      if (
        process.env.NODE_ENV === 'production' &&
        process.env.USE_CLOUDFLARE !== 'false'
      ) {
        console.log('📁 Deleting contractor document from Cloudflare R2');
        await deleteFromCloudflare(document.fileUrl);
      } else {
      */
      console.log('📁 Deleting contractor document from local storage');
      await deleteLocal(document.fileUrl);
      // }
    } catch (storageError) {
      console.error('File deletion error:', storageError);
      // We continue here so the database record is removed even if the file is missing
    }

    // Delete contractor document record from database
    await prisma.contractorDocument.delete({
      where: { id },
    });

    // Log activity
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        companyId: req.user.companyId,
        action: 'CONTRACTOR_DOCUMENT_DELETED',
        entityType: 'CONTRACTOR_DOCUMENT',
        entityId: id,
        oldData: {
          title: document.title,
          documentType: document.documentType,
          contractorId: document.contractorId,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Contractor document deleted successfully',
      data: {
        deletedId: id,
        title: document.title,
      },
    });
  } catch (error) {
    console.error('Delete contractor document error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const downloadContractorDocument = async (req, res) => {
  try {
    const { id } = req.params;

    // Check CONTRACTOR_DOCUMENT_READ permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_DOCUMENT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to download contractor documents',
      });
    }

    const document = await prisma.contractorDocument.findFirst({
      where: { id },
      include: {
        contractor: {
          select: {
            id: true,
            name: true,
            companyId: true,
          },
        },
      },
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Contractor document not found',
      });
    }

    // Check if contractor belongs to company
    if (document.contractor.companyId !== req.user.companyId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Check if document is public or user has access
    if (!document.isPublic) {
      // Check if user is document uploader, contractor creator, or admin
      const isDocumentUploader = document.uploadedById === req.user.userId;
      const contractor = await prisma.contractor.findFirst({
        where: { id: document.contractorId },
        select: { createdById: true },
      });

      const isContractorCreator = contractor?.createdById === req.user.userId;

      if (
        req.user.userType !== 'COMPANY_ADMIN' &&
        req.user.userType !== 'SUPER_ADMIN' &&
        !isDocumentUploader &&
        !isContractorCreator
      ) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this private document',
        });
      }
    }

    // For Cloudflare URLs, redirect to the public URL
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.USE_CLOUDFLARE !== 'false'
    ) {
      console.log('📁 Redirecting to Cloudflare R2 URL');
      return res.redirect(document.fileUrl);
    }

    // For local storage, serve the file directly
    console.log('📁 Serving contractor document locally');

    // Extract local path from URL
    let localPath;

    // Handle different URL formats
    if (document.fileUrl.includes('http://localhost:5000/uploads')) {
      // URL format: http://localhost:5000/uploads/contractor-documents/filename
      const urlParts = document.fileUrl.split('http://localhost:5000/uploads/');
      if (urlParts.length > 1) {
        localPath = path.join(__dirname, '../../uploads', urlParts[1]);
      }
    } else if (document.fileUrl.startsWith('/uploads/')) {
      // Direct path format: /uploads/contractor-documents/filename
      localPath = path.join(__dirname, '../..', document.fileUrl);
    } else {
      // Try to construct path from filename
      const fileName = document.fileUrl.split('/').pop();
      localPath = path.join(
        __dirname,
        '../../uploads/contractor-documents',
        fileName
      );
    }

    // Check if file exists
    const fs = await import('fs');
    if (!fs.existsSync(localPath)) {
      console.error('Contractor document not found at path:', localPath);
      return res.status(404).json({
        success: false,
        message: 'Contractor document file not found on server',
        debug: {
          originalUrl: document.fileUrl,
          resolvedPath: localPath,
          documentId: id,
        },
      });
    }

    // Determine filename for download
    const downloadFilename = document.title
      ? `${document.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${path.extname(localPath).replace('.', '')}`
      : `contractor_document_${id}${path.extname(localPath)}`;

    // Set appropriate headers
    res.setHeader(
      'Content-Type',
      document.fileType || 'application/octet-stream'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${downloadFilename}"`
    );

    // Send the file
    return res.sendFile(localPath);
  } catch (error) {
    console.error('Download contractor document error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Update Contractor Document Details
export const updateContractorDocumentDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, documentType, isPublic } = req.body;

    // Check CONTRACTOR_DOCUMENT_UPLOAD permission (same as upload)
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_DOCUMENT_UPLOAD'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update contractor documents',
      });
    }

    const document = await prisma.contractorDocument.findFirst({
      where: { id },
      include: {
        contractor: {
          select: {
            id: true,
            name: true,
            companyId: true,
          },
        },
      },
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Contractor document not found',
      });
    }

    // Check if contractor belongs to company
    if (document.contractor.companyId !== req.user.companyId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Check if user can update this document
    // Only document uploader, contractor creator, or admin can update
    const isDocumentUploader = document.uploadedById === req.user.userId;
    const contractor = await prisma.contractor.findFirst({
      where: { id: document.contractorId },
      select: { createdById: true },
    });

    const isContractorCreator = contractor?.createdById === req.user.userId;

    if (
      req.user.userType !== 'COMPANY_ADMIN' &&
      req.user.userType !== 'SUPER_ADMIN'
    ) {
      if (!isDocumentUploader && !isContractorCreator) {
        return res.status(403).json({
          success: false,
          message:
            'You can only update your own documents or documents from contractors you created',
        });
      }
    }

    const updatedDocument = await prisma.contractorDocument.update({
      where: { id },
      data: {
        title,
        description,
        documentType,
        isPublic: isPublic === true || isPublic === 'true',
      },
    });

    res.json({
      success: true,
      message: 'Contractor document details updated successfully',
      data: updatedDocument,
    });
  } catch (error) {
    console.error('Update contractor document details error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Contractor Document Statistics
export const getContractorDocumentStatistics = async (req, res) => {
  try {
    const { contractorId } = req.params;

    // Check CONTRACTOR_DOCUMENT_READ permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_DOCUMENT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message:
          'You do not have permission to view contractor document statistics',
      });
    }

    // Check if contractor exists and belongs to company
    const contractor = await prisma.contractor.findFirst({
      where: {
        id: contractorId,
        companyId: req.user.companyId,
      },
    });

    if (!contractor) {
      return res.status(404).json({
        success: false,
        message: 'Contractor not found',
      });
    }

    const [
      totalDocuments,
      documentsByType,
      documentsByProject,
      recentDocuments,
      totalSize,
    ] = await Promise.all([
      // Total documents count
      prisma.contractorDocument.count({
        where: { contractorId },
      }),

      // Documents grouped by type
      prisma.contractorDocument.groupBy({
        by: ['documentType'],
        where: { contractorId },
        _count: true,
      }),

      // Documents grouped by project
      prisma.contractorDocument.groupBy({
        by: ['contractorProjectId'],
        where: { contractorId },
        _count: true,
      }),

      // Recent documents (last 10)
      prisma.contractorDocument.findMany({
        where: { contractorId },
        include: {
          uploadedBy: {
            select: {
              id: true,
              name: true,
            },
          },
          contractorProject: {
            select: {
              id: true,
              title: true,
            },
          },
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      }),

      // Total file size
      prisma.contractorDocument.aggregate({
        where: { contractorId },
        _sum: {
          fileSize: true,
        },
      }),
    ]);

    // Get project details
    const projectIds = documentsByProject
      .filter((item) => item.contractorProjectId)
      .map((item) => item.contractorProjectId);

    const projects = await prisma.contractorProject.findMany({
      where: {
        id: { in: projectIds },
      },
      select: {
        id: true,
        title: true,
        projectCode: true,
      },
    });

    const projectMap = projects.reduce((acc, project) => {
      acc[project.id] = project;
      return acc;
    }, {});

    const statistics = {
      overview: {
        totalDocuments,
        totalSize: totalSize._sum.fileSize || 0,
        publicDocuments: await prisma.contractorDocument.count({
          where: { contractorId, isPublic: true },
        }),
      },
      byType: documentsByType.reduce((acc, item) => {
        acc[item.documentType] = item._count;
        return acc;
      }, {}),
      byProject: documentsByProject.map((item) => ({
        project: item.contractorProjectId
          ? projectMap[item.contractorProjectId] || {
              id: item.contractorProjectId,
              title: 'Unknown Project',
            }
          : { id: null, title: 'General Documents' },
        count: item._count,
      })),
      recentDocuments: recentDocuments.map((doc) => ({
        id: doc.id,
        title: doc.title,
        documentType: doc.documentType,
        uploadedBy: doc.uploadedBy.name,
        project: doc.contractorProject
          ? doc.contractorProject.title
          : 'General',
        uploadedAt: doc.createdAt,
        fileSize: doc.fileSize,
      })),
    };

    res.json({
      success: true,
      data: statistics,
    });
  } catch (error) {
    console.error('Get contractor document statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Document Types
export const getDocumentTypes = async (req, res) => {
  try {
    // Check CONTRACTOR_DOCUMENT_READ permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_DOCUMENT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view document types',
      });
    }

    // Get all unique document types used in the company
    const documentTypes = await prisma.contractorDocument.findMany({
      where: {
        contractor: {
          companyId: req.user.companyId,
        },
      },
      distinct: ['documentType'],
      select: {
        documentType: true,
      },
      orderBy: {
        documentType: 'asc',
      },
    });

    // Standard document types
    const standardDocumentTypes = [
      'CONTRACT',
      'PERMIT',
      'DRAWING',
      'REPORT',
      'INVOICE',
      'CERTIFICATE',
      'PHOTO',
      'AGREEMENT',
      'REGISTRATION',
      'GST_PROOF',
      'PAN_PROOF',
      'AADHAR_PROOF',
      'BANK_PROOF',
      'INSURANCE',
      'LICENSE',
      'OTHER',
    ];

    // Combine standard types with used types
    const allTypes = [
      ...standardDocumentTypes,
      ...documentTypes
        .map((doc) => doc.documentType)
        .filter((type) => !standardDocumentTypes.includes(type)),
    ];

    // Remove duplicates
    const uniqueTypes = [...new Set(allTypes)];

    res.json({
      success: true,
      data: uniqueTypes,
    });
  } catch (error) {
    console.error('Get document types error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Preview Contractor Document
export const previewContractorDocument = async (req, res) => {
  try {
    const { id } = req.params;

    // Check CONTRACTOR_DOCUMENT_READ permission
    const hasPermission = await checkSubcontractorPermission(
      req.user.userId,
      req.user.companyId,
      'CONTRACTOR_DOCUMENT_READ'
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to preview contractor documents',
      });
    }

    const document = await prisma.contractorDocument.findFirst({
      where: { id },
      include: {
        contractor: {
          select: {
            id: true,
            name: true,
            companyId: true,
          },
        },
      },
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Contractor document not found',
      });
    }

    // Check if contractor belongs to company
    if (document.contractor.companyId !== req.user.companyId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Check if document is public or user has access
    if (!document.isPublic) {
      // Check if user is document uploader, contractor creator, or admin
      const isDocumentUploader = document.uploadedById === req.user.userId;
      const contractor = await prisma.contractor.findFirst({
        where: { id: document.contractorId },
        select: { createdById: true },
      });

      const isContractorCreator = contractor?.createdById === req.user.userId;

      if (
        req.user.userType !== 'COMPANY_ADMIN' &&
        req.user.userType !== 'SUPER_ADMIN' &&
        !isDocumentUploader &&
        !isContractorCreator
      ) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this private document',
        });
      }
    }

    // Check if document is an image that can be previewed in browser
    const imageTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
    ];
    const pdfTypes = ['application/pdf'];

    if (imageTypes.includes(document.fileType)) {
      // For images, redirect to the file URL for preview
      return res.redirect(document.fileUrl);
    } else if (pdfTypes.includes(document.fileType)) {
      // For PDFs, we can serve them inline
      return res.redirect(document.fileUrl);
    } else {
      // For other file types, redirect to download
      return res.redirect(document.fileUrl);
    }
  } catch (error) {
    console.error('Preview contractor document error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};
