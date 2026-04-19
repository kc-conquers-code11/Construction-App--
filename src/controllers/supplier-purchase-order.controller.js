// src/controllers/supplier-purchase-order.controller.js
import prisma from '../config/database.js';
import { checkSupplierPermission } from './supplier.controller.js';

export const getSupplierPOs = async (req, res) => {
    try {
        const { supplierId } = req.params;
        const {
            page = 1,
            limit = 10,
            status,
            fromDate,
            toDate,
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
                message: 'You do not have permission to view supplier POs',
            });
        }

        // Verify supplier belongs to company
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
            companyId: req.user.companyId,
        };

        if (status) where.status = status;
        if (fromDate || toDate) {
            where.orderDate = {};
            if (fromDate) where.orderDate.gte = new Date(fromDate);
            if (toDate) where.orderDate.lte = new Date(toDate);
        }

        const [pos, total] = await Promise.all([
            prisma.purchaseOrder.findMany({
                where,
                include: {
                    project: {
                        select: {
                            id: true,
                            name: true,
                            projectId: true,
                        },
                    },
                    items: {
                        select: {
                            id: true,
                            description: true,
                            quantity: true,
                            unit: true,
                            unitPrice: true,
                            totalPrice: true,
                            receivedQuantity: true,
                            pendingQuantity: true,
                        },
                    },
                    _count: {
                        select: {
                            receipts: true,
                            payments: true,
                        },
                    },
                },
                skip,
                take: parseInt(limit),
                orderBy: { [sortBy]: sortOrder },
            }),
            prisma.purchaseOrder.count({ where }),
        ]);

        // Calculate summary
        const summary = {
            totalPOs: total,
            totalAmount: pos.reduce((sum, po) => sum + po.totalAmount, 0),
            pendingAmount: pos.reduce((sum, po) => sum + (po.totalDue || 0), 0),
            paidAmount: pos.reduce((sum, po) => sum + (po.totalPaid || 0), 0),
            statusBreakdown: {},
        };

        pos.forEach(po => {
            summary.statusBreakdown[po.status] = (summary.statusBreakdown[po.status] || 0) + 1;
        });

        res.json({
            success: true,
            data: {
                pos,
                summary,
            },
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error('Get supplier POs error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const getSupplierPOById = async (req, res) => {
    try {
        const { supplierId, poId } = req.params;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view PO details',
            });
        }

        const po = await prisma.purchaseOrder.findFirst({
            where: {
                id: poId,
                supplierId,
                companyId: req.user.companyId,
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
                items: {
                    include: {
                        material: {
                            select: {
                                id: true,
                                name: true,
                                materialCode: true,
                                unit: true,
                            },
                        },
                        receipts: {
                            include: {
                                goodsReceipt: {
                                    select: {
                                        id: true,
                                        grNumber: true,
                                        receiptDate: true,
                                    },
                                },
                            },
                        },
                    },
                    orderBy: { lineNo: 'asc' },
                },
                receipts: {
                    include: {
                        receivedBy: {
                            select: { id: true, name: true },
                        },
                        items: true,
                    },
                    orderBy: { receiptDate: 'desc' },
                },
                payments: {
                    include: {
                        createdBy: {
                            select: { id: true, name: true },
                        },
                    },
                    orderBy: { paymentDate: 'desc' },
                },
                documents: {
                    include: {
                        uploadedBy: {
                            select: { id: true, name: true },
                        },
                    },
                },
            },
        });

        if (!po) {
            return res.status(404).json({
                success: false,
                message: 'Purchase order not found',
            });
        }

        res.json({
            success: true,
            data: po,
        });
    } catch (error) {
        console.error('Get supplier PO by ID error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const getSupplierPODetails = async (req, res) => {
    try {
        const { supplierId, poId } = req.params;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view PO details',
            });
        }

        const po = await prisma.purchaseOrder.findFirst({
            where: {
                id: poId,
                supplierId,
                companyId: req.user.companyId,
            },
            include: {
                project: {
                    select: {
                        id: true,
                        name: true,
                        projectId: true,
                        location: true,
                        address: true,
                    },
                },
                items: {
                    include: {
                        material: {
                            select: {
                                id: true,
                                name: true,
                                materialCode: true,
                                unit: true,
                                stockQuantity: true,
                            },
                        },
                        receipts: {
                            include: {
                                goodsReceipt: {
                                    select: {
                                        id: true,
                                        grNumber: true,
                                        receiptDate: true,
                                        receivedBy: {
                                            select: { name: true },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    orderBy: { lineNo: 'asc' },
                },
                receipts: {
                    include: {
                        receivedBy: {
                            select: { id: true, name: true },
                        },
                        items: {
                            include: {
                                poItem: {
                                    select: {
                                        description: true,
                                        unit: true,
                                    },
                                },
                            },
                        },
                    },
                    orderBy: { receiptDate: 'desc' },
                },
                payments: {
                    include: {
                        createdBy: {
                            select: { id: true, name: true },
                        },
                        approvedBy: {
                            select: { id: true, name: true },
                        },
                    },
                    orderBy: { paymentDate: 'desc' },
                },
                documents: {
                    include: {
                        uploadedBy: {
                            select: { id: true, name: true },
                        },
                    },
                },
                history: {
                    include: {
                        performedBy: {
                            select: { id: true, name: true },
                        },
                    },
                    orderBy: { performedAt: 'desc' },
                    take: 20,
                },
            },
        });

        if (!po) {
            return res.status(404).json({
                success: false,
                message: 'Purchase order not found',
            });
        }

        // Calculate delivery performance
        const deliveryStats = {
            totalItems: po.items.length,
            fullyReceived: po.items.filter(i => i.receivedQuantity >= i.quantity).length,
            partiallyReceived: po.items.filter(i => i.receivedQuantity > 0 && i.receivedQuantity < i.quantity).length,
            notReceived: po.items.filter(i => i.receivedQuantity === 0).length,
            onTimeDelivery: po.actualDelivery && po.expectedDelivery ?
                po.actualDelivery <= po.expectedDelivery : null,
        };

        const responseData = {
            ...po,
            deliveryStats,
        };

        res.json({
            success: true,
            data: responseData,
        });
    } catch (error) {
        console.error('Get supplier PO details error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const getSupplierPODashboard = async (req, res) => {
    try {
        const { supplierId } = req.params;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view dashboard',
            });
        }

        // Get current date range (last 12 months)
        const endDate = new Date();
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 11);

        const [
            poStats,
            monthlyStats,
            statusBreakdown,
            recentPOs,
            paymentStats,
            deliveryStats,
        ] = await Promise.all([
            // Overall PO statistics
            prisma.purchaseOrder.aggregate({
                where: {
                    supplierId,
                    companyId: req.user.companyId,
                },
                _count: true,
                _sum: {
                    totalAmount: true,
                    totalPaid: true,
                    totalDue: true,
                },
                _avg: {
                    totalAmount: true,
                },
            }),

            // Monthly statistics
            prisma.$queryRaw`
                SELECT 
                    DATE_TRUNC('month', "orderDate") as month,
                    COUNT(*) as count,
                    SUM("totalAmount") as total_amount,
                    SUM("totalPaid") as total_paid
                FROM "PurchaseOrder"
                WHERE "supplierId" = ${supplierId}
                    AND "companyId" = ${req.user.companyId}
                    AND "orderDate" >= ${startDate}
                GROUP BY DATE_TRUNC('month', "orderDate")
                ORDER BY month DESC
            `,

            // Status breakdown
            prisma.purchaseOrder.groupBy({
                by: ['status'],
                where: {
                    supplierId,
                    companyId: req.user.companyId,
                },
                _count: true,
                _sum: {
                    totalAmount: true,
                },
            }),

            // Recent POs
            prisma.purchaseOrder.findMany({
                where: {
                    supplierId,
                    companyId: req.user.companyId,
                },
                take: 5,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    poNumber: true,
                    title: true,
                    totalAmount: true,
                    status: true,
                    orderDate: true,
                    expectedDelivery: true,
                },
            }),

            // Payment statistics
            prisma.purchaseOrder.aggregate({
                where: {
                    supplierId,
                    companyId: req.user.companyId,
                    status: { in: ['PAID', 'PARTIALLY_PAID'] },
                },
                _sum: {
                    totalPaid: true,
                },
                _count: true,
            }),

            // Delivery statistics
            prisma.purchaseOrder.aggregate({
                where: {
                    supplierId,
                    companyId: req.user.companyId,
                    status: 'RECEIVED',
                    actualDelivery: { not: null },
                    expectedDelivery: { not: null },
                },
                _count: true,
            }),
        ]);

        // Calculate on-time delivery rate
        const onTimeDeliveries = await prisma.purchaseOrder.count({
            where: {
                supplierId,
                companyId: req.user.companyId,
                status: 'RECEIVED',
                actualDelivery: { lte: prisma.purchaseOrder.fields.expectedDelivery },
            },
        });

        const dashboard = {
            overview: {
                totalPOs: poStats._count || 0,
                totalAmount: poStats._sum?.totalAmount || 0,
                totalPaid: poStats._sum?.totalPaid || 0,
                totalDue: poStats._sum?.totalDue || 0,
                averagePOAmount: poStats._avg?.totalAmount || 0,
                paymentRate: poStats._sum?.totalAmount ?
                    ((poStats._sum?.totalPaid || 0) / poStats._sum?.totalAmount * 100).toFixed(2) : 0,
            },
            monthlyTrends: monthlyStats,
            statusBreakdown: statusBreakdown.map(s => ({
                status: s.status,
                count: s._count,
                amount: s._sum.totalAmount || 0,
            })),
            recentPOs,
            paymentStats: {
                totalPayments: paymentStats._count || 0,
                totalPaid: paymentStats._sum?.totalPaid || 0,
            },
            deliveryStats: {
                totalDelivered: deliveryStats._count || 0,
                onTimeDeliveries,
                onTimeRate: deliveryStats._count > 0 ?
                    (onTimeDeliveries / deliveryStats._count * 100).toFixed(2) : 0,
            },
        };

        res.json({
            success: true,
            data: dashboard,
        });
    } catch (error) {
        console.error('Get supplier PO dashboard error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const getSupplierPOAnalytics = async (req, res) => {
    try {
        const { supplierId } = req.params;
        const { fromDate, toDate } = req.query;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view analytics',
            });
        }

        const dateFilter = {};
        if (fromDate) dateFilter.gte = new Date(fromDate);
        if (toDate) dateFilter.lte = new Date(toDate);

        const where = {
            supplierId,
            companyId: req.user.companyId,
            ...(Object.keys(dateFilter).length > 0 && { orderDate: dateFilter }),
        };

        const [
            totalStats,
            categoryBreakdown,
            monthlyTrend,
            paymentTrend,
            materialBreakdown,
        ] = await Promise.all([
            // Overall statistics
            prisma.purchaseOrder.aggregate({
                where,
                _count: true,
                _sum: {
                    totalAmount: true,
                    totalPaid: true,
                    totalDue: true,
                },
                _avg: {
                    totalAmount: true,
                },
            }),

            // Category breakdown
            prisma.purchaseOrder.groupBy({
                by: ['type'],
                where,
                _count: true,
                _sum: {
                    totalAmount: true,
                },
            }),

            // Monthly trend
            prisma.$queryRaw`
                SELECT 
                    DATE_TRUNC('month', "orderDate") as month,
                    COUNT(*) as order_count,
                    SUM("totalAmount") as total_amount,
                    SUM("totalPaid") as total_paid
                FROM "PurchaseOrder"
                WHERE "supplierId" = ${supplierId}
                    AND "companyId" = ${req.user.companyId}
                    ${fromDate ? sql`AND "orderDate" >= ${new Date(fromDate)}` : sql``}
                    ${toDate ? sql`AND "orderDate" <= ${new Date(toDate)}` : sql``}
                GROUP BY DATE_TRUNC('month', "orderDate")
                ORDER BY month ASC
            `,

            // Payment trend
            prisma.$queryRaw`
                SELECT 
                    DATE_TRUNC('month', "paymentDate") as month,
                    COUNT(*) as payment_count,
                    SUM(amount) as total_paid
                FROM "PurchaseOrderPayment" pop
                JOIN "PurchaseOrder" po ON pop."purchaseOrderId" = po.id
                WHERE po."supplierId" = ${supplierId}
                    AND po."companyId" = ${req.user.companyId}
                    ${fromDate ? sql`AND pop."paymentDate" >= ${new Date(fromDate)}` : sql``}
                    ${toDate ? sql`AND pop."paymentDate" <= ${new Date(toDate)}` : sql``}
                GROUP BY DATE_TRUNC('month', pop."paymentDate")
                ORDER BY month ASC
            `,

            // Material breakdown (through items)
            prisma.purchaseOrderItem.groupBy({
                by: ['materialId'],
                where: {
                    purchaseOrder: {
                        supplierId,
                        companyId: req.user.companyId,
                        ...(Object.keys(dateFilter).length > 0 && { orderDate: dateFilter }),
                    },
                },
                _sum: {
                    quantity: true,
                    totalPrice: true,
                },
                _count: true,
                take: 10,
                orderBy: {
                    _sum: {
                        totalPrice: 'desc',
                    },
                },
            }),
        ]);

        // Get material details for breakdown
        const materialDetails = await prisma.material.findMany({
            where: {
                id: { in: materialBreakdown.map(m => m.materialId).filter(Boolean) },
            },
            select: {
                id: true,
                name: true,
                materialCode: true,
            },
        });

        const materialMap = Object.fromEntries(
            materialDetails.map(m => [m.id, m])
        );

        const analytics = {
            summary: {
                totalOrders: totalStats._count || 0,
                totalAmount: totalStats._sum?.totalAmount || 0,
                totalPaid: totalStats._sum?.totalPaid || 0,
                totalDue: totalStats._sum?.totalDue || 0,
                averageOrderValue: totalStats._avg?.totalAmount || 0,
            },
            categoryBreakdown: categoryBreakdown.map(c => ({
                type: c.type,
                count: c._count,
                amount: c._sum.totalAmount || 0,
            })),
            monthlyTrend,
            paymentTrend,
            topMaterials: materialBreakdown.map(m => ({
                material: m.materialId ? materialMap[m.materialId] : null,
                quantity: m._sum.quantity || 0,
                amount: m._sum.totalPrice || 0,
                orderCount: m._count,
            })),
        };

        res.json({
            success: true,
            data: analytics,
        });
    } catch (error) {
        console.error('Get supplier PO analytics error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const getPODeliveryStatus = async (req, res) => {
    try {
        const { supplierId } = req.params;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view delivery status',
            });
        }

        const pos = await prisma.purchaseOrder.findMany({
            where: {
                supplierId,
                companyId: req.user.companyId,
                status: { in: ['ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED'] },
            },
            select: {
                id: true,
                poNumber: true,
                title: true,
                orderDate: true,
                expectedDelivery: true,
                actualDelivery: true,
                status: true,
                items: {
                    select: {
                        quantity: true,
                        receivedQuantity: true,
                        pendingQuantity: true,
                        unit: true,
                    },
                },
            },
            orderBy: { expectedDelivery: 'asc' },
        });

        const deliveryStatus = pos.map(po => {
            const totalItems = po.items.length;
            const totalQuantity = po.items.reduce((sum, i) => sum + i.quantity, 0);
            const receivedQuantity = po.items.reduce((sum, i) => sum + i.receivedQuantity, 0);
            const completionRate = totalQuantity > 0 ? (receivedQuantity / totalQuantity * 100) : 0;

            let deliveryStatus = 'ON_TIME';
            if (po.actualDelivery && po.expectedDelivery) {
                if (po.actualDelivery > po.expectedDelivery) {
                    deliveryStatus = 'DELAYED';
                }
            } else if (po.expectedDelivery && new Date() > new Date(po.expectedDelivery)) {
                deliveryStatus = 'OVERDUE';
            }

            return {
                ...po,
                completionRate,
                deliveryStatus,
                isDelayed: deliveryStatus === 'DELAYED' || deliveryStatus === 'OVERDUE',
                daysUntilDue: po.expectedDelivery ?
                    Math.ceil((new Date(po.expectedDelivery) - new Date()) / (1000 * 60 * 60 * 24)) : null,
            };
        });

        const summary = {
            totalActive: deliveryStatus.length,
            onTime: deliveryStatus.filter(d => d.deliveryStatus === 'ON_TIME').length,
            delayed: deliveryStatus.filter(d => d.deliveryStatus === 'DELAYED').length,
            overdue: deliveryStatus.filter(d => d.deliveryStatus === 'OVERDUE').length,
            completed: deliveryStatus.filter(d => d.status === 'RECEIVED').length,
            averageCompletion: deliveryStatus.reduce((sum, d) => sum + d.completionRate, 0) / deliveryStatus.length || 0,
        };

        res.json({
            success: true,
            data: {
                deliveries: deliveryStatus,
                summary,
            },
        });
    } catch (error) {
        console.error('Get PO delivery status error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const exportSupplierPOs = async (req, res) => {
    try {
        const { supplierId } = req.params;
        const { fromDate, toDate, format = 'csv' } = req.query;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to export POs',
            });
        }

        const where = {
            supplierId,
            companyId: req.user.companyId,
        };

        if (fromDate || toDate) {
            where.orderDate = {};
            if (fromDate) where.orderDate.gte = new Date(fromDate);
            if (toDate) where.orderDate.lte = new Date(toDate);
        }

        const pos = await prisma.purchaseOrder.findMany({
            where,
            include: {
                project: {
                    select: {
                        name: true,
                        projectId: true,
                    },
                },
                items: true,
            },
            orderBy: { orderDate: 'asc' },
        });

        if (format === 'csv') {
            // Generate CSV
            const headers = [
                'PO Number',
                'Title',
                'Order Date',
                'Expected Delivery',
                'Actual Delivery',
                'Status',
                'Total Amount',
                'Paid Amount',
                'Due Amount',
                'Project',
                'Items Count',
                'Created At',
            ].join(',');

            const rows = pos.map(po => [
                po.poNumber,
                `"${po.title}"`,
                po.orderDate.toISOString().split('T')[0],
                po.expectedDelivery ? po.expectedDelivery.toISOString().split('T')[0] : '',
                po.actualDelivery ? po.actualDelivery.toISOString().split('T')[0] : '',
                po.status,
                po.totalAmount,
                po.totalPaid || 0,
                po.totalDue || 0,
                `"${po.project.name}"`,
                po.items.length,
                po.createdAt.toISOString().split('T')[0],
            ].join(','));

            const csv = [headers, ...rows].join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=supplier-${supplierId}-pos.csv`);
            return res.send(csv);
        }

        // Default JSON response
        res.json({
            success: true,
            data: pos,
        });
    } catch (error) {
        console.error('Export supplier POs error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const printSupplierPO = async (req, res) => {
    try {
        const { supplierId, poId } = req.params;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to print PO',
            });
        }

        const po = await prisma.purchaseOrder.findFirst({
            where: {
                id: poId,
                supplierId,
                companyId: req.user.companyId,
            },
            include: {
                project: {
                    select: {
                        name: true,
                        projectId: true,
                        location: true,
                        address: true,
                    },
                },
                supplier: {
                    select: {
                        name: true,
                        supplierCode: true,
                        address: true,
                        city: true,
                        state: true,
                        pincode: true,
                        gstNumber: true,
                        panNumber: true,
                        email: true,
                        phone: true,
                    },
                },
                items: {
                    orderBy: { lineNo: 'asc' },
                },
                company: {
                    select: {
                        name: true,
                        registrationNumber: true,
                        gstNumber: true,
                        officeAddress: true,
                        phone: true,
                        email: true,
                        website: true,
                        logo: true,
                    },
                },
                requestedBy: {
                    select: {
                        name: true,
                        designation: true,
                    },
                },
                approvedBy: {
                    select: {
                        name: true,
                        designation: true,
                    },
                },
            },
        });

        if (!po) {
            return res.status(404).json({
                success: false,
                message: 'Purchase order not found',
            });
        }

        // Calculate totals
        const subtotal = po.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
        const taxTotal = po.items.reduce((sum, item) => sum + (item.taxAmount || 0), 0);
        const grandTotal = subtotal + taxTotal + (po.shippingCost || 0) + (po.otherCharges || 0);

        const printData = {
            po,
            calculations: {
                subtotal,
                taxTotal,
                shippingCost: po.shippingCost || 0,
                otherCharges: po.otherCharges || 0,
                grandTotal,
            },
            printDate: new Date(),
            printedBy: req.user.name,
        };

        res.json({
            success: true,
            data: printData,
        });
    } catch (error) {
        console.error('Print supplier PO error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const bulkEmailPOs = async (req, res) => {
    try {
        const { supplierId } = req.params;
        const { poIds, emailSubject, emailBody } = req.body;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_UPDATE'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to send bulk emails',
            });
        }

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

        if (!supplier.email) {
            return res.status(400).json({
                success: false,
                message: 'Supplier does not have an email address',
            });
        }

        const pos = await prisma.purchaseOrder.findMany({
            where: {
                id: { in: poIds },
                supplierId,
                companyId: req.user.companyId,
            },
        });

        if (pos.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No purchase orders found',
            });
        }

        // Here you would integrate with your email service
        // For now, we'll just log and return success
        console.log(`Bulk email to ${supplier.email} for POs: ${poIds.join(', ')}`);

        // Log the email in audit
        await prisma.auditLog.create({
            data: {
                userId: req.user.userId,
                companyId: req.user.companyId,
                action: 'BULK_EMAIL_SENT',
                entityType: 'SUPPLIER',
                entityId: supplierId,
                newData: {
                    poIds,
                    subject: emailSubject,
                    recipient: supplier.email,
                },
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
            },
        });

        res.json({
            success: true,
            message: `Bulk email sent to ${supplier.email} for ${pos.length} POs`,
            data: {
                recipient: supplier.email,
                poCount: pos.length,
                poNumbers: pos.map(p => p.poNumber),
            },
        });
    } catch (error) {
        console.error('Bulk email POs error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const generateSupplierReport = async (req, res) => {
    try {
        const { supplierId } = req.params;
        const { fromDate, toDate, format = 'json' } = req.query;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to generate reports',
            });
        }

        const dateFilter = {};
        if (fromDate) dateFilter.gte = new Date(fromDate);
        if (toDate) dateFilter.lte = new Date(toDate);

        const [supplier, pos, documents] = await Promise.all([
            prisma.supplier.findFirst({
                where: {
                    id: supplierId,
                    companyId: req.user.companyId,
                },
            }),
            prisma.purchaseOrder.findMany({
                where: {
                    supplierId,
                    companyId: req.user.companyId,
                    ...(Object.keys(dateFilter).length > 0 && { orderDate: dateFilter }),
                },
                include: {
                    items: true,
                },
                orderBy: { orderDate: 'desc' },
            }),
            prisma.supplierDocument.findMany({
                where: {
                    supplierId,
                },
            }),
        ]);

        if (!supplier) {
            return res.status(404).json({
                success: false,
                message: 'Supplier not found',
            });
        }

        // Calculate statistics
        const totalOrders = pos.length;
        const totalSpent = pos.reduce((sum, po) => sum + po.totalAmount, 0);
        const totalPaid = pos.reduce((sum, po) => sum + (po.totalPaid || 0), 0);
        const pendingAmount = totalSpent - totalPaid;

        const completedOrders = pos.filter(po => po.status === 'RECEIVED' || po.status === 'PAID').length;
        const cancelledOrders = pos.filter(po => po.status === 'CANCELLED').length;

        const onTimeDeliveries = pos.filter(po =>
            po.status === 'RECEIVED' &&
            po.actualDelivery &&
            po.expectedDelivery &&
            po.actualDelivery <= po.expectedDelivery
        ).length;

        const report = {
            supplierInfo: {
                id: supplier.id,
                code: supplier.supplierCode,
                name: supplier.name,
                type: supplier.type,
                status: supplier.status,
                rating: supplier.rating,
                contactPerson: supplier.contactPerson,
                email: supplier.email,
                phone: supplier.phone,
                gstNumber: supplier.gstNumber,
                panNumber: supplier.panNumber,
                address: `${supplier.address || ''}, ${supplier.city || ''}, ${supplier.state || ''}, ${supplier.pincode || ''}`,
                verifiedAt: supplier.verifiedAt,
                createdAt: supplier.createdAt,
            },
            dateRange: {
                from: fromDate || 'All time',
                to: toDate || 'All time',
            },
            statistics: {
                totalOrders,
                totalSpent,
                totalPaid,
                pendingAmount,
                completedOrders,
                cancelledOrders,
                averageOrderValue: totalOrders > 0 ? totalSpent / totalOrders : 0,
                onTimeDeliveryRate: completedOrders > 0 ? (onTimeDeliveries / completedOrders * 100).toFixed(2) : 0,
                documentCount: documents.length,
            },
            orderSummary: pos.map(po => ({
                poNumber: po.poNumber,
                date: po.orderDate,
                amount: po.totalAmount,
                status: po.status,
                items: po.items.length,
                paid: po.totalPaid || 0,
                due: po.totalDue || 0,
            })),
            documents: documents.map(doc => ({
                title: doc.title,
                type: doc.documentType,
                verified: doc.isVerified,
                expiryDate: doc.expiryDate,
            })),
        };

        if (format === 'csv') {
            // Generate CSV for orders
            const headers = ['PO Number', 'Date', 'Amount', 'Status', 'Items', 'Paid', 'Due'].join(',');
            const rows = report.orderSummary.map(o => [
                o.poNumber,
                o.date.toISOString().split('T')[0],
                o.amount,
                o.status,
                o.items,
                o.paid,
                o.due,
            ].join(','));

            const csv = [headers, ...rows].join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=supplier-${supplierId}-report.csv`);
            return res.send(csv);
        }

        res.json({
            success: true,
            data: report,
        });
    } catch (error) {
        console.error('Generate supplier report error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};