// src/controllers/supplier-communication.controller.js
import prisma from '../config/database.js';
import nodemailer from 'nodemailer';

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
            rp.permission.code === 'SUPPLIER_COMMUNICATION_ALL_ACCESS'
    );

    return hasPermission;
};

// Configure email transporter
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

// Helper to log communication
const logCommunication = async (supplierId, userId, companyId, type, subject, content, metadata, req) => {
    // You might want to create a CommunicationLog model in your schema
    // For now, we'll use AuditLog
    await prisma.auditLog.create({
        data: {
            userId,
            companyId,
            action: `SUPPLIER_${type}_SENT`,
            entityType: 'SUPPLIER',
            entityId: supplierId,
            newData: {
                type,
                subject,
                content,
                metadata,
            },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        },
    });
};

// ==================== EMAIL COMMUNICATIONS ====================

export const sendEmailToSupplier = async (req, res) => {
    try {
        const { supplierId } = req.params;
        const {
            subject,
            content,
            attachments,
            cc,
            bcc,
        } = req.body;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_COMMUNICATION_SEND'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to send emails',
            });
        }

        // Get supplier details
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

        // Get company details for email signature
        const company = await prisma.company.findUnique({
            where: { id: req.user.companyId },
        });

        // Prepare email content with company signature
        const emailContent = `
            ${content}
            
            <br><br>
            <hr>
            <div style="font-family: Arial, sans-serif; font-size: 12px; color: #666;">
                <p><strong>${company?.name || 'Our Company'}</strong></p>
                <p>${company?.officeAddress || ''}</p>
                <p>Phone: ${company?.phone || ''} | Email: ${company?.email || ''}</p>
                <p>This is an automated message from our procurement system.</p>
            </div>
        `;

        // Prepare email options
        const mailOptions = {
            from: `"${company?.name || 'Procurement'}" <${process.env.SMTP_FROM}>`,
            to: supplier.email,
            cc: cc ? (Array.isArray(cc) ? cc.join(',') : cc) : undefined,
            bcc: bcc ? (Array.isArray(bcc) ? bcc.join(',') : bcc) : undefined,
            subject,
            html: emailContent,
            attachments: attachments?.map(att => ({
                filename: att.filename,
                path: att.path,
                contentType: att.contentType,
            })),
        };

        // Send email
        const info = await transporter.sendMail(mailOptions);

        // Log communication
        await logCommunication(
            supplierId,
            req.user.userId,
            req.user.companyId,
            'EMAIL',
            subject,
            content,
            {
                to: supplier.email,
                cc,
                bcc,
                messageId: info.messageId,
                attachments: attachments?.length || 0,
            },
            req
        );

        res.json({
            success: true,
            message: 'Email sent successfully',
            data: {
                messageId: info.messageId,
                to: supplier.email,
                subject,
            },
        });
    } catch (error) {
        console.error('Send email to supplier error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const sendBulkEmailToSuppliers = async (req, res) => {
    try {
        const {
            supplierIds,
            subject,
            content,
            attachments,
        } = req.body;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_COMMUNICATION_SEND'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to send bulk emails',
            });
        }

        // Get suppliers with email
        const suppliers = await prisma.supplier.findMany({
            where: {
                id: { in: supplierIds },
                companyId: req.user.companyId,
                email: { not: null },
            },
            select: {
                id: true,
                name: true,
                email: true,
            },
        });

        if (suppliers.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid suppliers with email addresses found',
            });
        }

        // Get company details
        const company = await prisma.company.findUnique({
            where: { id: req.user.companyId },
        });

        // Prepare email content template
        const emailTemplate = (supplierName) => `
            <p>Dear ${supplierName},</p>
            ${content}
            
            <br><br>
            <hr>
            <div style="font-family: Arial, sans-serif; font-size: 12px; color: #666;">
                <p><strong>${company?.name || 'Our Company'}</strong></p>
                <p>${company?.officeAddress || ''}</p>
                <p>Phone: ${company?.phone || ''} | Email: ${company?.email || ''}</p>
                <p>This is an automated message from our procurement system.</p>
            </div>
        `;

        // Send emails
        const results = await Promise.allSettled(
            suppliers.map(async (supplier) => {
                const personalizedContent = emailTemplate(supplier.name);

                const mailOptions = {
                    from: `"${company?.name || 'Procurement'}" <${process.env.SMTP_FROM}>`,
                    to: supplier.email,
                    subject,
                    html: personalizedContent,
                    attachments: attachments?.map(att => ({
                        filename: att.filename,
                        path: att.path,
                        contentType: att.contentType,
                    })),
                };

                const info = await transporter.sendMail(mailOptions);

                // Log each communication
                await logCommunication(
                    supplier.id,
                    req.user.userId,
                    req.user.companyId,
                    'BULK_EMAIL',
                    subject,
                    content,
                    {
                        to: supplier.email,
                        messageId: info.messageId,
                    },
                    req
                );

                return {
                    supplierId: supplier.id,
                    supplierName: supplier.name,
                    email: supplier.email,
                    success: true,
                    messageId: info.messageId,
                };
            })
        );

        const summary = {
            total: suppliers.length,
            successful: results.filter(r => r.status === 'fulfilled').length,
            failed: results.filter(r => r.status === 'rejected').length,
            details: results.map((r, index) => ({
                supplier: suppliers[index],
                status: r.status,
                ...(r.status === 'fulfilled' ? r.value : { error: r.reason.message }),
            })),
        };

        res.json({
            success: true,
            message: `Bulk email sent to ${summary.successful} out of ${summary.total} suppliers`,
            data: summary,
        });
    } catch (error) {
        console.error('Send bulk email to suppliers error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const getEmailHistory = async (req, res) => {
    try {
        const { supplierId } = req.params;
        const { page = 1, limit = 10 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_COMMUNICATION_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view email history',
            });
        }

        // Get email history from audit logs
        const [logs, total] = await Promise.all([
            prisma.auditLog.findMany({
                where: {
                    companyId: req.user.companyId,
                    entityId: supplierId,
                    entityType: 'SUPPLIER',
                    action: {
                        in: ['SUPPLIER_EMAIL_SENT', 'SUPPLIER_BULK_EMAIL_SENT', 'SUPPLIER_PO_EMAIL_SENT'],
                    },
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
                    action: {
                        in: ['SUPPLIER_EMAIL_SENT', 'SUPPLIER_BULK_EMAIL_SENT', 'SUPPLIER_PO_EMAIL_SENT'],
                    },
                },
            }),
        ]);

        const emailHistory = logs.map(log => ({
            id: log.id,
            type: log.action.replace('SUPPLIER_', '').replace('_SENT', ''),
            subject: log.newData?.subject,
            content: log.newData?.content,
            sentTo: log.newData?.metadata?.to,
            sentAt: log.timestamp,
            sentBy: log.user,
            metadata: log.newData?.metadata,
        }));

        res.json({
            success: true,
            data: emailHistory,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error('Get email history error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const resendEmail = async (req, res) => {
    try {
        const { emailId } = req.params;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_COMMUNICATION_SEND'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to resend emails',
            });
        }

        // Get original email from audit log
        const originalEmail = await prisma.auditLog.findFirst({
            where: {
                id: emailId,
                companyId: req.user.companyId,
                action: {
                    in: ['SUPPLIER_EMAIL_SENT', 'SUPPLIER_BULK_EMAIL_SENT', 'SUPPLIER_PO_EMAIL_SENT'],
                },
            },
        });

        if (!originalEmail) {
            return res.status(404).json({
                success: false,
                message: 'Email record not found',
            });
        }

        // Get supplier details
        const supplier = await prisma.supplier.findFirst({
            where: {
                id: originalEmail.entityId,
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

        // Get company details
        const company = await prisma.company.findUnique({
            where: { id: req.user.companyId },
        });

        // Prepare email options
        const mailOptions = {
            from: `"${company?.name || 'Procurement'}" <${process.env.SMTP_FROM}>`,
            to: supplier.email,
            subject: `[RESEND] ${originalEmail.newData?.subject}`,
            html: originalEmail.newData?.content,
        };

        // Send email
        const info = await transporter.sendMail(mailOptions);

        // Log resend
        await logCommunication(
            supplier.id,
            req.user.userId,
            req.user.companyId,
            'EMAIL_RESEND',
            `[RESEND] ${originalEmail.newData?.subject}`,
            originalEmail.newData?.content,
            {
                to: supplier.email,
                messageId: info.messageId,
                originalEmailId: emailId,
            },
            req
        );

        res.json({
            success: true,
            message: 'Email resent successfully',
            data: {
                messageId: info.messageId,
                to: supplier.email,
                subject: `[RESEND] ${originalEmail.newData?.subject}`,
            },
        });
    } catch (error) {
        console.error('Resend email error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

// ==================== AUTOMATED COMMUNICATIONS ====================

export const sendPOEmail = async (req, res) => {
    try {
        const { supplierId, poId } = req.params;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_COMMUNICATION_SEND'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to send PO emails',
            });
        }

        // Get supplier details
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

        // Get PO details
        const po = await prisma.purchaseOrder.findFirst({
            where: {
                id: poId,
                supplierId,
                companyId: req.user.companyId,
            },
            include: {
                items: true,
                project: {
                    select: {
                        name: true,
                        projectId: true,
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

        // Get company details
        const company = await prisma.company.findUnique({
            where: { id: req.user.companyId },
        });

        // Generate PO summary for email
        const itemsList = po.items.map(item => `
            <tr>
                <td>${item.description}</td>
                <td>${item.quantity} ${item.unit}</td>
                <td>${item.unitPrice}</td>
                <td>${item.totalPrice}</td>
            </tr>
        `).join('');

        const emailContent = `
            <p>Dear ${supplier.name},</p>
            
            <p>A new purchase order has been issued to you. Please find the details below:</p>
            
            <h3>Purchase Order: ${po.poNumber}</h3>
            
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr>
                    <td><strong>Project:</strong></td>
                    <td>${po.project.name} (${po.project.projectId})</td>
                </tr>
                <tr>
                    <td><strong>Order Date:</strong></td>
                    <td>${new Date(po.orderDate).toLocaleDateString()}</td>
                </tr>
                <tr>
                    <td><strong>Expected Delivery:</strong></td>
                    <td>${po.expectedDelivery ? new Date(po.expectedDelivery).toLocaleDateString() : 'Not specified'}</td>
                </tr>
                <tr>
                    <td><strong>Total Amount:</strong></td>
                    <td>${po.currency || 'INR'} ${po.totalAmount}</td>
                </tr>
                <tr>
                    <td><strong>Payment Terms:</strong></td>
                    <td>${po.paymentTerm}</td>
                </tr>
            </table>
            
            <h4>Items:</h4>
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background-color: #f2f2f2;">
                        <th style="padding: 10px; border: 1px solid #ddd;">Description</th>
                        <th style="padding: 10px; border: 1px solid #ddd;">Quantity</th>
                        <th style="padding: 10px; border: 1px solid #ddd;">Unit Price</th>
                        <th style="padding: 10px; border: 1px solid #ddd;">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsList}
                </tbody>
            </table>
            
            <p><strong>Delivery Address:</strong><br>
            ${po.deliveryAddress || company?.officeAddress || 'To be advised'}</p>
            
            <p>Please acknowledge receipt of this purchase order and confirm the delivery schedule.</p>
            
            <br>
            <hr>
            <div style="font-family: Arial, sans-serif; font-size: 12px; color: #666;">
                <p><strong>${company?.name || 'Our Company'}</strong></p>
                <p>${company?.officeAddress || ''}</p>
                <p>Phone: ${company?.phone || ''} | Email: ${company?.email || ''}</p>
            </div>
        `;

        // Send email
        const mailOptions = {
            from: `"${company?.name || 'Procurement'}" <${process.env.SMTP_FROM}>`,
            to: supplier.email,
            subject: `Purchase Order: ${po.poNumber}`,
            html: emailContent,
        };

        const info = await transporter.sendMail(mailOptions);

        // Log communication
        await logCommunication(
            supplierId,
            req.user.userId,
            req.user.companyId,
            'PO_EMAIL',
            `Purchase Order: ${po.poNumber}`,
            emailContent,
            {
                to: supplier.email,
                poNumber: po.poNumber,
                messageId: info.messageId,
            },
            req
        );

        // Update PO to mark email sent
        await prisma.purchaseOrder.update({
            where: { id: poId },
            data: {
                // You might want to add a field to track email sent status
            },
        });

        res.json({
            success: true,
            message: 'PO email sent successfully',
            data: {
                messageId: info.messageId,
                to: supplier.email,
                poNumber: po.poNumber,
            },
        });
    } catch (error) {
        console.error('Send PO email error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const sendPaymentReminder = async (req, res) => {
    try {
        const { supplierId, poId } = req.params;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_COMMUNICATION_SEND'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to send payment reminders',
            });
        }

        // Get supplier details
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

        // Get PO details with payment information
        const po = await prisma.purchaseOrder.findFirst({
            where: {
                id: poId,
                supplierId,
                companyId: req.user.companyId,
            },
            include: {
                payments: {
                    orderBy: { paymentDate: 'desc' },
                },
            },
        });

        if (!po) {
            return res.status(404).json({
                success: false,
                message: 'Purchase order not found',
            });
        }

        if (po.status === 'PAID') {
            return res.status(400).json({
                success: false,
                message: 'This purchase order is already fully paid',
            });
        }

        // Get company details
        const company = await prisma.company.findUnique({
            where: { id: req.user.companyId },
        });

        const dueAmount = po.totalAmount - (po.totalPaid || 0);
        const paymentStatus = po.totalPaid > 0 ? 'Partially Paid' : 'Pending';

        const emailContent = `
            <p>Dear ${supplier.name},</p>
            
            <p>This is a reminder regarding payment for Purchase Order <strong>${po.poNumber}</strong>.</p>
            
            <h3>Payment Status</h3>
            
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr>
                    <td><strong>PO Number:</strong></td>
                    <td>${po.poNumber}</td>
                </tr>
                <tr>
                    <td><strong>Order Date:</strong></td>
                    <td>${new Date(po.orderDate).toLocaleDateString()}</td>
                </tr>
                <tr>
                    <td><strong>Total Amount:</strong></td>
                    <td>${po.currency || 'INR'} ${po.totalAmount}</td>
                </tr>
                <tr>
                    <td><strong>Amount Paid:</strong></td>
                    <td>${po.currency || 'INR'} ${po.totalPaid || 0}</td>
                </tr>
                <tr>
                    <td><strong>Due Amount:</strong></td>
                    <td>${po.currency || 'INR'} ${dueAmount}</td>
                </tr>
                <tr>
                    <td><strong>Payment Status:</strong></td>
                    <td>${paymentStatus}</td>
                </tr>
                <tr>
                    <td><strong>Payment Terms:</strong></td>
                    <td>${po.paymentTerm}</td>
                </tr>
            </table>
            
            ${po.payments.length > 0 ? `
                <h4>Previous Payments:</h4>
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background-color: #f2f2f2;">
                            <th style="padding: 10px; border: 1px solid #ddd;">Date</th>
                            <th style="padding: 10px; border: 1px solid #ddd;">Amount</th>
                            <th style="padding: 10px; border: 1px solid #ddd;">Method</th>
                            <th style="padding: 10px; border: 1px solid #ddd;">Reference</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${po.payments.map(p => `
                            <tr>
                                <td style="padding: 10px; border: 1px solid #ddd;">${new Date(p.paymentDate).toLocaleDateString()}</td>
                                <td style="padding: 10px; border: 1px solid #ddd;">${p.amount}</td>
                                <td style="padding: 10px; border: 1px solid #ddd;">${p.paymentMethod}</td>
                                <td style="padding: 10px; border: 1px solid #ddd;">${p.transactionId || p.referenceNo || 'N/A'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            ` : ''}
            
            <p>Please process the remaining payment of <strong>${po.currency || 'INR'} ${dueAmount}</strong> at your earliest convenience.</p>
            
            <p>If you have already made the payment, please disregard this reminder or provide us with the payment details.</p>
            
            <br>
            <hr>
            <div style="font-family: Arial, sans-serif; font-size: 12px; color: #666;">
                <p><strong>${company?.name || 'Our Company'}</strong></p>
                <p>${company?.officeAddress || ''}</p>
                <p>Phone: ${company?.phone || ''} | Email: ${company?.email || ''}</p>
            </div>
        `;

        // Send email
        const mailOptions = {
            from: `"${company?.name || 'Procurement'}" <${process.env.SMTP_FROM}>`,
            to: supplier.email,
            subject: `Payment Reminder - PO: ${po.poNumber}`,
            html: emailContent,
        };

        const info = await transporter.sendMail(mailOptions);

        // Log communication
        await logCommunication(
            supplierId,
            req.user.userId,
            req.user.companyId,
            'PAYMENT_REMINDER',
            `Payment Reminder - PO: ${po.poNumber}`,
            emailContent,
            {
                to: supplier.email,
                poNumber: po.poNumber,
                dueAmount,
                messageId: info.messageId,
            },
            req
        );

        res.json({
            success: true,
            message: 'Payment reminder sent successfully',
            data: {
                messageId: info.messageId,
                to: supplier.email,
                poNumber: po.poNumber,
                dueAmount,
            },
        });
    } catch (error) {
        console.error('Send payment reminder error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const sendOrderConfirmation = async (req, res) => {
    try {
        const { supplierId, poId } = req.params;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_COMMUNICATION_SEND'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to send order confirmations',
            });
        }

        // Get supplier details
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

        // Get PO details with receipt information
        const po = await prisma.purchaseOrder.findFirst({
            where: {
                id: poId,
                supplierId,
                companyId: req.user.companyId,
                status: 'RECEIVED',
            },
            include: {
                receipts: {
                    include: {
                        items: true,
                        receivedBy: {
                            select: { name: true },
                        },
                    },
                    orderBy: { receiptDate: 'desc' },
                },
                items: true,
            },
        });

        if (!po) {
            return res.status(404).json({
                success: false,
                message: 'Received purchase order not found',
            });
        }

        // Get company details
        const company = await prisma.company.findUnique({
            where: { id: req.user.companyId },
        });

        // Generate receipt summary
        const latestReceipt = po.receipts[0];
        const receiptItemsList = latestReceipt?.items.map(item => `
            <tr>
                <td>${item.poItem?.description || 'Item'}</td>
                <td>${item.receivedQuantity} ${item.unit}</td>
                <td>${item.acceptedQuantity}</td>
                <td>${item.rejectedQuantity}</td>
                <td>${item.condition || 'Good'}</td>
            </tr>
        `).join('') || 'No items recorded';

        const emailContent = `
            <p>Dear ${supplier.name},</p>
            
            <p>We confirm that the goods for Purchase Order <strong>${po.poNumber}</strong> have been received.</p>
            
            <h3>Order Confirmation</h3>
            
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr>
                    <td><strong>PO Number:</strong></td>
                    <td>${po.poNumber}</td>
                </tr>
                <tr>
                    <td><strong>Receipt Number:</strong></td>
                    <td>${latestReceipt?.grNumber || 'N/A'}</td>
                </tr>
                <tr>
                    <td><strong>Receipt Date:</strong></td>
                    <td>${latestReceipt ? new Date(latestReceipt.receiptDate).toLocaleDateString() : 'N/A'}</td>
                </tr>
                <tr>
                    <td><strong>Received By:</strong></td>
                    <td>${latestReceipt?.receivedBy?.name || 'N/A'}</td>
                </tr>
                <tr>
                    <td><strong>Delivery Challan:</strong></td>
                    <td>${latestReceipt?.deliveryChallanNo || 'N/A'}</td>
                </tr>
            </table>
            
            <h4>Received Items:</h4>
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background-color: #f2f2f2;">
                        <th style="padding: 10px; border: 1px solid #ddd;">Item</th>
                        <th style="padding: 10px; border: 1px solid #ddd;">Received</th>
                        <th style="padding: 10px; border: 1px solid #ddd;">Accepted</th>
                        <th style="padding: 10px; border: 1px solid #ddd;">Rejected</th>
                        <th style="padding: 10px; border: 1px solid #ddd;">Condition</th>
                    </tr>
                </thead>
                <tbody>
                    ${receiptItemsList}
                </tbody>
            </table>
            
            ${latestReceipt?.inspectionNotes ? `
                <p><strong>Inspection Notes:</strong> ${latestReceipt.inspectionNotes}</p>
            ` : ''}
            
            <p>Thank you for your timely delivery. We look forward to continued business with you.</p>
            
            <br>
            <hr>
            <div style="font-family: Arial, sans-serif; font-size: 12px; color: #666;">
                <p><strong>${company?.name || 'Our Company'}</strong></p>
                <p>${company?.officeAddress || ''}</p>
                <p>Phone: ${company?.phone || ''} | Email: ${company?.email || ''}</p>
            </div>
        `;

        // Send email
        const mailOptions = {
            from: `"${company?.name || 'Procurement'}" <${process.env.SMTP_FROM}>`,
            to: supplier.email,
            subject: `Order Confirmation - PO: ${po.poNumber}`,
            html: emailContent,
        };

        const info = await transporter.sendMail(mailOptions);

        // Log communication
        await logCommunication(
            supplierId,
            req.user.userId,
            req.user.companyId,
            'ORDER_CONFIRMATION',
            `Order Confirmation - PO: ${po.poNumber}`,
            emailContent,
            {
                to: supplier.email,
                poNumber: po.poNumber,
                grNumber: latestReceipt?.grNumber,
                messageId: info.messageId,
            },
            req
        );

        res.json({
            success: true,
            message: 'Order confirmation sent successfully',
            data: {
                messageId: info.messageId,
                to: supplier.email,
                poNumber: po.poNumber,
                grNumber: latestReceipt?.grNumber,
            },
        });
    } catch (error) {
        console.error('Send order confirmation error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

// ==================== EMAIL TEMPLATES ====================

// Note: You'll need to create an EmailTemplate model in your schema
// For now, we'll use a simple in-memory store or extend the existing models

export const getEmailTemplates = async (req, res) => {
    try {
        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_COMMUNICATION_READ'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view email templates',
            });
        }

        // This is a placeholder - you should create an EmailTemplate model
        // For now, return some default templates
        const templates = [
            {
                id: 'po-creation',
                name: 'Purchase Order Creation',
                subject: 'New Purchase Order: {{poNumber}}',
                body: 'Dear {{supplierName}},\n\nA new purchase order has been created for you.\n\nPO Number: {{poNumber}}\nTotal Amount: {{totalAmount}}\nExpected Delivery: {{expectedDelivery}}\n\nPlease review and confirm.',
                variables: ['supplierName', 'poNumber', 'totalAmount', 'expectedDelivery'],
            },
            {
                id: 'payment-reminder',
                name: 'Payment Reminder',
                subject: 'Payment Reminder - PO: {{poNumber}}',
                body: 'Dear {{supplierName}},\n\nThis is a reminder for payment on PO {{poNumber}}.\n\nDue Amount: {{dueAmount}}\nPlease process at your earliest convenience.',
                variables: ['supplierName', 'poNumber', 'dueAmount'],
            },
            {
                id: 'order-confirmation',
                name: 'Order Confirmation',
                subject: 'Order Confirmation - PO: {{poNumber}}',
                body: 'Dear {{supplierName}},\n\nWe confirm receipt of goods for PO {{poNumber}}.\n\nReceipt Number: {{grNumber}}\nReceipt Date: {{receiptDate}}\n\nThank you for your delivery.',
                variables: ['supplierName', 'poNumber', 'grNumber', 'receiptDate'],
            },
        ];

        res.json({
            success: true,
            data: templates,
        });
    } catch (error) {
        console.error('Get email templates error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const saveEmailTemplate = async (req, res) => {
    try {
        const { name, subject, body, variables } = req.body;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_COMMUNICATION_CREATE'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to save email templates',
            });
        }

        // This is a placeholder - implement with your EmailTemplate model
        const template = {
            id: `template-${Date.now()}`,
            name,
            subject,
            body,
            variables,
            createdBy: req.user.userId,
            createdAt: new Date(),
            companyId: req.user.companyId,
        };

        // Log the template creation
        await logCommunication(
            null,
            req.user.userId,
            req.user.companyId,
            'TEMPLATE_CREATED',
            `Email template created: ${name}`,
            null,
            { template },
            req
        );

        res.status(201).json({
            success: true,
            message: 'Email template saved successfully',
            data: template,
        });
    } catch (error) {
        console.error('Save email template error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

export const sendCustomEmail = async (req, res) => {
    try {
        const { supplierId } = req.params;
        const {
            subject,
            content,
            templateId,
            templateVariables,
            attachments,
        } = req.body;

        const hasPermission = await checkSupplierPermission(
            req.user.userId,
            req.user.companyId,
            'SUPPLIER_COMMUNICATION_SEND'
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to send emails',
            });
        }

        // Get supplier details
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

        // Get company details
        const company = await prisma.company.findUnique({
            where: { id: req.user.companyId },
        });

        let finalContent = content;
        let finalSubject = subject;

        // If using a template, process variables
        if (templateId && templateVariables) {
            // In a real implementation, you would fetch the template and replace variables
            // For now, we'll just use the provided content
            Object.keys(templateVariables).forEach(key => {
                finalContent = finalContent.replace(new RegExp(`{{${key}}}`, 'g'), templateVariables[key]);
                finalSubject = finalSubject.replace(new RegExp(`{{${key}}}`, 'g'), templateVariables[key]);
            });
        }

        // Add company signature
        const emailContent = `
            ${finalContent}
            
            <br><br>
            <hr>
            <div style="font-family: Arial, sans-serif; font-size: 12px; color: #666;">
                <p><strong>${company?.name || 'Our Company'}</strong></p>
                <p>${company?.officeAddress || ''}</p>
                <p>Phone: ${company?.phone || ''} | Email: ${company?.email || ''}</p>
                <p>This is an automated message from our procurement system.</p>
            </div>
        `;

        // Send email
        const mailOptions = {
            from: `"${company?.name || 'Procurement'}" <${process.env.SMTP_FROM}>`,
            to: supplier.email,
            subject: finalSubject,
            html: emailContent,
            attachments: attachments?.map(att => ({
                filename: att.filename,
                path: att.path,
                contentType: att.contentType,
            })),
        };

        const info = await transporter.sendMail(mailOptions);

        // Log communication
        await logCommunication(
            supplierId,
            req.user.userId,
            req.user.companyId,
            'CUSTOM_EMAIL',
            finalSubject,
            finalContent,
            {
                to: supplier.email,
                templateId,
                messageId: info.messageId,
                attachments: attachments?.length || 0,
            },
            req
        );

        res.json({
            success: true,
            message: 'Custom email sent successfully',
            data: {
                messageId: info.messageId,
                to: supplier.email,
                subject: finalSubject,
            },
        });
    } catch (error) {
        console.error('Send custom email error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};