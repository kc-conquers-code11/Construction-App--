// src/controllers/supplier-document.controller.js
import prisma from '../config/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to check supplier permissions
const checkSupplierPermission = async (userId, companyId, permissionCode) => {
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
            rp.permission.code === 'FULL_COMPANY_ACCESS' ||
            rp.permission.code === 'SUPPLIER_ALL_ACCESS' ||
            rp.permission.code === 'SUPPLIER_DOCUMENT_ALL_ACCESS'
    );

    return hasPermission;
};

// Helper to log audit
const logAudit = async (userId, companyId, action, entityType, entityId, oldData, newData, req) => {
    await prisma.auditLog.create({
        data: {
            userId,
            companyId,
            action,
            entityType,
            entityId,
            oldData: oldData || null,
            newData: newData || null,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        },
    });
};

// ==================== DOCUMENT MANAGEMENT ====================

export const uploadSupplierDocument = async (req, res) => {
    try {
        const { supplierId } = req.params;
        const {
            title,
            description,
            documentType,
            documentNo,
            expiryDate,
        } = req.body;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_DOCUMENT_CREATE'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to upload documents',
            });
        }

        // Check if supplier exists
        const supplier = await prisma.supplier.findFirst({
            where: {
                id: supplierId,
                companyId: req.user.companyId,
            },
        });

        if (!supplier) {
            // Clean up uploaded file if supplier not found
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(404).json({
                success: false,
                message: 'Supplier not found',
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded',
            });
        }

        // Check for duplicate document number if provided
        if (documentNo) {
            const existingDoc = await prisma.supplierDocument.findFirst({
                where: {
                    supplierId,
                    documentNo,
                },
            });
            if (existingDoc) {
                // Clean up uploaded file
                fs.unlinkSync(req.file.path);
                return res.status(400).json({
                    success: false,
                    message: 'Document with this number already exists',
                });
            }
        }

        // Create document record
        const document = await prisma.supplierDocument.create({
            data: {
                supplierId,
                title,
                description,
                documentType,
                documentNo,
                fileUrl: req.file.path,
                fileType: req.file.mimetype,
                fileSize: req.file.size,
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                uploadedById: req.user.userId,
            },
        });

        // Log audit
        await logAudit(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_DOCUMENT_UPLOADED',
            'SUPPLIER_DOCUMENT',
            document.id,
            null,
            { title, documentType, fileName: req.file.originalname },
            req
        );

        res.status(201).json({
            success: true,
            message: 'Document uploaded successfully',
            data: {
                ...document,
                fileUrl: `/uploads/supplier-documents/${path.basename(document.fileUrl)}`,
            },
        });
    } catch (error) {
        // Clean up uploaded file on error
        if (req.file) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkError) {
                console.error('Error deleting file:', unlinkError);
            }
        }
        console.error('Upload supplier document error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const getSupplierDocuments = async (req, res) => {
    try {
        const { supplierId } = req.params;
        const {
            page = 1,
            limit = 10,
            documentType,
            isVerified,
            isExpiring,
            search = '',
            sortBy = 'createdAt',
            sortOrder = 'desc',
        } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_DOCUMENT_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view documents',
            });
        }

        // Check if supplier exists
        const supplier = await prisma.supplier.findFirst({
            where: {
                id: supplierId,
                companyId: req.user.companyId,
            },
        });

        if (!supplier) {
            return res.status(404).json({
                success: false,
                message: 'Supplier not found',
            });
        }

        const where = {
            supplierId,
        };

        if (documentType) where.documentType = documentType;
        if (isVerified !== undefined) where.isVerified = isVerified === 'true';
        if (search) {
            where.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
                { documentNo: { contains: search, mode: 'insensitive' } },
            ];
        }

        // Expiring documents filter (next 30 days)
        if (isExpiring === 'true') {
            const thirtyDaysFromNow = new Date();
            thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
            where.expiryDate = {
                not: null,
                lte: thirtyDaysFromNow,
                gte: new Date(),
            };
        }

        const [documents, total] = await Promise.all([
            prisma.supplierDocument.findMany({
                where,
                include: {
                    uploadedBy: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
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
                orderBy: { [sortBy]: sortOrder },
            }),
            prisma.supplierDocument.count({ where }),
        ]);

        // Transform file URLs
        const documentsWithUrls = documents.map(doc => ({
            ...doc,
            fileUrl: `/uploads/supplier-documents/${path.basename(doc.fileUrl)}`,
        }));

        res.json({
            success: true,
            data: documentsWithUrls,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error('Get supplier documents error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const getSupplierDocumentById = async (req, res) => {
    try {
        const { supplierId, docId } = req.params;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_DOCUMENT_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view documents',
            });
        }

        const document = await prisma.supplierDocument.findFirst({
            where: {
                id: docId,
                supplierId,
                supplier: {
                    companyId: req.user.companyId,
                },
            },
            include: {
                uploadedBy: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
                verifiedBy: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                supplier: {
                    select: {
                        id: true,
                        name: true,
                        supplierCode: true,
                    },
                },
            },
        });

        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document not found',
            });
        }

        // Transform file URL
        const documentWithUrl = {
            ...document,
            fileUrl: `/uploads/supplier-documents/${path.basename(document.fileUrl)}`,
        };

        res.json({
            success: true,
            data: documentWithUrl,
        });
    } catch (error) {
        console.error('Get supplier document error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const deleteSupplierDocument = async (req, res) => {
    try {
        const { supplierId, docId } = req.params;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_DOCUMENT_DELETE'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to delete documents',
            });
        }

        const document = await prisma.supplierDocument.findFirst({
            where: {
                id: docId,
                supplierId,
                supplier: {
                    companyId: req.user.companyId,
                },
            },
        });

        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document not found',
            });
        }

        // Delete physical file
        try {
            if (fs.existsSync(document.fileUrl)) {
                fs.unlinkSync(document.fileUrl);
            }
        } catch (fileError) {
            console.error('Error deleting file:', fileError);
            // Continue with database deletion even if file delete fails
        }

        // Delete database record
        await prisma.supplierDocument.delete({
            where: { id: docId },
        });

        // Log audit
        await logAudit(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_DOCUMENT_DELETED',
            'SUPPLIER_DOCUMENT',
            docId,
            { title: document.title, documentType: document.documentType },
            null,
            req
        );

        res.json({
            success: true,
            message: 'Document deleted successfully',
        });
    } catch (error) {
        console.error('Delete supplier document error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const downloadSupplierDocument = async (req, res) => {
    try {
        const { supplierId, docId } = req.params;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_DOCUMENT_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to download documents',
            });
        }

        const document = await prisma.supplierDocument.findFirst({
            where: {
                id: docId,
                supplierId,
                supplier: {
                    companyId: req.user.companyId,
                },
            },
        });

        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document not found',
            });
        }

        // Check if file exists
        if (!fs.existsSync(document.fileUrl)) {
            return res.status(404).json({
                success: false,
                message: 'File not found on server',
            });
        }

        // Set headers for download
        const filename = `${document.title}_${path.basename(document.fileUrl)}`;
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', document.fileType);

        // Stream file to response
        const fileStream = fs.createReadStream(document.fileUrl);
        fileStream.pipe(res);

        // Log download
        await logAudit(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_DOCUMENT_DOWNLOADED',
            'SUPPLIER_DOCUMENT',
            docId,
            null,
            { title: document.title },
            req
        );
    } catch (error) {
        console.error('Download supplier document error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

// ==================== DOCUMENT VERIFICATION ====================

export const verifySupplierDocument = async (req, res) => {
    try {
        const { docId } = req.params;
        const { isVerified, verificationNotes } = req.body;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_DOCUMENT_VERIFY'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to verify documents',
            });
        }

        const document = await prisma.supplierDocument.findFirst({
            where: {
                id: docId,
                supplier: {
                    companyId: req.user.companyId,
                },
            },
            include: {
                supplier: true,
            },
        });

        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document not found',
            });
        }

        const verifiedDocument = await prisma.supplierDocument.update({
            where: { id: docId },
            data: {
                isVerified,
                verifiedAt: new Date(),
                verifiedById: req.user.userId,
                description: verificationNotes
                    ? `${document.description || ''}\nVerification Notes: ${verificationNotes}`
                    : document.description,
            },
        });

        // Check if all required documents are verified
        if (isVerified) {
            const requiredDocs = ['GST_PROOF', 'PAN_PROOF', 'BANK_PROOF'];
            const verifiedDocs = await prisma.supplierDocument.count({
                where: {
                    supplierId: document.supplierId,
                    documentType: { in: requiredDocs },
                    isVerified: true,
                },
            });

            // If all required docs are verified, update supplier verification status
            if (verifiedDocs >= requiredDocs.length) {
                await prisma.supplier.update({
                    where: { id: document.supplierId },
                    data: {
                        verificationStatus: 'VERIFIED',
                        verifiedAt: new Date(),
                        verifiedById: req.user.userId,
                    },
                });
            }
        }

        // Log audit
        await logAudit(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_DOCUMENT_VERIFIED',
            'SUPPLIER_DOCUMENT',
            docId,
            { isVerified: document.isVerified },
            { isVerified, verificationNotes },
            req
        );

        res.json({
            success: true,
            message: `Document ${isVerified ? 'verified' : 'unverified'} successfully`,
            data: verifiedDocument,
        });
    } catch (error) {
        console.error('Verify supplier document error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

// ==================== DOCUMENT QUERIES ====================

export const getDocumentTypes = async (req, res) => {
    try {
        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_DOCUMENT_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view document types',
            });
        }

        // Get all document types from enum
        const documentTypes = Object.values(prisma.$Enums.DocumentType);

        // Get counts for each type
        const typeCounts = await prisma.supplierDocument.groupBy({
            by: ['documentType'],
            where: {
                supplier: {
                    companyId: req.user.companyId,
                },
            },
            _count: true,
        });

        const typeStats = documentTypes.map(type => {
            const stat = typeCounts.find(t => t.documentType === type);
            return {
                type,
                count: stat?._count || 0,
            };
        });

        res.json({
            success: true,
            data: typeStats,
        });
    } catch (error) {
        console.error('Get document types error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const getExpiringDocuments = async (req, res) => {
    try {
        const { days = 30 } = req.query;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_DOCUMENT_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view documents',
            });
        }

        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + parseInt(days));

        const expiringDocs = await prisma.supplierDocument.findMany({
            where: {
                supplier: {
                    companyId: req.user.companyId,
                },
                expiryDate: {
                    not: null,
                    lte: expiryDate,
                    gte: new Date(),
                },
                isVerified: true,
            },
            include: {
                supplier: {
                    select: {
                        id: true,
                        name: true,
                        supplierCode: true,
                        email: true,
                        phone: true,
                    },
                },
            },
            orderBy: { expiryDate: 'asc' },
        });

        // Group by supplier
        const groupedBySupplier = {};
        expiringDocs.forEach(doc => {
            const supplierId = doc.supplier.id;
            if (!groupedBySupplier[supplierId]) {
                groupedBySupplier[supplierId] = {
                    supplier: doc.supplier,
                    documents: [],
                };
            }
            groupedBySupplier[supplierId].documents.push({
                id: doc.id,
                title: doc.title,
                documentType: doc.documentType,
                documentNo: doc.documentNo,
                expiryDate: doc.expiryDate,
                daysRemaining: Math.ceil((doc.expiryDate - new Date()) / (1000 * 60 * 60 * 24)),
            });
        });

        res.json({
            success: true,
            data: {
                total: expiringDocs.length,
                suppliers: Object.values(groupedBySupplier),
            },
        });
    } catch (error) {
        console.error('Get expiring documents error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const getVerifiedDocuments = async (req, res) => {
    try {
        const { page = 1, limit = 10, supplierId } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_DOCUMENT_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view documents',
            });
        }

        const where = {
            supplier: {
                companyId: req.user.companyId,
            },
            isVerified: true,
        };

        if (supplierId) {
            where.supplierId = supplierId;
        }

        const [documents, total] = await Promise.all([
            prisma.supplierDocument.findMany({
                where,
                include: {
                    supplier: {
                        select: {
                            id: true,
                            name: true,
                            supplierCode: true,
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
                orderBy: { verifiedAt: 'desc' },
            }),
            prisma.supplierDocument.count({ where }),
        ]);

        // Transform file URLs
        const documentsWithUrls = documents.map(doc => ({
            ...doc,
            fileUrl: `/uploads/supplier-documents/${path.basename(doc.fileUrl)}`,
        }));

        res.json({
            success: true,
            data: documentsWithUrls,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error('Get verified documents error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};