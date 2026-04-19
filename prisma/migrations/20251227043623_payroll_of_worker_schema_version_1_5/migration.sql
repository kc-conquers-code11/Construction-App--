/*
  Warnings:

  - You are about to drop the `_PermissionGranter` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "EquipmentStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'MAINTENANCE', 'REPAIR', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('SCHEDULED', 'BREAKDOWN', 'EMERGENCY', 'UPGRADE');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('PENDING', 'PROCESSED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SafetyStatus" AS ENUM ('PASSED', 'FAILED', 'CONDITIONAL');

-- DropForeignKey
ALTER TABLE "_PermissionGranter" DROP CONSTRAINT "_PermissionGranter_A_fkey";

-- DropForeignKey
ALTER TABLE "_PermissionGranter" DROP CONSTRAINT "_PermissionGranter_B_fkey";

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "geofenceType" TEXT,
ADD COLUMN     "isWithinGeofence" BOOLEAN,
ADD COLUMN     "timesheetId" TEXT;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "attendanceGeofence" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "leavePrefix" TEXT DEFAULT 'LEAVE',
ADD COLUMN     "paymentPrefix" TEXT DEFAULT 'PAY',
ADD COLUMN     "requirePhotoProof" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "safetyCheckFrequency" TEXT DEFAULT 'WEEKLY';

-- AlterTable
ALTER TABLE "Material" ADD COLUMN     "supplier" TEXT,
ADD COLUMN     "supplierContact" TEXT,
ADD COLUMN     "unitPrice" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ProjectSettings" ADD COLUMN     "qualityStandards" JSONB,
ADD COLUMN     "safetyRequirements" JSONB;

-- AlterTable
ALTER TABLE "StockAlert" ADD COLUMN     "resolvedById" TEXT;

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "emailPreferences" JSONB;

-- DropTable
DROP TABLE "_PermissionGranter";

-- CreateTable
CREATE TABLE "ProjectAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "roleId" TEXT,
    "designation" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timesheet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "weekStartDate" DATE NOT NULL,
    "weekEndDate" DATE NOT NULL,
    "regularHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overtimeHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,

    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payroll" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "basicSalary" DOUBLE PRECISION NOT NULL,
    "allowances" JSONB,
    "deductions" JSONB,
    "overtimePay" DOUBLE PRECISION DEFAULT 0,
    "bonus" DOUBLE PRECISION DEFAULT 0,
    "netSalary" DOUBLE PRECISION NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'PENDING',
    "paidDate" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payroll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "model" TEXT,
    "serialNumber" TEXT,
    "registrationNumber" TEXT,
    "status" "EquipmentStatus" NOT NULL DEFAULT 'AVAILABLE',
    "projectId" TEXT,
    "assignedToId" TEXT,
    "assignedDate" TIMESTAMP(3),
    "manufacturer" TEXT,
    "year" INTEGER,
    "capacity" TEXT,
    "fuelType" TEXT,
    "lastServiceDate" TIMESTAMP(3),
    "nextServiceDate" TIMESTAMP(3),
    "purchaseDate" TIMESTAMP(3),
    "purchaseCost" DOUBLE PRECISION,
    "currentValue" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentMaintenance" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "maintenanceDate" TIMESTAMP(3) NOT NULL,
    "type" "MaintenanceType" NOT NULL,
    "description" TEXT NOT NULL,
    "cost" DOUBLE PRECISION,
    "partsReplaced" JSONB,
    "performedById" TEXT,
    "nextDueDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentMaintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyCheck" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conductedById" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "checklist" JSONB NOT NULL,
    "status" "SafetyStatus" NOT NULL,
    "issuesFound" TEXT,
    "correctiveActions" TEXT,
    "followUpDate" TIMESTAMP(3),
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectAssignment_projectId_idx" ON "ProjectAssignment"("projectId");

-- CreateIndex
CREATE INDEX "ProjectAssignment_userId_idx" ON "ProjectAssignment"("userId");

-- CreateIndex
CREATE INDEX "ProjectAssignment_roleId_idx" ON "ProjectAssignment"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAssignment_userId_projectId_startDate_key" ON "ProjectAssignment"("userId", "projectId", "startDate");

-- CreateIndex
CREATE INDEX "Timesheet_userId_idx" ON "Timesheet"("userId");

-- CreateIndex
CREATE INDEX "Timesheet_projectId_idx" ON "Timesheet"("projectId");

-- CreateIndex
CREATE INDEX "Timesheet_approvedById_idx" ON "Timesheet"("approvedById");

-- CreateIndex
CREATE UNIQUE INDEX "Timesheet_userId_projectId_weekStartDate_key" ON "Timesheet"("userId", "projectId", "weekStartDate");

-- CreateIndex
CREATE INDEX "Payroll_userId_idx" ON "Payroll"("userId");

-- CreateIndex
CREATE INDEX "Payroll_companyId_idx" ON "Payroll"("companyId");

-- CreateIndex
CREATE INDEX "Payroll_approvedById_idx" ON "Payroll"("approvedById");

-- CreateIndex
CREATE UNIQUE INDEX "Payroll_userId_companyId_month_year_key" ON "Payroll"("userId", "companyId", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_serialNumber_key" ON "Equipment"("serialNumber");

-- CreateIndex
CREATE INDEX "Equipment_companyId_idx" ON "Equipment"("companyId");

-- CreateIndex
CREATE INDEX "Equipment_projectId_idx" ON "Equipment"("projectId");

-- CreateIndex
CREATE INDEX "Equipment_assignedToId_idx" ON "Equipment"("assignedToId");

-- CreateIndex
CREATE INDEX "Equipment_status_idx" ON "Equipment"("status");

-- CreateIndex
CREATE INDEX "EquipmentMaintenance_equipmentId_idx" ON "EquipmentMaintenance"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentMaintenance_performedById_idx" ON "EquipmentMaintenance"("performedById");

-- CreateIndex
CREATE INDEX "EquipmentMaintenance_maintenanceDate_idx" ON "EquipmentMaintenance"("maintenanceDate");

-- CreateIndex
CREATE INDEX "SafetyCheck_projectId_idx" ON "SafetyCheck"("projectId");

-- CreateIndex
CREATE INDEX "SafetyCheck_companyId_idx" ON "SafetyCheck"("companyId");

-- CreateIndex
CREATE INDEX "SafetyCheck_conductedById_idx" ON "SafetyCheck"("conductedById");

-- CreateIndex
CREATE INDEX "SafetyCheck_date_idx" ON "SafetyCheck"("date");

-- CreateIndex
CREATE INDEX "Attendance_markedById_idx" ON "Attendance"("markedById");

-- CreateIndex
CREATE INDEX "Attendance_timesheetId_idx" ON "Attendance"("timesheetId");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_idx" ON "AuditLog"("companyId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_idx" ON "AuditLog"("entityType");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "Client_createdById_idx" ON "Client"("createdById");

-- CreateIndex
CREATE INDEX "Company_createdById_idx" ON "Company"("createdById");

-- CreateIndex
CREATE INDEX "DPRPhoto_uploadedById_idx" ON "DPRPhoto"("uploadedById");

-- CreateIndex
CREATE INDEX "DailyProgressReport_preparedById_idx" ON "DailyProgressReport"("preparedById");

-- CreateIndex
CREATE INDEX "DailyProgressReport_approvedById_idx" ON "DailyProgressReport"("approvedById");

-- CreateIndex
CREATE INDEX "Document_uploadedById_idx" ON "Document"("uploadedById");

-- CreateIndex
CREATE INDEX "Document_documentType_idx" ON "Document"("documentType");

-- CreateIndex
CREATE INDEX "Expense_createdById_idx" ON "Expense"("createdById");

-- CreateIndex
CREATE INDEX "Expense_approvedById_idx" ON "Expense"("approvedById");

-- CreateIndex
CREATE INDEX "Invoice_clientId_idx" ON "Invoice"("clientId");

-- CreateIndex
CREATE INDEX "Invoice_createdById_idx" ON "Invoice"("createdById");

-- CreateIndex
CREATE INDEX "Invoice_approvedById_idx" ON "Invoice"("approvedById");

-- CreateIndex
CREATE INDEX "Leave_approvedById_idx" ON "Leave"("approvedById");

-- CreateIndex
CREATE INDEX "Material_createdById_idx" ON "Material"("createdById");

-- CreateIndex
CREATE INDEX "MaterialRequest_materialId_idx" ON "MaterialRequest"("materialId");

-- CreateIndex
CREATE INDEX "MaterialRequest_requestedById_idx" ON "MaterialRequest"("requestedById");

-- CreateIndex
CREATE INDEX "MaterialRequest_approvedById_idx" ON "MaterialRequest"("approvedById");

-- CreateIndex
CREATE INDEX "MaterialRequest_orderedById_idx" ON "MaterialRequest"("orderedById");

-- CreateIndex
CREATE INDEX "Message_receiverId_idx" ON "Message"("receiverId");

-- CreateIndex
CREATE INDEX "Message_projectId_idx" ON "Message"("projectId");

-- CreateIndex
CREATE INDEX "Milestone_createdById_idx" ON "Milestone"("createdById");

-- CreateIndex
CREATE INDEX "Notification_type_idx" ON "Notification"("type");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Payment_clientId_idx" ON "Payment"("clientId");

-- CreateIndex
CREATE INDEX "Payment_receivedById_idx" ON "Payment"("receivedById");

-- CreateIndex
CREATE INDEX "Payment_createdById_idx" ON "Payment"("createdById");

-- CreateIndex
CREATE INDEX "Project_createdById_idx" ON "Project"("createdById");

-- CreateIndex
CREATE INDEX "RolePermission_grantedById_idx" ON "RolePermission"("grantedById");

-- CreateIndex
CREATE INDEX "StockAlert_resolvedById_idx" ON "StockAlert"("resolvedById");

-- CreateIndex
CREATE INDEX "StockTransaction_projectId_idx" ON "StockTransaction"("projectId");

-- CreateIndex
CREATE INDEX "StockTransaction_createdById_idx" ON "StockTransaction"("createdById");

-- CreateIndex
CREATE INDEX "Subtask_createdById_idx" ON "Subtask"("createdById");

-- CreateIndex
CREATE INDEX "Task_createdById_idx" ON "Task"("createdById");

-- CreateIndex
CREATE INDEX "TaskAttachment_uploadedById_idx" ON "TaskAttachment"("uploadedById");

-- CreateIndex
CREATE INDEX "TaskComment_userId_idx" ON "TaskComment"("userId");

-- CreateIndex
CREATE INDEX "User_createdById_idx" ON "User"("createdById");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payroll" ADD CONSTRAINT "Payroll_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payroll" ADD CONSTRAINT "Payroll_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payroll" ADD CONSTRAINT "Payroll_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMaintenance" ADD CONSTRAINT "EquipmentMaintenance_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMaintenance" ADD CONSTRAINT "EquipmentMaintenance_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyCheck" ADD CONSTRAINT "SafetyCheck_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyCheck" ADD CONSTRAINT "SafetyCheck_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyCheck" ADD CONSTRAINT "SafetyCheck_conductedById_fkey" FOREIGN KEY ("conductedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyCheck" ADD CONSTRAINT "SafetyCheck_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAlert" ADD CONSTRAINT "StockAlert_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
