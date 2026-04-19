// src/controllers/supplier.controller.js
import prisma from '../config/database.js';

// Helper function to check supplier permissions
export const checkSupplierPermission = async (userId, companyId, permissionCode) => {
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
            rp.permission.code === 'SUPPLIER_ALL_ACCESS'
    );

    return hasPermission;
};

// Helper to generate supplier code
const generateSupplierCode = async (companyId) => {
    const year = new Date().getFullYear();
    const count = await prisma.supplier.count({
        where: {
            companyId,
            createdAt: {
                gte: new Date(year, 0, 1),
                lt: new Date(year + 1, 0, 1),
            },
        },
    });
    return `SUP-${year}-${String(count + 1).padStart(4, '0')}`;
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

// ==================== SUPPLIER CORE CRUD ====================

export const createSupplier = async (req, res) => {
    try {
        const {
            name,
            type,
            subtypes,
            contactPerson,
            email,
            phone,
            alternatePhone,
            whatsapp,
            website,
            address,
            city,
            state,
            country,
            pincode,
            gstNumber,
            panNumber,
            tanNumber,
            cinNumber,
            msmeNumber,
            businessType,
            yearEstablished,
            bankName,
            bankAccount,
            bankIfsc,
            bankBranch,
            upiId,
            defaultPaymentTerm,
            creditLimit,
            creditDays,
            notes,
            tags,
        } = req.body;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_CREATE'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to create suppliers',
            });
        }

        // Check if supplier with same GST or PAN exists
        if (gstNumber) {
            const existingGST = await prisma.supplier.findFirst({
                where: {
                    companyId: req.user.companyId,
                    gstNumber,
                },
            });
            if (existingGST) {
                return res.status(400).json({
                    success: false,
                    message: 'Supplier with this GST number already exists',
                });
            }
        }

        if (panNumber) {
            const existingPAN = await prisma.supplier.findFirst({
                where: {
                    companyId: req.user.companyId,
                    panNumber,
                },
            });
            if (existingPAN) {
                return res.status(400).json({
                    success: false,
                    message: 'Supplier with this PAN number already exists',
                });
            }
        }

        // Check if phone is unique
        const existingPhone = await prisma.supplier.findFirst({
            where: {
                companyId: req.user.companyId,
                phone,
            },
        });
        if (existingPhone) {
            return res.status(400).json({
                success: false,
                message: 'Supplier with this phone number already exists',
            });
        }

        // Generate supplier code
        const supplierCode = await generateSupplierCode(req.user.companyId);

        const supplier = await prisma.supplier.create({
            data: {
                companyId: req.user.companyId,
                supplierCode,
                name,
                type,
                subtypes: subtypes || [],
                contactPerson,
                email,
                phone,
                alternatePhone,
                whatsapp,
                website,
                address,
                city,
                state,
                country: country || 'India',
                pincode,
                gstNumber,
                panNumber,
                tanNumber,
                cinNumber,
                msmeNumber,
                businessType,
                yearEstablished: yearEstablished ? parseInt(yearEstablished) : null,
                bankName,
                bankAccount,
                bankIfsc,
                bankBranch,
                upiId,
                defaultPaymentTerm: defaultPaymentTerm || 'NET_30',
                creditLimit: creditLimit ? parseFloat(creditLimit) : 0,
                creditDays: creditDays ? parseInt(creditDays) : 30,
                notes,
                tags: tags || [],
                status: 'ACTIVE',
                verificationStatus: 'PENDING',
                createdById: req.user.userId,
            },
        });

        // Log audit
        await logAudit(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_CREATED',
            'SUPPLIER',
            supplier.id,
            null,
            { name, supplierCode, type },
            req
        );

        res.status(201).json({
            success: true,
            message: 'Supplier created successfully',
            data: supplier,
        });
    } catch (error) {
        console.error('Create supplier error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const getAllSuppliers = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            status,
            type,
            verificationStatus,
            city,
            state,
            minRating,
            tags,
            sortBy = 'createdAt',
            sortOrder = 'desc',
        } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view suppliers',
            });
        }

        const where = {
            companyId: req.user.companyId,
        };

        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { supplierCode: { contains: search, mode: 'insensitive' } },
                { contactPerson: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
                { gstNumber: { contains: search, mode: 'insensitive' } },
                { panNumber: { contains: search, mode: 'insensitive' } },
                { city: { contains: search, mode: 'insensitive' } },
            ];
        }

        if (status) where.status = status;
        if (type) where.type = type;
        if (verificationStatus) where.verificationStatus = verificationStatus;
        if (city) where.city = { contains: city, mode: 'insensitive' };
        if (state) where.state = { contains: state, mode: 'insensitive' };
        if (minRating) where.rating = { gte: parseFloat(minRating) };
        if (tags) {
            const tagArray = tags.split(',');
            where.tags = { hasSome: tagArray };
        }

        const [suppliers, total] = await Promise.all([
            prisma.supplier.findMany({
                where,
                include: {
                    _count: {
                        select: {
                            purchaseOrders: true,
                            documents: true,
                        },
                    },
                    createdBy: {
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
                orderBy: { [sortBy]: sortOrder },
            }),
            prisma.supplier.count({ where }),
        ]);

        res.json({
            success: true,
            data: suppliers,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error('Get suppliers error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const getSupplierById = async (req, res) => {
    try {
        const { id } = req.params;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view supplier details',
            });
        }

        const supplier = await prisma.supplier.findFirst({
            where: {
                id,
                companyId: req.user.companyId,
            },
            include: {
                purchaseOrders: {
                    take: 10,
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        poNumber: true,
                        title: true,
                        totalAmount: true,
                        status: true,
                        orderDate: true,
                    },
                },
                documents: {
                    select: {
                        id: true,
                        title: true,
                        documentType: true,
                        fileUrl: true,
                        isVerified: true,
                        expiryDate: true,
                        createdAt: true,
                    },
                },
                createdBy: {
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
                        email: true,
                    },
                },
                blacklistedBy: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                _count: {
                    select: {
                        purchaseOrders: true,
                        documents: true,
                    },
                },
            },
        });

        if (!supplier) {
            return res.status(404).json({
                success: false,
                message: 'Supplier not found',
            });
        }

        // Calculate additional metrics
        const poStats = await prisma.purchaseOrder.aggregate({
            where: {
                supplierId: id,
                companyId: req.user.companyId,
            },
            _sum: {
                totalAmount: true,
            },
            _count: true,
        });

        const completedPOs = await prisma.purchaseOrder.count({
            where: {
                supplierId: id,
                status: 'RECEIVED',
            },
        });

        const onTimeDeliveries = await prisma.purchaseOrder.count({
            where: {
                supplierId: id,
                status: 'RECEIVED',
                actualDelivery: {
                    lte: prisma.purchaseOrder.fields.expectedDelivery,
                },
            },
        });

        const supplierData = {
            ...supplier,
            stats: {
                totalOrders: poStats._count || 0,
                totalSpent: poStats._sum?.totalAmount || 0,
                completedOrders: completedPOs,
                pendingOrders: (poStats._count || 0) - completedPOs,
                onTimeDeliveryRate: completedPOs > 0 ? (onTimeDeliveries / completedPOs) * 100 : 0,
            },
        };

        res.json({
            success: true,
            data: supplierData,
        });
    } catch (error) {
        console.error('Get supplier error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const updateSupplier = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            name,
            type,
            subtypes,
            contactPerson,
            email,
            phone,
            alternatePhone,
            whatsapp,
            website,
            address,
            city,
            state,
            country,
            pincode,
            gstNumber,
            panNumber,
            tanNumber,
            cinNumber,
            msmeNumber,
            businessType,
            yearEstablished,
            bankName,
            bankAccount,
            bankIfsc,
            bankBranch,
            upiId,
            defaultPaymentTerm,
            creditLimit,
            creditDays,
            notes,
            tags,
        } = req.body;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_UPDATE'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to update suppliers',
            });
        }

        const existingSupplier = await prisma.supplier.findFirst({
            where: {
                id,
                companyId: req.user.companyId,
            },
        });

        if (!existingSupplier) {
            return res.status(404).json({
                success: false,
                message: 'Supplier not found',
            });
        }

        // Check uniqueness constraints if fields are being changed
        if (gstNumber && gstNumber !== existingSupplier.gstNumber) {
            const existingGST = await prisma.supplier.findFirst({
                where: {
                    companyId: req.user.companyId,
                    gstNumber,
                    id: { not: id },
                },
            });
            if (existingGST) {
                return res.status(400).json({
                    success: false,
                    message: 'Supplier with this GST number already exists',
                });
            }
        }

        if (panNumber && panNumber !== existingSupplier.panNumber) {
            const existingPAN = await prisma.supplier.findFirst({
                where: {
                    companyId: req.user.companyId,
                    panNumber,
                    id: { not: id },
                },
            });
            if (existingPAN) {
                return res.status(400).json({
                    success: false,
                    message: 'Supplier with this PAN number already exists',
                });
            }
        }

        if (phone && phone !== existingSupplier.phone) {
            const existingPhone = await prisma.supplier.findFirst({
                where: {
                    companyId: req.user.companyId,
                    phone,
                    id: { not: id },
                },
            });
            if (existingPhone) {
                return res.status(400).json({
                    success: false,
                    message: 'Supplier with this phone number already exists',
                });
            }
        }

        const updatedSupplier = await prisma.supplier.update({
            where: { id },
            data: {
                name,
                type,
                subtypes,
                contactPerson,
                email,
                phone,
                alternatePhone,
                whatsapp,
                website,
                address,
                city,
                state,
                country,
                pincode,
                gstNumber,
                panNumber,
                tanNumber,
                cinNumber,
                msmeNumber,
                businessType,
                yearEstablished: yearEstablished ? parseInt(yearEstablished) : null,
                bankName,
                bankAccount,
                bankIfsc,
                bankBranch,
                upiId,
                defaultPaymentTerm,
                creditLimit: creditLimit ? parseFloat(creditLimit) : null,
                creditDays: creditDays ? parseInt(creditDays) : null,
                notes,
                tags,
            },
        });

        // Log audit
        await logAudit(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_UPDATED',
            'SUPPLIER',
            id,
            {
                name: existingSupplier.name,
                email: existingSupplier.email,
                phone: existingSupplier.phone,
            },
            { name, email, phone },
            req
        );

        res.json({
            success: true,
            message: 'Supplier updated successfully',
            data: updatedSupplier,
        });
    } catch (error) {
        console.error('Update supplier error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const deleteSupplier = async (req, res) => {
    try {
        const { id } = req.params;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_DELETE'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to delete suppliers',
            });
        }

        const supplier = await prisma.supplier.findFirst({
            where: {
                id,
                companyId: req.user.companyId,
            },
            include: {
                purchaseOrders: {
                    where: {
                        status: { notIn: ['CANCELLED', 'CLOSED'] },
                    },
                },
            },
        });

        if (!supplier) {
            return res.status(404).json({
                success: false,
                message: 'Supplier not found',
            });
        }

        // Check if supplier has active purchase orders
        if (supplier.purchaseOrders.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete supplier with active purchase orders',
            });
        }

        // Soft delete or actual delete based on requirements
        // Here we're doing a soft delete by updating status
        await prisma.supplier.update({
            where: { id },
            data: {
                status: 'INACTIVE',
                // Or for actual delete:
                // isDeleted: true,
                // deletedAt: new Date(),
            },
        });

        // Log audit
        await logAudit(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_DELETED',
            'SUPPLIER',
            id,
            { name: supplier.name, supplierCode: supplier.supplierCode },
            null,
            req
        );

        res.json({
            success: true,
            message: 'Supplier deleted successfully',
        });
    } catch (error) {
        console.error('Delete supplier error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const updateSupplierStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, reason } = req.body;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_UPDATE'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to update supplier status',
            });
        }

        const supplier = await prisma.supplier.findFirst({
            where: {
                id,
                companyId: req.user.companyId,
            },
        });

        if (!supplier) {
            return res.status(404).json({
                success: false,
                message: 'Supplier not found',
            });
        }

        const updateData = {
            status,
        };

        // Handle specific status transitions
        if (status === 'BLACKLISTED') {
            updateData.blacklistReason = reason;
            updateData.blacklistedAt = new Date();
            updateData.blacklistedById = req.user.userId;
        } else if (status === 'ACTIVE' && supplier.status === 'BLACKLISTED') {
            updateData.blacklistReason = null;
            updateData.blacklistedAt = null;
            updateData.blacklistedById = null;
        }

        const updatedSupplier = await prisma.supplier.update({
            where: { id },
            data: updateData,
        });

        // Log audit
        await logAudit(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_STATUS_UPDATED',
            'SUPPLIER',
            id,
            { status: supplier.status },
            { status, reason },
            req
        );

        res.json({
            success: true,
            message: `Supplier status updated to ${status}`,
            data: updatedSupplier,
        });
    } catch (error) {
        console.error('Update supplier status error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const verifySupplier = async (req, res) => {
    try {
        const { id } = req.params;
        const { verificationStatus, notes } = req.body;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_VERIFY'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to verify suppliers',
            });
        }

        const supplier = await prisma.supplier.findFirst({
            where: {
                id,
                companyId: req.user.companyId,
            },
        });

        if (!supplier) {
            return res.status(404).json({
                success: false,
                message: 'Supplier not found',
            });
        }

        const verifiedSupplier = await prisma.supplier.update({
            where: { id },
            data: {
                verificationStatus,
                verifiedAt: new Date(),
                verifiedById: req.user.userId,
                notes: notes ? `${supplier.notes || ''}\nVerification Notes: ${notes}` : supplier.notes,
            },
        });

        // Log audit
        await logAudit(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_VERIFIED',
            'SUPPLIER',
            id,
            { verificationStatus: supplier.verificationStatus },
            { verificationStatus, notes },
            req
        );

        res.json({
            success: true,
            message: `Supplier ${verificationStatus.toLowerCase()}`,
            data: verifiedSupplier,
        });
    } catch (error) {
        console.error('Verify supplier error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const blacklistSupplier = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_BLACKLIST'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to blacklist suppliers',
            });
        }

        const supplier = await prisma.supplier.findFirst({
            where: {
                id,
                companyId: req.user.companyId,
            },
        });

        if (!supplier) {
            return res.status(404).json({
                success: false,
                message: 'Supplier not found',
            });
        }

        const blacklistedSupplier = await prisma.supplier.update({
            where: { id },
            data: {
                status: 'BLACKLISTED',
                blacklistReason: reason,
                blacklistedAt: new Date(),
                blacklistedById: req.user.userId,
            },
        });

        // Log audit
        await logAudit(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_BLACKLISTED',
            'SUPPLIER',
            id,
            { status: supplier.status },
            { reason },
            req
        );

        res.json({
            success: true,
            message: 'Supplier blacklisted successfully',
            data: blacklistedSupplier,
        });
    } catch (error) {
        console.error('Blacklist supplier error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const getSupplierStats = async (req, res) => {
    try {
        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view supplier stats',
            });
        }

        // Get overall supplier statistics
        const [
            totalSuppliers,
            activeSuppliers,
            blacklistedSuppliers,
            pendingVerification,
            typeBreakdown,
            statusBreakdown,
            topRated,
        ] = await Promise.all([
            prisma.supplier.count({ where: { companyId: req.user.companyId } }),
            prisma.supplier.count({ where: { companyId: req.user.companyId, status: 'ACTIVE' } }),
            prisma.supplier.count({ where: { companyId: req.user.companyId, status: 'BLACKLISTED' } }),
            prisma.supplier.count({ where: { companyId: req.user.companyId, verificationStatus: 'PENDING' } }),
            prisma.supplier.groupBy({
                by: ['type'],
                where: { companyId: req.user.companyId },
                _count: true,
            }),
            prisma.supplier.groupBy({
                by: ['status'],
                where: { companyId: req.user.companyId },
                _count: true,
            }),
            prisma.supplier.findMany({
                where: { companyId: req.user.companyId, rating: { not: null } },
                orderBy: { rating: 'desc' },
                take: 5,
                select: {
                    id: true,
                    name: true,
                    supplierCode: true,
                    rating: true,
                },
            }),
        ]);

        // Get purchase order stats
        const poStats = await prisma.purchaseOrder.aggregate({
            where: {
                companyId: req.user.companyId,
                supplierId: { not: null },
            },
            _sum: {
                totalAmount: true,
            },
            _count: true,
        });

        const stats = {
            overview: {
                total: totalSuppliers,
                active: activeSuppliers,
                blacklisted: blacklistedSuppliers,
                pendingVerification,
                activePercentage: totalSuppliers > 0 ? (activeSuppliers / totalSuppliers) * 100 : 0,
            },
            purchaseOrders: {
                total: poStats._count || 0,
                totalSpent: poStats._sum?.totalAmount || 0,
            },
            typeBreakdown: typeBreakdown.map(t => ({
                type: t.type,
                count: t._count,
            })),
            statusBreakdown: statusBreakdown.map(s => ({
                status: s.status,
                count: s._count,
            })),
            topRatedSuppliers: topRated,
        };

        res.json({
            success: true,
            data: stats,
        });
    } catch (error) {
        console.error('Get supplier stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const searchSuppliers = async (req, res) => {
    try {
        const {
            q = '',
            page = 1,
            limit = 10,
            status,
            type,
            city,
            state,
            minRating,
            tags,
        } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to search suppliers',
            });
        }

        const where = {
            companyId: req.user.companyId,
            OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { supplierCode: { contains: q, mode: 'insensitive' } },
                { contactPerson: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q, mode: 'insensitive' } },
                { gstNumber: { contains: q, mode: 'insensitive' } },
                { panNumber: { contains: q, mode: 'insensitive' } },
                { city: { contains: q, mode: 'insensitive' } },
                { notes: { contains: q, mode: 'insensitive' } },
            ],
        };

        if (status) where.status = status;
        if (type) where.type = type;
        if (city) where.city = { contains: city, mode: 'insensitive' };
        if (state) where.state = { contains: state, mode: 'insensitive' };
        if (minRating) where.rating = { gte: parseFloat(minRating) };
        if (tags) {
            const tagArray = tags.split(',');
            where.tags = { hasSome: tagArray };
        }

        const [suppliers, total] = await Promise.all([
            prisma.supplier.findMany({
                where,
                select: {
                    id: true,
                    supplierCode: true,
                    name: true,
                    type: true,
                    contactPerson: true,
                    email: true,
                    phone: true,
                    city: true,
                    state: true,
                    gstNumber: true,
                    rating: true,
                    status: true,
                    verificationStatus: true,
                    _count: {
                        select: {
                            purchaseOrders: true,
                        },
                    },
                },
                skip,
                take: parseInt(limit),
                orderBy: [
                    { rating: 'desc' },
                    { name: 'asc' },
                ],
            }),
            prisma.supplier.count({ where }),
        ]);

        // Add relevance score
        const resultsWithScore = suppliers.map(supplier => {
            let score = 0;
            const searchLower = q.toLowerCase();

            if (supplier.supplierCode.toLowerCase().includes(searchLower)) score += 10;
            if (supplier.name.toLowerCase().includes(searchLower)) score += 8;
            if (supplier.contactPerson?.toLowerCase().includes(searchLower)) score += 5;
            if (supplier.email?.toLowerCase().includes(searchLower)) score += 4;
            if (supplier.phone?.includes(searchLower)) score += 3;
            if (supplier.city?.toLowerCase().includes(searchLower)) score += 2;
            if (supplier.gstNumber?.toLowerCase().includes(searchLower)) score += 6;

            return { ...supplier, relevanceScore: score };
        });

        // Sort by relevance score
        resultsWithScore.sort((a, b) => b.relevanceScore - a.relevanceScore);

        res.json({
            success: true,
            data: resultsWithScore,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error('Search suppliers error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};