import PDFDocument from 'pdfkit';
import prisma from '../config/database.js';

class PDFGenerator {
  constructor() {
    this.doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      bufferPages: true,
      font: 'Helvetica',
    });
  }

  // Helper to format currency
  formatCurrency(amount, currency = 'INR') {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount || 0);
  }

  // Helper to format date
  formatDate(date) {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  // Add header with company logo and info
  async addHeader(company) {
    const { doc } = this;

    // Company Name/Logo
    doc
      .fontSize(20)
      .font('Helvetica-Bold')
      .text(company?.name || 'Company Name', 50, 50, { align: 'left' });

    // Purchase Order title
    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .text('PURCHASE ORDER', 50, 80, { align: 'left' });

    // Company details
    doc
      .fontSize(8)
      .font('Helvetica')
      .text(company?.address || '', 50, 105)
      .text(`GST: ${company?.gst || 'N/A'}`, 50, 120)
      .text(`PAN: ${company?.pan || 'N/A'}`, 50, 135)
      .text(`Email: ${company?.email || 'N/A'}`, 50, 150)
      .text(`Phone: ${company?.phone || 'N/A'}`, 50, 165);

    // Draw line
    doc.moveTo(50, 185).lineTo(550, 185).stroke();
  }

  // Add PO information section
  addPOInfo(po) {
    const { doc } = this;

    // PO Details
    doc.fontSize(10).font('Helvetica-Bold').text('PO Details:', 50, 200);

    doc
      .font('Helvetica')
      .fontSize(9)
      .text(`PO Number:`, 50, 215)
      .font('Helvetica-Bold')
      .text(po.poNumber, 120, 215)
      .font('Helvetica')
      .text(`PO Date:`, 50, 230)
      .font('Helvetica-Bold')
      .text(this.formatDate(po.orderDate), 120, 230)
      .font('Helvetica')
      .text(`Status:`, 50, 245)
      .font('Helvetica-Bold')
      .text(po.status, 120, 245);

    // Project Details
    doc
      .font('Helvetica')
      .text('Project:', 250, 215)
      .font('Helvetica-Bold')
      .text(po.project?.name || 'N/A', 300, 215)
      .font('Helvetica')
      .text('Expected Delivery:', 250, 230)
      .font('Helvetica-Bold')
      .text(this.formatDate(po.expectedDelivery), 340, 230)
      .font('Helvetica')
      .text('Payment Term:', 250, 245)
      .font('Helvetica-Bold')
      .text(po.paymentTerm || 'NET_30', 340, 245);

    // Draw line
    doc.moveTo(50, 270).lineTo(550, 270).stroke();
  }

  // Add supplier information
  addSupplierInfo(po) {
    const { doc } = this;

    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('Supplier Information:', 50, 285);

    doc
      .font('Helvetica')
      .fontSize(9)
      .text('Name:', 50, 300)
      .font('Helvetica-Bold')
      .text(po.supplierName || 'N/A', 100, 300)
      .font('Helvetica')
      .text('Address:', 50, 315)
      .font('Helvetica-Bold')
      .text(po.supplierAddress || 'N/A', 100, 315, { width: 200 })
      .font('Helvetica')
      .text('GST:', 50, 350)
      .font('Helvetica-Bold')
      .text(po.supplierGST || 'N/A', 100, 350)
      .font('Helvetica')
      .text('PAN:', 50, 365)
      .font('Helvetica-Bold')
      .text(po.supplierPAN || 'N/A', 100, 365);

    doc
      .font('Helvetica')
      .text('Contact:', 300, 300)
      .font('Helvetica-Bold')
      .text(po.supplierContact || 'N/A', 360, 300)
      .font('Helvetica')
      .text('Email:', 300, 315)
      .font('Helvetica-Bold')
      .text(po.supplierEmail || 'N/A', 360, 315, { width: 190 })
      .font('Helvetica')
      .text('Phone:', 300, 350)
      .font('Helvetica-Bold')
      .text(po.supplierPhone || 'N/A', 360, 350);

    // Draw line
    doc.moveTo(50, 390).lineTo(550, 390).stroke();
  }

  // Add delivery information
  addDeliveryInfo(po) {
    const { doc } = this;

    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('Delivery Information:', 50, 405);

    doc
      .font('Helvetica')
      .fontSize(9)
      .text('Delivery Address:', 50, 420)
      .font('Helvetica-Bold')
      .text(po.deliveryAddress || 'N/A', 150, 420, { width: 350 })
      .font('Helvetica')
      .text('Shipping Method:', 50, 460)
      .font('Helvetica-Bold')
      .text(po.shippingMethod || 'N/A', 150, 460)
      .font('Helvetica')
      .text('Shipping Terms:', 50, 475)
      .font('Helvetica-Bold')
      .text(po.shippingTerms || 'N/A', 150, 475);

    // Draw line
    doc.moveTo(50, 500).lineTo(550, 500).stroke();
  }

  // Add items table
  async addItemsTable(items) {
    const { doc } = this;

    doc.fontSize(10).font('Helvetica-Bold').text('Items:', 50, 515);

    const tableTop = 535;
    const itemSpacing = 20;

    // Table headers
    doc
      .fontSize(8)
      .font('Helvetica-Bold')
      .text('#', 50, tableTop)
      .text('Description', 70, tableTop)
      .text('Qty', 250, tableTop)
      .text('Unit', 290, tableTop)
      .text('Unit Price', 330, tableTop)
      .text('Discount', 390, tableTop)
      .text('Tax %', 440, tableTop)
      .text('Total', 490, tableTop);

    // Draw header line
    doc
      .moveTo(50, tableTop + 15)
      .lineTo(550, tableTop + 15)
      .stroke();

    let yPosition = tableTop + 25;

    // Table rows
    items.forEach((item, index) => {
      // Check if we need a new page
      if (yPosition > 750) {
        doc.addPage();
        yPosition = 50;

        // Add headers on new page
        doc
          .fontSize(8)
          .font('Helvetica-Bold')
          .text('#', 50, yPosition)
          .text('Description', 70, yPosition)
          .text('Qty', 250, yPosition)
          .text('Unit', 290, yPosition)
          .text('Unit Price', 330, yPosition)
          .text('Discount', 390, yPosition)
          .text('Tax %', 440, yPosition)
          .text('Total', 490, yPosition);

        doc
          .moveTo(50, yPosition + 15)
          .lineTo(550, yPosition + 15)
          .stroke();

        yPosition += 25;
      }

      doc
        .font('Helvetica')
        .fontSize(8)
        .text(index + 1, 50, yPosition)
        .text(item.description || 'N/A', 70, yPosition, { width: 175 })
        .text(item.quantity.toString(), 250, yPosition)
        .text(item.unit || 'N/A', 290, yPosition)
        .text(this.formatCurrency(item.unitPrice), 330, yPosition)
        .text(
          item.discountPercent ? `${item.discountPercent}%` : '-',
          390,
          yPosition
        )
        .text(item.taxPercent ? `${item.taxPercent}%` : '18%', 440, yPosition)
        .text(
          this.formatCurrency(item.totalPrice + (item.taxAmount || 0)),
          490,
          yPosition
        );

      yPosition += 20;
    });

    // Draw bottom line
    doc.moveTo(50, yPosition).lineTo(550, yPosition).stroke();

    return yPosition;
  }

  // Add summary section
  addSummary(po, yPosition) {
    const { doc } = this;

    yPosition += 20;

    // Summary calculations
    const subtotal = po.subtotal || 0;
    const taxAmount = po.taxAmount || 0;
    const discount = po.discount || 0;
    const shippingCost = po.shippingCost || 0;
    const otherCharges = po.otherCharges || 0;
    const total = po.totalAmount || 0;

    doc
      .font('Helvetica')
      .fontSize(9)
      .text('Subtotal:', 400, yPosition)
      .font('Helvetica-Bold')
      .text(this.formatCurrency(subtotal), 480, yPosition);

    if (discount > 0) {
      yPosition += 15;
      doc
        .font('Helvetica')
        .text(
          `Discount (${po.discountType === 'PERCENTAGE' ? discount + '%' : 'Fixed'}):`,
          400,
          yPosition
        )
        .font('Helvetica-Bold')
        .text(`-${this.formatCurrency(discount)}`, 480, yPosition);
    }

    if (taxAmount > 0) {
      yPosition += 15;
      doc
        .font('Helvetica')
        .text('Tax Amount:', 400, yPosition)
        .font('Helvetica-Bold')
        .text(this.formatCurrency(taxAmount), 480, yPosition);
    }

    if (shippingCost > 0) {
      yPosition += 15;
      doc
        .font('Helvetica')
        .text('Shipping:', 400, yPosition)
        .font('Helvetica-Bold')
        .text(this.formatCurrency(shippingCost), 480, yPosition);
    }

    if (otherCharges > 0) {
      yPosition += 15;
      doc
        .font('Helvetica')
        .text('Other Charges:', 400, yPosition)
        .font('Helvetica-Bold')
        .text(this.formatCurrency(otherCharges), 480, yPosition);
    }

    yPosition += 20;
    doc
      .moveTo(400, yPosition - 5)
      .lineTo(550, yPosition - 5)
      .stroke();

    yPosition += 5;
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('TOTAL:', 400, yPosition)
      .text(this.formatCurrency(total), 480, yPosition);

    // Payment Info
    if (po.advancePercentage) {
      yPosition += 25;
      doc
        .font('Helvetica')
        .fontSize(9)
        .text(
          `Advance Payment: ${po.advancePercentage}% (${this.formatCurrency(po.advanceAmount)})`,
          50,
          yPosition
        );
    }

    return yPosition;
  }

  // Add notes and terms
  addNotesAndTerms(po, yPosition) {
    const { doc } = this;

    yPosition += 30;

    if (po.notes) {
      doc.fontSize(9).font('Helvetica-Bold').text('Notes:', 50, yPosition);

      yPosition += 15;
      doc
        .font('Helvetica')
        .text(po.notes, 50, yPosition, { width: 500, align: 'left' });

      yPosition += 30;
    }

    if (po.terms) {
      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .text('Terms & Conditions:', 50, yPosition);

      yPosition += 15;
      doc
        .font('Helvetica')
        .text(po.terms, 50, yPosition, { width: 500, align: 'left' });

      yPosition += 30;
    }

    return yPosition;
  }

  // Add footer
  addFooter() {
    const { doc } = this;
    const pages = doc.bufferedPageRange();

    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);

      // Footer line
      doc.moveTo(50, 780).lineTo(550, 780).stroke();

      // Page number
      doc
        .fontSize(8)
        .font('Helvetica')
        .text(`Page ${i + 1} of ${pages.count}`, 50, 785, {
          align: 'center',
          width: 500,
        });

      // Generated date
      doc.text(`Generated on: ${this.formatDate(new Date())}`, 50, 800, {
        align: 'center',
        width: 500,
      });

      // Signature line
      if (i === pages.count - 1) {
        doc.text('Authorized Signatory', 450, 750);
        doc.moveTo(450, 745).lineTo(550, 745).stroke();
      }
    }
  }

  // Generate PDF for purchase order
  async generatePurchaseOrderPDF(po) {
    // Get company details
    const company =
      po.company ||
      (await prisma.company.findUnique({
        where: { id: po.companyId },
      }));

    // Add header
    await this.addHeader(company);

    // Add PO info
    this.addPOInfo(po);

    // Add supplier info
    this.addSupplierInfo(po);

    // Add delivery info
    this.addDeliveryInfo(po);

    // Add items table and get last Y position
    const lastY = await this.addItemsTable(po.items);

    // Add summary
    const summaryY = this.addSummary(po, lastY);

    // Add notes and terms
    const finalY = this.addNotesAndTerms(po, summaryY);

    // Add footer
    this.addFooter();

    return this.doc;
  }

  // Generate PDF for goods receipt (GRN)
  async generateGoodsReceiptPDF(receipt) {
    const { doc } = this;

    // Get company details
    const company =
      receipt.purchaseOrder?.company ||
      (await prisma.company.findUnique({
        where: { id: receipt.purchaseOrder?.companyId },
      }));

    // --- Header ---
    // Company Logo/Name
    doc
      .fontSize(20)
      .font('Helvetica-Bold')
      .text(company?.name?.toUpperCase() || 'COMPANY NAME', 50, 50);

    doc
      .fontSize(14)
      .font('Helvetica')
      .text(company?.registrationNumber ? 'LIFESPACES LLP' : '', 50, 75); // Standardized if needed, but using name

    // Company Address (Right aligned)
    doc
      .fontSize(8)
      .font('Helvetica')
      .text(`Address: ${company?.officeAddress || 'N/A'}`, 350, 50, {
        width: 200,
        align: 'right',
      })
      .text(`Tel: ${company?.phone || 'N/A'}`, 350, 85, {
        width: 200,
        align: 'right',
      })
      .text(`E-mail: ${company?.email || 'N/A'}`, 350, 95, {
        width: 200,
        align: 'right',
      });

    // Title
    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .text('● GOOD RECEIVED NOTE (GRN) ●', 50, 130, { align: 'center' });

    // --- Basic Info Section ---
    let y = 170;
    const labelX = 50;
    const valueX = 180;
    const rightLabelX = 350;
    const rightValueX = 450;

    doc.fontSize(10).font('Helvetica');

    // Site
    doc.text('Site :', labelX, y);
    doc.text(receipt.project?.name || 'N/A', valueX, y);
    y += 25;

    // Challan No and Date
    doc.text('Challan No.', labelX, y);
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .fillColor('red')
      .text(receipt.grNumber, valueX + 50, y - 5);
    doc.fontSize(10).font('Helvetica').fillColor('black');

    doc.text('Date :', rightLabelX, y);
    doc.text(this.formatDate(receipt.receiptDate), rightValueX, y);

    // Draw lines for Challan No and Date
    doc
      .moveTo(valueX + 50, y + 12)
      .lineTo(330, y + 12)
      .stroke();
    doc
      .moveTo(450, y + 12)
      .lineTo(550, y + 12)
      .stroke();
    y += 25;

    // Supplier's Name
    doc.text("Supplier's Name", labelX, y);
    doc.text(
      receipt.purchaseOrder?.supplier?.name ||
        receipt.purchaseOrder?.supplierName ||
        'N/A',
      valueX,
      y
    );
    doc
      .moveTo(180, y + 12)
      .lineTo(550, y + 12)
      .stroke();
    y += 25;

    // Supplier's Challan No. and Date
    doc.text("Supplier's Challan No. :", labelX, y);
    doc.text(receipt.deliveryChallanNo || 'N/A', valueX + 30, y);

    doc.text('Date :', rightLabelX, y);
    doc.text(this.formatDate(receipt.receiptDate), rightValueX, y); // Using receipt date as placeholder if no challan date

    doc
      .moveTo(210, y + 12)
      .lineTo(330, y + 12)
      .stroke();
    doc
      .moveTo(450, y + 12)
      .lineTo(550, y + 12)
      .stroke();
    y += 30;

    // Material Received (Table equivalent to the lines in image)
    doc.text('Material Received :', labelX, y);
    y += 20;

    // Draw Table / Lines for materials
    const tableTop = y;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('S.No', 50, tableTop);
    doc.text('Description', 100, tableTop);
    doc.text('Qty', 350, tableTop);
    doc.text('Unit', 400, tableTop);
    doc.text('Remarks', 450, tableTop);

    doc
      .moveTo(50, tableTop + 12)
      .lineTo(550, tableTop + 12)
      .stroke();
    y = tableTop + 20;

    receipt.items.forEach((item, index) => {
      doc.font('Helvetica').fontSize(9);
      doc.text(index + 1, 50, y);
      doc.text(
        item.poItem?.material?.name || item.poItem?.description || 'N/A',
        100,
        y,
        { width: 240 }
      );
      doc.text(item.receivedQuantity.toString(), 350, y);
      doc.text(item.unit || 'N/A', 400, y);
      doc.text(item.notes || '-', 450, y, { width: 100 });

      const textHeight = doc.heightOfString(
        item.poItem?.material?.name || item.poItem?.description || 'N/A',
        { width: 240 }
      );
      y += Math.max(textHeight, 20);

      // Draw horizontal lines between items to match form
      doc
        .moveTo(50, y - 2)
        .lineTo(550, y - 2)
        .dash(1, { space: 0 })
        .stroke()
        .undash();
    });

    // Fill the rest of the page with lines if needed, but we'll stop if it's too many
    const minimumY = 600;
    while (y < minimumY) {
      doc.moveTo(50, y).lineTo(550, y).dash(1, { space: 1 }).stroke().undash();
      y += 20;
    }

    y += 20;

    // --- Footer Fields ---
    doc.fontSize(10).font('Helvetica');

    // Vehicle info
    doc.text('Vehicle No.', labelX, y);
    doc.text(`: ${receipt.vehicleNo || 'N/A'}`, valueX, y);
    y += 25;

    doc.text("Driver's Name", labelX, y);
    doc.text(`: ${receipt.receivedFrom || 'N/A'}`, valueX, y);
    y += 25;

    doc.text('Delivery Time', labelX, y);
    doc.text(`: ${receipt.receivedAt || 'N/A'}`, valueX, y);
    y += 50;

    // Signature Area
    doc
      .font('Helvetica-Bold')
      .text('Store Manager / Site Supervisor', 350, y, {
        align: 'right',
        width: 200,
      });
    y += 40;

    // Remarks and PO Ref
    doc.font('Helvetica').text('Office Remarks', labelX, y);
    doc.text(`: ${receipt.notes || ''}`, valueX, y);
    doc
      .moveTo(valueX, y + 12)
      .lineTo(550, y + 12)
      .stroke();
    y += 25;

    doc.text('Purchase Order Ref. No.', labelX, y);
    doc.text(`: ${receipt.purchaseOrder?.poNumber || 'N/A'}`, valueX + 50, y);
    doc
      .moveTo(valueX + 50, y + 12)
      .lineTo(550, y + 12)
      .stroke();

    return this.doc;
  }
}

export default PDFGenerator;
