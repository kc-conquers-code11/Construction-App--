// src/controllers/supplier-performance.controller.js
import prisma from '../config/database.js';

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
            rp.permission.code === 'SUPPLIER_PERFORMANCE_ALL_ACCESS'
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

// Helper to calculate supplier rating
const calculateSupplierRating = async (supplierId) => {
    // Get all completed purchase orders for this supplier
    const completedPOs = await prisma.purchaseOrder.findMany({
        where: {
            supplierId,
            status: 'RECEIVED',
        },
        include: {
            items: true,
        },
    });

    if (completedPOs.length === 0) {
        return 0;
    }

    // Calculate on-time delivery rate
    const onTimeDeliveries = completedPOs.filter(po =>
        po.actualDelivery && po.expectedDelivery &&
        po.actualDelivery <= po.expectedDelivery
    ).length;
    const onTimeRate = (onTimeDeliveries / completedPOs.length) * 100;

    // Calculate quality score based on accepted vs rejected items
    let totalItems = 0;
    let acceptedItems = 0;

    completedPOs.forEach(po => {
        po.items.forEach(item => {
            totalItems += item.quantity;
            acceptedItems += item.acceptedQuantity || 0;
        });
    });

    const qualityScore = totalItems > 0 ? (acceptedItems / totalItems) * 100 : 0;

    // Calculate communication score (based on response time - placeholder logic)
    // This would need a more sophisticated implementation with actual data
    const communicationScore = 85; // Placeholder

    // Calculate overall rating (weighted average)
    const rating = (onTimeRate * 0.4) + (qualityScore * 0.4) + (communicationScore * 0.2);

    // Update supplier rating
    await prisma.supplier.update({
        where: { id: supplierId },
        data: {
            rating: Math.round(rating * 10) / 10, // Round to 1 decimal
            totalOrders: completedPOs.length,
            onTimeDelivery: onTimeRate,
        },
    });

    return {
        overall: Math.round(rating * 10) / 10,
        onTimeRate,
        qualityScore,
        communicationScore,
        totalOrders: completedPOs.length,
    };
};

// ==================== PERFORMANCE METRICS ====================

export const getSupplierRating = async (req, res) => {
    try {
        const { supplierId } = req.params;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_PERFORMANCE_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view supplier ratings',
            });
        }

        const supplier = await prisma.supplier.findFirst({
            where: {
                id: supplierId,
                companyId: req.user.companyId,
            },
            select: {
                id: true,
                name: true,
                supplierCode: true,
                rating: true,
                totalOrders: true,
                completedProjects: true,
                onTimeDelivery: true,
            },
        });

        if (!supplier) {
            return res.status(404).json({
                success: false,
                message: 'Supplier not found',
            });
        }

        // Get detailed rating breakdown
        const ratingDetails = await calculateSupplierRating(supplierId);

        res.json({
            success: true,
            data: {
                supplier: {
                    id: supplier.id,
                    name: supplier.name,
                    code: supplier.supplierCode,
                },
                currentRating: supplier.rating || 0,
                details: ratingDetails,
            },
        });
    } catch (error) {
        console.error('Get supplier rating error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const updateSupplierRating = async (req, res) => {
    try {
        const { supplierId } = req.params;
        const { rating, review } = req.body;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_PERFORMANCE_UPDATE'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to update supplier ratings',
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

        // Calculate new average rating
        const oldRating = supplier.rating || 0;
        const newRating = oldRating === 0 ? rating : (oldRating + rating) / 2;

        const updatedSupplier = await prisma.supplier.update({
            where: { id: supplierId },
            data: {
                rating: Math.round(newRating * 10) / 10,
            },
        });

        // Log the rating update
        await logAudit(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_RATING_UPDATED',
            'SUPPLIER',
            supplierId,
            { oldRating },
            { newRating: updatedSupplier.rating, review },
            req
        );

        // You might want to create a SupplierReview model to store reviews
        // For now, we'll just return the updated rating

        res.json({
            success: true,
            message: 'Supplier rating updated successfully',
            data: {
                supplierId,
                oldRating,
                newRating: updatedSupplier.rating,
            },
        });
    } catch (error) {
        console.error('Update supplier rating error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const getSupplierPerformanceMetrics = async (req, res) => {
    try {
        const { supplierId } = req.params;
        const { fromDate, toDate } = req.query;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_PERFORMANCE_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view performance metrics',
            });
        }

        const dateFilter = {};
        if (fromDate) dateFilter.gte = new Date(fromDate);
        if (toDate) dateFilter.lte = new Date(toDate);

        // Get all purchase orders for this supplier within date range
        const purchaseOrders = await prisma.purchaseOrder.findMany({
            where: {
                supplierId,
                companyId: req.user.companyId,
                ...(Object.keys(dateFilter).length > 0 && { orderDate: dateFilter }),
            },
            include: {
                items: true,
                receipts: {
                    include: {
                        items: true,
                    },
                },
            },
            orderBy: { orderDate: 'asc' },
        });

        if (purchaseOrders.length === 0) {
            return res.json({
                success: true,
                data: {
                    message: 'No purchase orders found for the selected period',
                    metrics: {
                        totalOrders: 0,
                        totalValue: 0,
                        averageOrderValue: 0,
                        onTimeDeliveryRate: 0,
                        qualityAcceptanceRate: 0,
                        averageLeadTime: 0,
                    },
                },
            });
        }

        // Calculate metrics
        let totalOrders = purchaseOrders.length;
        let totalValue = purchaseOrders.reduce((sum, po) => sum + po.totalAmount, 0);
        let averageOrderValue = totalValue / totalOrders;

        // On-time delivery rate
        let completedOrders = purchaseOrders.filter(po => po.status === 'RECEIVED');
        let onTimeDeliveries = completedOrders.filter(po =>
            po.actualDelivery && po.expectedDelivery &&
            po.actualDelivery <= po.expectedDelivery
        ).length;
        let onTimeDeliveryRate = completedOrders.length > 0
            ? (onTimeDeliveries / completedOrders.length) * 100
            : 0;

        // Quality metrics
        let totalItems = 0;
        let acceptedItems = 0;
        let rejectedItems = 0;

        purchaseOrders.forEach(po => {
            po.items.forEach(item => {
                totalItems += item.quantity;
                acceptedItems += item.acceptedQuantity || 0;
                rejectedItems += item.rejectedQuantity || 0;
            });
        });

        let qualityAcceptanceRate = totalItems > 0 ? (acceptedItems / totalItems) * 100 : 0;
        let rejectionRate = totalItems > 0 ? (rejectedItems / totalItems) * 100 : 0;

        // Lead time analysis
        let leadTimes = completedOrders
            .filter(po => po.actualDelivery && po.orderDate)
            .map(po => {
                const orderDate = new Date(po.orderDate);
                const deliveryDate = new Date(po.actualDelivery);
                return Math.ceil((deliveryDate - orderDate) / (1000 * 60 * 60 * 24));
            });

        let averageLeadTime = leadTimes.length > 0
            ? leadTimes.reduce((sum, days) => sum + days, 0) / leadTimes.length
            : 0;

        // Monthly trend
        const monthlyTrend = {};
        purchaseOrders.forEach(po => {
            const month = po.orderDate.toISOString().slice(0, 7); // YYYY-MM
            if (!monthlyTrend[month]) {
                monthlyTrend[month] = {
                    orders: 0,
                    value: 0,
                    onTime: 0,
                };
            }
            monthlyTrend[month].orders++;
            monthlyTrend[month].value += po.totalAmount;

            if (po.status === 'RECEIVED' &&
                po.actualDelivery && po.expectedDelivery &&
                po.actualDelivery <= po.expectedDelivery) {
                monthlyTrend[month].onTime++;
            }
        });

        const metrics = {
            summary: {
                totalOrders,
                totalValue,
                averageOrderValue,
                onTimeDeliveryRate: Math.round(onTimeDeliveryRate * 100) / 100,
                qualityAcceptanceRate: Math.round(qualityAcceptanceRate * 100) / 100,
                rejectionRate: Math.round(rejectionRate * 100) / 100,
                averageLeadTime: Math.round(averageLeadTime * 10) / 10,
                completedOrders: completedOrders.length,
                pendingOrders: totalOrders - completedOrders.length,
            },
            monthlyTrend: Object.entries(monthlyTrend).map(([month, data]) => ({
                month,
                orders: data.orders,
                value: data.value,
                onTimeRate: data.orders > 0 ? (data.onTime / data.orders) * 100 : 0,
            })),
            detailed: {
                totalItems,
                acceptedItems,
                rejectedItems,
                onTimeDeliveries,
                leadTimes: {
                    min: leadTimes.length > 0 ? Math.min(...leadTimes) : 0,
                    max: leadTimes.length > 0 ? Math.max(...leadTimes) : 0,
                    average: averageLeadTime,
                },
            },
        };

        res.json({
            success: true,
            data: metrics,
        });
    } catch (error) {
        console.error('Get supplier performance metrics error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const getOnTimeDeliveryRate = async (req, res) => {
    try {
        const { supplierId } = req.params;
        const { fromDate, toDate } = req.query;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_PERFORMANCE_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view delivery metrics',
            });
        }

        const dateFilter = {};
        if (fromDate) dateFilter.gte = new Date(fromDate);
        if (toDate) dateFilter.lte = new Date(toDate);

        // Get completed orders
        const completedOrders = await prisma.purchaseOrder.findMany({
            where: {
                supplierId,
                companyId: req.user.companyId,
                status: 'RECEIVED',
                ...(Object.keys(dateFilter).length > 0 && { orderDate: dateFilter }),
            },
            select: {
                id: true,
                poNumber: true,
                orderDate: true,
                expectedDelivery: true,
                actualDelivery: true,
                totalAmount: true,
            },
            orderBy: { orderDate: 'desc' },
        });

        // Calculate on-time deliveries
        const onTimeDeliveries = completedOrders.filter(po =>
            po.actualDelivery && po.expectedDelivery &&
            po.actualDelivery <= po.expectedDelivery
        );

        const delayedDeliveries = completedOrders.filter(po =>
            po.actualDelivery && po.expectedDelivery &&
            po.actualDelivery > po.expectedDelivery
        );

        const overdueOrders = completedOrders.filter(po =>
            !po.actualDelivery && po.expectedDelivery &&
            new Date() > new Date(po.expectedDelivery)
        );

        const deliveryRate = completedOrders.length > 0
            ? (onTimeDeliveries.length / completedOrders.length) * 100
            : 0;

        // Calculate average delay days
        const delayDays = delayedDeliveries.map(po => {
            const expected = new Date(po.expectedDelivery);
            const actual = new Date(po.actualDelivery);
            return Math.ceil((actual - expected) / (1000 * 60 * 60 * 24));
        });

        const averageDelay = delayDays.length > 0
            ? delayDays.reduce((sum, days) => sum + days, 0) / delayDays.length
            : 0;

        // Monthly breakdown
        const monthlyBreakdown = {};
        completedOrders.forEach(po => {
            const month = po.orderDate.toISOString().slice(0, 7);
            if (!monthlyBreakdown[month]) {
                monthlyBreakdown[month] = {
                    total: 0,
                    onTime: 0,
                    delayed: 0,
                };
            }
            monthlyBreakdown[month].total++;

            if (po.actualDelivery && po.expectedDelivery && po.actualDelivery <= po.expectedDelivery) {
                monthlyBreakdown[month].onTime++;
            } else {
                monthlyBreakdown[month].delayed++;
            }
        });

        res.json({
            success: true,
            data: {
                summary: {
                    totalOrders: completedOrders.length,
                    onTimeDeliveries: onTimeDeliveries.length,
                    delayedDeliveries: delayedDeliveries.length,
                    overdueOrders: overdueOrders.length,
                    onTimeRate: Math.round(deliveryRate * 100) / 100,
                    averageDelayDays: Math.round(averageDelay * 10) / 10,
                },
                recentOrders: completedOrders.slice(0, 10).map(po => ({
                    poNumber: po.poNumber,
                    orderDate: po.orderDate,
                    expectedDelivery: po.expectedDelivery,
                    actualDelivery: po.actualDelivery,
                    status: po.actualDelivery && po.expectedDelivery && po.actualDelivery <= po.expectedDelivery
                        ? 'ON_TIME'
                        : po.actualDelivery && po.expectedDelivery && po.actualDelivery > po.expectedDelivery
                            ? 'DELAYED'
                            : 'PENDING',
                    delayDays: po.actualDelivery && po.expectedDelivery && po.actualDelivery > po.expectedDelivery
                        ? Math.ceil((new Date(po.actualDelivery) - new Date(po.expectedDelivery)) / (1000 * 60 * 60 * 24))
                        : 0,
                })),
                monthlyBreakdown: Object.entries(monthlyBreakdown).map(([month, data]) => ({
                    month,
                    ...data,
                    onTimeRate: data.total > 0 ? (data.onTime / data.total) * 100 : 0,
                })),
            },
        });
    } catch (error) {
        console.error('Get on-time delivery rate error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const getQualityRating = async (req, res) => {
    try {
        const { supplierId } = req.params;
        const { fromDate, toDate } = req.query;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_PERFORMANCE_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view quality metrics',
            });
        }

        const dateFilter = {};
        if (fromDate) dateFilter.gte = new Date(fromDate);
        if (toDate) dateFilter.lte = new Date(toDate);

        // Get all receipts for this supplier
        const receipts = await prisma.goodsReceipt.findMany({
            where: {
                purchaseOrder: {
                    supplierId,
                    companyId: req.user.companyId,
                    ...(Object.keys(dateFilter).length > 0 && { orderDate: dateFilter }),
                },
            },
            include: {
                items: {
                    include: {
                        poItem: true,
                    },
                },
            },
            orderBy: { receiptDate: 'desc' },
        });

        if (receipts.length === 0) {
            return res.json({
                success: true,
                data: {
                    message: 'No receipts found for the selected period',
                    metrics: {
                        totalReceipts: 0,
                        totalItems: 0,
                        acceptanceRate: 0,
                        rejectionRate: 0,
                    },
                },
            });
        }

        // Calculate quality metrics
        let totalItems = 0;
        let acceptedItems = 0;
        let rejectedItems = 0;
        let qualityRatings = [];

        receipts.forEach(receipt => {
            receipt.items.forEach(item => {
                totalItems += item.receivedQuantity || 0;
                acceptedItems += item.acceptedQuantity || 0;
                rejectedItems += item.rejectedQuantity || 0;

                if (item.qualityRating) {
                    qualityRatings.push(item.qualityRating);
                }
            });
        });

        const acceptanceRate = totalItems > 0 ? (acceptedItems / totalItems) * 100 : 0;
        const rejectionRate = totalItems > 0 ? (rejectedItems / totalItems) * 100 : 0;

        // Calculate quality rating distribution
        const ratingDistribution = {
            EXCELLENT: qualityRatings.filter(r => r === 'EXCELLENT').length,
            GOOD: qualityRatings.filter(r => r === 'GOOD').length,
            AVERAGE: qualityRatings.filter(r => r === 'AVERAGE').length,
            POOR: qualityRatings.filter(r => r === 'POOR').length,
            REJECT: qualityRatings.filter(r => r === 'REJECT').length,
        };

        // Get recent quality issues
        const recentIssues = receipts
            .flatMap(receipt =>
                receipt.items
                    .filter(item => item.rejectionReason || item.inspectionStatus === 'REJECTED')
                    .map(item => ({
                        receiptDate: receipt.receiptDate,
                        grNumber: receipt.grNumber,
                        item: item.poItem?.description || 'Unknown',
                        rejectionReason: item.rejectionReason,
                        quantity: item.rejectedQuantity,
                        qualityRating: item.qualityRating,
                    }))
            )
            .slice(0, 10);

        res.json({
            success: true,
            data: {
                summary: {
                    totalReceipts: receipts.length,
                    totalItems,
                    acceptedItems,
                    rejectedItems,
                    acceptanceRate: Math.round(acceptanceRate * 100) / 100,
                    rejectionRate: Math.round(rejectionRate * 100) / 100,
                },
                ratingDistribution,
                recentIssues,
                qualityTrend: await getQualityTrend(supplierId, fromDate, toDate),
            },
        });
    } catch (error) {
        console.error('Get quality rating error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

// Helper function for quality trend
const getQualityTrend = async (supplierId, fromDate, toDate) => {
    const receipts = await prisma.goodsReceipt.findMany({
        where: {
            purchaseOrder: {
                supplierId,
            },
            receiptDate: {
                gte: fromDate ? new Date(fromDate) : new Date(new Date().setMonth(new Date().getMonth() - 6)),
                lte: toDate ? new Date(toDate) : new Date(),
            },
        },
        include: {
            items: true,
        },
        orderBy: { receiptDate: 'asc' },
    });

    const monthlyTrend = {};
    receipts.forEach(receipt => {
        const month = receipt.receiptDate.toISOString().slice(0, 7);
        if (!monthlyTrend[month]) {
            monthlyTrend[month] = {
                total: 0,
                accepted: 0,
                rejected: 0,
            };
        }

        receipt.items.forEach(item => {
            monthlyTrend[month].total += item.receivedQuantity || 0;
            monthlyTrend[month].accepted += item.acceptedQuantity || 0;
            monthlyTrend[month].rejected += item.rejectedQuantity || 0;
        });
    });

    return Object.entries(monthlyTrend).map(([month, data]) => ({
        month,
        acceptanceRate: data.total > 0 ? (data.accepted / data.total) * 100 : 0,
        rejectionRate: data.total > 0 ? (data.rejected / data.total) * 100 : 0,
        totalItems: data.total,
    }));
};

export const getSupplierComparison = async (req, res) => {
    try {
        const { supplierIds } = req.query;
        const supplierIdArray = supplierIds ? supplierIds.split(',') : [];

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_PERFORMANCE_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to compare suppliers',
            });
        }

        // If no specific suppliers, get top 5 by default
        const where = supplierIdArray.length > 0
            ? { id: { in: supplierIdArray }, companyId: req.user.companyId }
            : { companyId: req.user.companyId };

        const suppliers = await prisma.supplier.findMany({
            where,
            select: {
                id: true,
                name: true,
                supplierCode: true,
                type: true,
                rating: true,
                totalOrders: true,
                completedProjects: true,
                onTimeDelivery: true,
            },
            orderBy: { rating: 'desc' },
            take: supplierIdArray.length > 0 ? undefined : 5,
        });

        // Get performance metrics for each supplier
        const comparisonData = await Promise.all(
            suppliers.map(async (supplier) => {
                // Get last 12 months of orders
                const twelveMonthsAgo = new Date();
                twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

                const orders = await prisma.purchaseOrder.findMany({
                    where: {
                        supplierId: supplier.id,
                        orderDate: { gte: twelveMonthsAgo },
                    },
                    include: {
                        items: true,
                    },
                });

                const completedOrders = orders.filter(o => o.status === 'RECEIVED');
                const totalValue = orders.reduce((sum, o) => sum + o.totalAmount, 0);

                // Calculate on-time rate
                const onTimeCount = completedOrders.filter(o =>
                    o.actualDelivery && o.expectedDelivery &&
                    o.actualDelivery <= o.expectedDelivery
                ).length;

                // Calculate quality rate
                let totalItems = 0;
                let acceptedItems = 0;
                orders.forEach(o => {
                    o.items.forEach(item => {
                        totalItems += item.quantity;
                        acceptedItems += item.acceptedQuantity || 0;
                    });
                });

                return {
                    id: supplier.id,
                    name: supplier.name,
                    code: supplier.supplierCode,
                    type: supplier.type,
                    rating: supplier.rating || 0,
                    totalOrders: orders.length,
                    completedOrders: completedOrders.length,
                    totalValue,
                    averageOrderValue: orders.length > 0 ? totalValue / orders.length : 0,
                    onTimeRate: completedOrders.length > 0 ? (onTimeCount / completedOrders.length) * 100 : 0,
                    qualityRate: totalItems > 0 ? (acceptedItems / totalItems) * 100 : 0,
                };
            })
        );

        // Calculate rankings
        const rankings = {
            byRating: [...comparisonData].sort((a, b) => b.rating - a.rating).map((s, i) => ({
                rank: i + 1,
                id: s.id,
                name: s.name,
                value: s.rating,
            })),
            byOnTimeRate: [...comparisonData].sort((a, b) => b.onTimeRate - a.onTimeRate).map((s, i) => ({
                rank: i + 1,
                id: s.id,
                name: s.name,
                value: s.onTimeRate,
            })),
            byQualityRate: [...comparisonData].sort((a, b) => b.qualityRate - a.qualityRate).map((s, i) => ({
                rank: i + 1,
                id: s.id,
                name: s.name,
                value: s.qualityRate,
            })),
            byVolume: [...comparisonData].sort((a, b) => b.totalValue - a.totalValue).map((s, i) => ({
                rank: i + 1,
                id: s.id,
                name: s.name,
                value: s.totalValue,
            })),
        };

        // Calculate averages
        const averages = {
            rating: comparisonData.reduce((sum, s) => sum + s.rating, 0) / comparisonData.length || 0,
            onTimeRate: comparisonData.reduce((sum, s) => sum + s.onTimeRate, 0) / comparisonData.length || 0,
            qualityRate: comparisonData.reduce((sum, s) => sum + s.qualityRate, 0) / comparisonData.length || 0,
            averageOrderValue: comparisonData.reduce((sum, s) => sum + s.averageOrderValue, 0) / comparisonData.length || 0,
        };

        res.json({
            success: true,
            data: {
                suppliers: comparisonData,
                rankings,
                averages,
                comparisonDate: new Date(),
            },
        });
    } catch (error) {
        console.error('Get supplier comparison error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const getTopSuppliers = async (req, res) => {
    try {
        const {
            limit = 10,
            criteria = 'rating', // rating, volume, onTime, quality
            category
        } = req.query;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_PERFORMANCE_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view top suppliers',
            });
        }

        // Build where clause
        const where = {
            companyId: req.user.companyId,
            status: 'ACTIVE',
        };

        if (category) {
            where.type = category;
        }

        // Get suppliers with their performance metrics
        const suppliers = await prisma.supplier.findMany({
            where,
            select: {
                id: true,
                name: true,
                supplierCode: true,
                type: true,
                rating: true,
                totalOrders: true,
                completedProjects: true,
                onTimeDelivery: true,
                averageDeliveryTime: true,
            },
        });

        // Enhance with calculated metrics
        const enhancedSuppliers = await Promise.all(
            suppliers.map(async (supplier) => {
                // Get last 12 months data
                const twelveMonthsAgo = new Date();
                twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

                const orders = await prisma.purchaseOrder.findMany({
                    where: {
                        supplierId: supplier.id,
                        orderDate: { gte: twelveMonthsAgo },
                    },
                    include: {
                        items: true,
                    },
                });

                const totalValue = orders.reduce((sum, o) => sum + o.totalAmount, 0);
                const completedOrders = orders.filter(o => o.status === 'RECEIVED');

                // Calculate on-time rate
                const onTimeCount = completedOrders.filter(o =>
                    o.actualDelivery && o.expectedDelivery &&
                    o.actualDelivery <= o.expectedDelivery
                ).length;

                // Calculate quality rate
                let totalItems = 0;
                let acceptedItems = 0;
                orders.forEach(o => {
                    o.items.forEach(item => {
                        totalItems += item.quantity;
                        acceptedItems += item.acceptedQuantity || 0;
                    });
                });

                return {
                    ...supplier,
                    volume: totalValue,
                    orderCount: orders.length,
                    onTimeRate: completedOrders.length > 0 ? (onTimeCount / completedOrders.length) * 100 : 0,
                    qualityRate: totalItems > 0 ? (acceptedItems / totalItems) * 100 : 0,
                    score: 0, // Will be calculated based on criteria
                };
            })
        );

        // Sort based on criteria
        let sortedSuppliers;
        switch (criteria) {
            case 'volume':
                sortedSuppliers = enhancedSuppliers.sort((a, b) => b.volume - a.volume);
                break;
            case 'onTime':
                sortedSuppliers = enhancedSuppliers.sort((a, b) => b.onTimeRate - a.onTimeRate);
                break;
            case 'quality':
                sortedSuppliers = enhancedSuppliers.sort((a, b) => b.qualityRate - a.qualityRate);
                break;
            case 'rating':
            default:
                sortedSuppliers = enhancedSuppliers.sort((a, b) => (b.rating || 0) - (a.rating || 0));
                break;
        }

        // Calculate composite score for each supplier
        sortedSuppliers = sortedSuppliers.map((supplier, index) => {
            const maxRating = Math.max(...sortedSuppliers.map(s => s.rating || 0));
            const maxVolume = Math.max(...sortedSuppliers.map(s => s.volume));
            const maxOnTime = Math.max(...sortedSuppliers.map(s => s.onTimeRate));
            const maxQuality = Math.max(...sortedSuppliers.map(s => s.qualityRate));

            // Composite score (weighted average)
            const score = (
                ((supplier.rating || 0) / (maxRating || 1)) * 0.3 +
                (supplier.volume / (maxVolume || 1)) * 0.3 +
                (supplier.onTimeRate / (maxOnTime || 1)) * 0.2 +
                (supplier.qualityRate / (maxQuality || 1)) * 0.2
            ) * 100;

            return {
                ...supplier,
                score: Math.round(score * 100) / 100,
                rank: index + 1,
            };
        });

        // Take top N
        const topSuppliers = sortedSuppliers.slice(0, parseInt(limit));

        res.json({
            success: true,
            data: {
                criteria,
                category: category || 'all',
                suppliers: topSuppliers,
                summary: {
                    averageScore: topSuppliers.reduce((sum, s) => sum + s.score, 0) / topSuppliers.length,
                    topPerformer: topSuppliers[0]?.name,
                    totalAnalyzed: suppliers.length,
                },
            },
        });
    } catch (error) {
        console.error('Get top suppliers error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const generatePerformanceReport = async (req, res) => {
    try {
        const {
            supplierId,
            fromDate,
            toDate,
            format = 'json'
        } = req.query;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_PERFORMANCE_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to generate performance reports',
            });
        }

        const dateFilter = {};
        if (fromDate) dateFilter.gte = new Date(fromDate);
        if (toDate) dateFilter.lte = new Date(toDate);

        // If supplierId is provided, generate report for specific supplier
        if (supplierId) {
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

            // Get all orders for this supplier
            const orders = await prisma.purchaseOrder.findMany({
                where: {
                    supplierId,
                    ...(Object.keys(dateFilter).length > 0 && { orderDate: dateFilter }),
                },
                include: {
                    items: true,
                    receipts: {
                        include: {
                            items: true,
                        },
                    },
                    payments: true,
                },
                orderBy: { orderDate: 'desc' },
            });

            // Calculate comprehensive metrics
            const totalOrders = orders.length;
            const totalValue = orders.reduce((sum, o) => sum + o.totalAmount, 0);
            const completedOrders = orders.filter(o => o.status === 'RECEIVED');
            const paidOrders = orders.filter(o => o.status === 'PAID');

            // Delivery performance
            const onTimeDeliveries = completedOrders.filter(o =>
                o.actualDelivery && o.expectedDelivery &&
                o.actualDelivery <= o.expectedDelivery
            ).length;

            // Quality metrics
            let totalItems = 0;
            let acceptedItems = 0;
            let rejectedItems = 0;
            let qualityRatings = [];

            orders.forEach(order => {
                order.items.forEach(item => {
                    totalItems += item.quantity;
                    acceptedItems += item.acceptedQuantity || 0;
                    rejectedItems += item.rejectedQuantity || 0;
                });
            });

            orders.forEach(order => {
                order.receipts.forEach(receipt => {
                    receipt.items.forEach(item => {
                        if (item.qualityRating) {
                            qualityRatings.push(item.qualityRating);
                        }
                    });
                });
            });

            // Payment performance
            const totalPaid = orders.reduce((sum, o) => sum + (o.totalPaid || 0), 0);
            const outstandingAmount = totalValue - totalPaid;

            // Monthly breakdown
            const monthlyPerformance = {};
            orders.forEach(order => {
                const month = order.orderDate.toISOString().slice(0, 7);
                if (!monthlyPerformance[month]) {
                    monthlyPerformance[month] = {
                        orders: 0,
                        value: 0,
                        onTime: 0,
                        items: 0,
                        accepted: 0,
                    };
                }
                monthlyPerformance[month].orders++;
                monthlyPerformance[month].value += order.totalAmount;

                if (order.status === 'RECEIVED' &&
                    order.actualDelivery && order.expectedDelivery &&
                    order.actualDelivery <= order.expectedDelivery) {
                    monthlyPerformance[month].onTime++;
                }

                order.items.forEach(item => {
                    monthlyPerformance[month].items += item.quantity;
                    monthlyPerformance[month].accepted += item.acceptedQuantity || 0;
                });
            });

            const report = {
                generatedAt: new Date(),
                period: {
                    from: fromDate || 'All time',
                    to: toDate || 'All time',
                },
                supplier: {
                    id: supplier.id,
                    name: supplier.name,
                    code: supplier.supplierCode,
                    type: supplier.type,
                    status: supplier.status,
                    rating: supplier.rating,
                    contactPerson: supplier.contactPerson,
                    email: supplier.email,
                    phone: supplier.phone,
                    since: supplier.createdAt,
                },
                summary: {
                    totalOrders,
                    totalValue,
                    totalPaid,
                    outstandingAmount,
                    completedOrders: completedOrders.length,
                    pendingOrders: totalOrders - completedOrders.length,
                    paidOrders: paidOrders.length,
                    averageOrderValue: totalOrders > 0 ? totalValue / totalOrders : 0,
                },
                delivery: {
                    totalDeliveries: completedOrders.length,
                    onTimeDeliveries,
                    onTimeRate: completedOrders.length > 0 ? (onTimeDeliveries / completedOrders.length) * 100 : 0,
                    averageLeadTime: calculateAverageLeadTime(completedOrders),
                },
                quality: {
                    totalItems,
                    acceptedItems,
                    rejectedItems,
                    acceptanceRate: totalItems > 0 ? (acceptedItems / totalItems) * 100 : 0,
                    rejectionRate: totalItems > 0 ? (rejectedItems / totalItems) * 100 : 0,
                    ratingDistribution: {
                        EXCELLENT: qualityRatings.filter(r => r === 'EXCELLENT').length,
                        GOOD: qualityRatings.filter(r => r === 'GOOD').length,
                        AVERAGE: qualityRatings.filter(r => r === 'AVERAGE').length,
                        POOR: qualityRatings.filter(r => r === 'POOR').length,
                        REJECT: qualityRatings.filter(r => r === 'REJECT').length,
                    },
                },
                monthlyPerformance: Object.entries(monthlyPerformance).map(([month, data]) => ({
                    month,
                    ...data,
                    onTimeRate: data.orders > 0 ? (data.onTime / data.orders) * 100 : 0,
                    acceptanceRate: data.items > 0 ? (data.accepted / data.items) * 100 : 0,
                })),
                recentOrders: orders.slice(0, 10).map(o => ({
                    poNumber: o.poNumber,
                    date: o.orderDate,
                    amount: o.totalAmount,
                    status: o.status,
                    deliveryStatus: o.actualDelivery && o.expectedDelivery && o.actualDelivery <= o.expectedDelivery
                        ? 'ON_TIME'
                        : o.actualDelivery && o.expectedDelivery && o.actualDelivery > o.expectedDelivery
                            ? 'DELAYED'
                            : 'PENDING',
                })),
            };

            if (format === 'csv') {
                // Generate CSV for monthly performance
                const headers = ['Month', 'Orders', 'Value', 'On Time', 'Items', 'Accepted', 'On Time Rate %', 'Acceptance Rate %'].join(',');
                const rows = report.monthlyPerformance.map(m => [
                    m.month,
                    m.orders,
                    m.value,
                    m.onTime,
                    m.items,
                    m.accepted,
                    m.onTimeRate.toFixed(2),
                    m.acceptanceRate.toFixed(2),
                ].join(','));

                const csv = [headers, ...rows].join('\n');

                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename=supplier-${supplierId}-performance.csv`);
                return res.send(csv);
            }

            return res.json({
                success: true,
                data: report,
            });
        }

        // If no supplierId, generate overall supplier performance report
        const suppliers = await prisma.supplier.findMany({
            where: {
                companyId: req.user.companyId,
                status: 'ACTIVE',
            },
            select: {
                id: true,
                name: true,
                supplierCode: true,
                type: true,
                rating: true,
                totalOrders: true,
            },
        });

        // Get overall statistics
        const allOrders = await prisma.purchaseOrder.findMany({
            where: {
                companyId: req.user.companyId,
                supplierId: { not: null },
                ...(Object.keys(dateFilter).length > 0 && { orderDate: dateFilter }),
            },
        });

        const totalOrders = allOrders.length;
        const totalValue = allOrders.reduce((sum, o) => sum + o.totalAmount, 0);

        const activeSuppliers = suppliers.length;
        const averageRating = suppliers.reduce((sum, s) => sum + (s.rating || 0), 0) / activeSuppliers || 0;

        const topSuppliers = suppliers
            .sort((a, b) => (b.rating || 0) - (a.rating || 0))
            .slice(0, 5);

        const report = {
            generatedAt: new Date(),
            period: {
                from: fromDate || 'All time',
                to: toDate || 'All time',
            },
            summary: {
                totalSuppliers: activeSuppliers,
                totalOrders,
                totalValue,
                averageOrderValue: totalOrders > 0 ? totalValue / totalOrders : 0,
                averageSupplierRating: averageRating,
            },
            topSuppliers: topSuppliers.map(s => ({
                name: s.name,
                code: s.supplierCode,
                rating: s.rating,
                orders: s.totalOrders,
            })),
            categoryBreakdown: await getCategoryBreakdown(req.user.companyId, dateFilter),
        };

        if (format === 'csv') {
            // Generate CSV for category breakdown
            const headers = ['Category', 'Suppliers', 'Orders', 'Value'].join(',');
            const rows = report.categoryBreakdown.map(c => [
                c.category,
                c.supplierCount,
                c.orderCount,
                c.totalValue,
            ].join(','));

            const csv = [headers, ...rows].join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=supplier-performance-overview.csv');
            return res.send(csv);
        }

        res.json({
            success: true,
            data: report,
        });
    } catch (error) {
        console.error('Generate performance report error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

// Helper function to calculate average lead time
const calculateAverageLeadTime = (orders) => {
    const leadTimes = orders
        .filter(o => o.actualDelivery && o.orderDate)
        .map(o => {
            const orderDate = new Date(o.orderDate);
            const deliveryDate = new Date(o.actualDelivery);
            return Math.ceil((deliveryDate - orderDate) / (1000 * 60 * 60 * 24));
        });

    if (leadTimes.length === 0) return 0;
    return Math.round(leadTimes.reduce((sum, days) => sum + days, 0) / leadTimes.length * 10) / 10;
};

// Helper function to get category breakdown
const getCategoryBreakdown = async (companyId, dateFilter) => {
    const suppliers = await prisma.supplier.findMany({
        where: {
            companyId,
        },
        include: {
            purchaseOrders: {
                where: Object.keys(dateFilter).length > 0 ? { orderDate: dateFilter } : {},
            },
        },
    });

    const breakdown = {};
    suppliers.forEach(supplier => {
        const category = supplier.type || 'OTHER';
        if (!breakdown[category]) {
            breakdown[category] = {
                category,
                supplierCount: 0,
                orderCount: 0,
                totalValue: 0,
            };
        }
        breakdown[category].supplierCount++;
        breakdown[category].orderCount += supplier.purchaseOrders.length;
        breakdown[category].totalValue += supplier.purchaseOrders.reduce((sum, po) => sum + po.totalAmount, 0);
    });

    return Object.values(breakdown);
};

export const recordDeliveryFeedback = async (req, res) => {
    try {
        const { supplierId } = req.params;
        const {
            poId,
            feedback,
            rating,
            issues,
            resolved,
        } = req.body;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_PERFORMANCE_UPDATE'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to record feedback',
            });
        }

        // Verify PO exists and belongs to supplier
        const po = await prisma.purchaseOrder.findFirst({
            where: {
                id: poId,
                supplierId,
                companyId: req.user.companyId,
            },
        });

        if (!po) {
            return res.status(404).json({
                success: false,
                message: 'Purchase order not found',
            });
        }

        // Log the feedback in audit
        await logAudit(
            req.user.userId,
            req.user.companyId,
            'DELIVERY_FEEDBACK_RECORDED',
            'PURCHASE_ORDER',
            poId,
            null,
            {
                feedback,
                rating,
                issues,
                resolved,
                supplierId,
            },
            req
        );

        // Update supplier rating based on feedback
        await calculateSupplierRating(supplierId);

        // You might want to create a Feedback model to store this properly
        // For now, we'll just update the PO notes
        await prisma.purchaseOrder.update({
            where: { id: poId },
            data: {
                notes: po.notes
                    ? `${po.notes}\nDelivery Feedback: ${feedback} (Rating: ${rating}/5)`
                    : `Delivery Feedback: ${feedback} (Rating: ${rating}/5)`,
            },
        });

        res.json({
            success: true,
            message: 'Delivery feedback recorded successfully',
            data: {
                poId,
                feedback,
                rating,
                recordedBy: req.user.userId,
                recordedAt: new Date(),
            },
        });
    } catch (error) {
        console.error('Record delivery feedback error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const getSupplierHistory = async (req, res) => {
    try {
        const { supplierId } = req.params;
        const { page = 1, limit = 10 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_PERFORMANCE_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view supplier history',
            });
        }

        // Get all interactions with this supplier
        const [auditLogs, total] = await Promise.all([
            prisma.auditLog.findMany({
                where: {
                    companyId: req.user.companyId,
                    entityId: supplierId,
                    entityType: 'SUPPLIER',
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                },
                skip,
                take: parseInt(limit),
                orderBy: { timestamp: 'desc' },
            }),
            prisma.auditLog.count({
                where: {
                    companyId: req.user.companyId,
                    entityId: supplierId,
                    entityType: 'SUPPLIER',
                },
            }),
        ]);

        // Get order history
        const orderHistory = await prisma.purchaseOrder.findMany({
            where: {
                supplierId,
                companyId: req.user.companyId,
            },
            select: {
                id: true,
                poNumber: true,
                title: true,
                totalAmount: true,
                status: true,
                orderDate: true,
                expectedDelivery: true,
                actualDelivery: true,
            },
            orderBy: { orderDate: 'desc' },
            take: 20,
        });

        // Get document history
        const documentHistory = await prisma.supplierDocument.findMany({
            where: {
                supplierId,
            },
            select: {
                id: true,
                title: true,
                documentType: true,
                isVerified: true,
                createdAt: true,
                verifiedAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
        });

        const history = {
            interactions: auditLogs.map(log => ({
                id: log.id,
                action: log.action,
                performedBy: log.user,
                timestamp: log.timestamp,
                details: log.newData,
                ipAddress: log.ipAddress,
            })),
            orders: orderHistory,
            documents: documentHistory,
            summary: {
                totalInteractions: total,
                totalOrders: orderHistory.length,
                totalDocuments: documentHistory.length,
                firstInteraction: auditLogs[auditLogs.length - 1]?.timestamp,
                lastInteraction: auditLogs[0]?.timestamp,
            },
        };

        res.json({
            success: true,
            data: history,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error('Get supplier history error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};