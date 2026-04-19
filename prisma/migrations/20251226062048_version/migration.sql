/*
  Warnings:

  - The primary key for the `Attendance` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `AuditLog` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `ipAddress` on the `AuditLog` table. All the data in the column will be lost.
  - You are about to drop the column `userAgent` on the `AuditLog` table. All the data in the column will be lost.
  - The primary key for the `Client` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Company` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `address` on the `Company` table. All the data in the column will be lost.
  - You are about to drop the column `panNumber` on the `Company` table. All the data in the column will be lost.
  - The primary key for the `CompanySettings` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `DPRPhoto` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `DailyProgressReport` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Document` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Expense` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Invoice` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `InvoiceItem` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Leave` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Material` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `MaterialRequest` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Message` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Milestone` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Notification` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Payment` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Permission` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Project` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `managerId` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `siteEngineerId` on the `Project` table. All the data in the column will be lost.
  - The primary key for the `Role` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `RolePermission` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Subtask` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Task` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `TaskAttachment` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `TaskComment` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `User` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `UserSettings` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the `Inspection` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Meeting` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `MeetingAttendance` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `MeetingMinute` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SafetyIncident` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SafetyTraining` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SafetyTrainingAttendance` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `companyId` on table `Client` required. This step will fail if there are existing NULL values in that column.
  - Changed the type of `category` on the `Expense` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Made the column `companyId` on table `Material` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `latitude` to the `Project` table without a default value. This is not possible if the table is not empty.
  - Added the required column `longitude` to the `Project` table without a default value. This is not possible if the table is not empty.
  - Made the column `location` on table `Project` required. This step will fail if there are existing NULL values in that column.
  - Made the column `companyId` on table `Project` required. This step will fail if there are existing NULL values in that column.
  - Made the column `phone` on table `User` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('MATERIAL', 'LABOR', 'EQUIPMENT_RENTAL', 'TRANSPORTATION', 'OFFICE_SUPPLIES', 'UTILITIES', 'MAINTENANCE', 'TRAVEL', 'FOOD', 'ACCOMMODATION', 'PERMITS', 'INSURANCE', 'PROFESSIONAL_FEES', 'ADVERTISING', 'OTHER');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'RETIRED', 'INJURED', 'TERMINATED', 'ON_PROBATION');

-- CreateEnum
CREATE TYPE "SalaryType" AS ENUM ('HOURLY', 'MONTHLY', 'DAILY', 'WEEKLY', 'PROJECT_BASED');

-- DropForeignKey
ALTER TABLE "Attendance" DROP CONSTRAINT "Attendance_markedById_fkey";

-- DropForeignKey
ALTER TABLE "Attendance" DROP CONSTRAINT "Attendance_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Attendance" DROP CONSTRAINT "Attendance_userId_fkey";

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_userId_fkey";

-- DropForeignKey
ALTER TABLE "Client" DROP CONSTRAINT "Client_companyId_fkey";

-- DropForeignKey
ALTER TABLE "Client" DROP CONSTRAINT "Client_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Company" DROP CONSTRAINT "Company_createdById_fkey";

-- DropForeignKey
ALTER TABLE "CompanySettings" DROP CONSTRAINT "CompanySettings_companyId_fkey";

-- DropForeignKey
ALTER TABLE "DPRPhoto" DROP CONSTRAINT "DPRPhoto_dprId_fkey";

-- DropForeignKey
ALTER TABLE "DPRPhoto" DROP CONSTRAINT "DPRPhoto_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "DailyProgressReport" DROP CONSTRAINT "DailyProgressReport_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "DailyProgressReport" DROP CONSTRAINT "DailyProgressReport_preparedById_fkey";

-- DropForeignKey
ALTER TABLE "DailyProgressReport" DROP CONSTRAINT "DailyProgressReport_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Inspection" DROP CONSTRAINT "Inspection_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Inspection" DROP CONSTRAINT "Inspection_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_clientId_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_projectId_fkey";

-- DropForeignKey
ALTER TABLE "InvoiceItem" DROP CONSTRAINT "InvoiceItem_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "Leave" DROP CONSTRAINT "Leave_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "Leave" DROP CONSTRAINT "Leave_userId_fkey";

-- DropForeignKey
ALTER TABLE "Material" DROP CONSTRAINT "Material_companyId_fkey";

-- DropForeignKey
ALTER TABLE "Material" DROP CONSTRAINT "Material_createdById_fkey";

-- DropForeignKey
ALTER TABLE "MaterialRequest" DROP CONSTRAINT "MaterialRequest_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "MaterialRequest" DROP CONSTRAINT "MaterialRequest_materialId_fkey";

-- DropForeignKey
ALTER TABLE "MaterialRequest" DROP CONSTRAINT "MaterialRequest_orderedById_fkey";

-- DropForeignKey
ALTER TABLE "MaterialRequest" DROP CONSTRAINT "MaterialRequest_projectId_fkey";

-- DropForeignKey
ALTER TABLE "MaterialRequest" DROP CONSTRAINT "MaterialRequest_requestedById_fkey";

-- DropForeignKey
ALTER TABLE "Meeting" DROP CONSTRAINT "Meeting_organizerId_fkey";

-- DropForeignKey
ALTER TABLE "Meeting" DROP CONSTRAINT "Meeting_projectId_fkey";

-- DropForeignKey
ALTER TABLE "MeetingAttendance" DROP CONSTRAINT "MeetingAttendance_meetingId_fkey";

-- DropForeignKey
ALTER TABLE "MeetingAttendance" DROP CONSTRAINT "MeetingAttendance_userId_fkey";

-- DropForeignKey
ALTER TABLE "MeetingMinute" DROP CONSTRAINT "MeetingMinute_assignedToId_fkey";

-- DropForeignKey
ALTER TABLE "MeetingMinute" DROP CONSTRAINT "MeetingMinute_createdById_fkey";

-- DropForeignKey
ALTER TABLE "MeetingMinute" DROP CONSTRAINT "MeetingMinute_meetingId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_receiverId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_senderId_fkey";

-- DropForeignKey
ALTER TABLE "Milestone" DROP CONSTRAINT "Milestone_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Milestone" DROP CONSTRAINT "Milestone_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_clientId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_receivedById_fkey";

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_clientId_fkey";

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_companyId_fkey";

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_managerId_fkey";

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_siteEngineerId_fkey";

-- DropForeignKey
ALTER TABLE "Role" DROP CONSTRAINT "Role_createdById_fkey";

-- DropForeignKey
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_grantedById_fkey";

-- DropForeignKey
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_permissionId_fkey";

-- DropForeignKey
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_roleId_fkey";

-- DropForeignKey
ALTER TABLE "SafetyIncident" DROP CONSTRAINT "SafetyIncident_projectId_fkey";

-- DropForeignKey
ALTER TABLE "SafetyIncident" DROP CONSTRAINT "SafetyIncident_reportedById_fkey";

-- DropForeignKey
ALTER TABLE "SafetyTraining" DROP CONSTRAINT "SafetyTraining_createdById_fkey";

-- DropForeignKey
ALTER TABLE "SafetyTrainingAttendance" DROP CONSTRAINT "SafetyTrainingAttendance_trainingId_fkey";

-- DropForeignKey
ALTER TABLE "SafetyTrainingAttendance" DROP CONSTRAINT "SafetyTrainingAttendance_userId_fkey";

-- DropForeignKey
ALTER TABLE "Subtask" DROP CONSTRAINT "Subtask_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Subtask" DROP CONSTRAINT "Subtask_taskId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_assignedToId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_projectId_fkey";

-- DropForeignKey
ALTER TABLE "TaskAttachment" DROP CONSTRAINT "TaskAttachment_taskId_fkey";

-- DropForeignKey
ALTER TABLE "TaskAttachment" DROP CONSTRAINT "TaskAttachment_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "TaskComment" DROP CONSTRAINT "TaskComment_taskId_fkey";

-- DropForeignKey
ALTER TABLE "TaskComment" DROP CONSTRAINT "TaskComment_userId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_createdById_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_roleId_fkey";

-- DropForeignKey
ALTER TABLE "UserSettings" DROP CONSTRAINT "UserSettings_userId_fkey";

-- DropIndex
DROP INDEX "Company_panNumber_key";

-- DropIndex
DROP INDEX "Project_managerId_idx";

-- DropIndex
DROP INDEX "Project_siteEngineerId_idx";

-- AlterTable
ALTER TABLE "Attendance" DROP CONSTRAINT "Attendance_pkey",
ADD COLUMN     "checkInAccuracy" DOUBLE PRECISION,
ADD COLUMN     "checkInDistance" DOUBLE PRECISION,
ADD COLUMN     "isVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verificationNotes" TEXT,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "userId" SET DATA TYPE TEXT,
ALTER COLUMN "projectId" SET DATA TYPE TEXT,
ALTER COLUMN "markedById" SET DATA TYPE TEXT,
ADD CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Attendance_id_seq";

-- AlterTable
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_pkey",
DROP COLUMN "ipAddress",
DROP COLUMN "userAgent",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "userId" SET DATA TYPE TEXT,
ALTER COLUMN "entityId" SET DATA TYPE TEXT,
ADD CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "AuditLog_id_seq";

-- AlterTable
ALTER TABLE "Client" DROP CONSTRAINT "Client_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "companyId" SET NOT NULL,
ALTER COLUMN "companyId" SET DATA TYPE TEXT,
ALTER COLUMN "createdById" SET DATA TYPE TEXT,
ADD CONSTRAINT "Client_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Client_id_seq";

-- AlterTable
ALTER TABLE "Company" DROP CONSTRAINT "Company_pkey",
DROP COLUMN "address",
DROP COLUMN "panNumber",
ADD COLUMN     "officeAddress" TEXT,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "createdById" SET DATA TYPE TEXT,
ADD CONSTRAINT "Company_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Company_id_seq";

-- AlterTable
ALTER TABLE "CompanySettings" DROP CONSTRAINT "CompanySettings_pkey",
ADD COLUMN     "enableStockAlerts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lowStockThreshold" DOUBLE PRECISION DEFAULT 10,
ADD COLUMN     "materialPrefix" TEXT DEFAULT 'MAT',
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "companyId" SET DATA TYPE TEXT,
ADD CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "CompanySettings_id_seq";

-- AlterTable
ALTER TABLE "DPRPhoto" DROP CONSTRAINT "DPRPhoto_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "dprId" SET DATA TYPE TEXT,
ALTER COLUMN "uploadedById" SET DATA TYPE TEXT,
ADD CONSTRAINT "DPRPhoto_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "DPRPhoto_id_seq";

-- AlterTable
ALTER TABLE "DailyProgressReport" DROP CONSTRAINT "DailyProgressReport_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "projectId" SET DATA TYPE TEXT,
ALTER COLUMN "preparedById" SET DATA TYPE TEXT,
ALTER COLUMN "approvedById" SET DATA TYPE TEXT,
ADD CONSTRAINT "DailyProgressReport_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "DailyProgressReport_id_seq";

-- AlterTable
ALTER TABLE "Document" DROP CONSTRAINT "Document_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "projectId" SET DATA TYPE TEXT,
ALTER COLUMN "uploadedById" SET DATA TYPE TEXT,
ADD CONSTRAINT "Document_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Document_id_seq";

-- AlterTable
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "projectId" SET DATA TYPE TEXT,
DROP COLUMN "category",
ADD COLUMN     "category" "ExpenseCategory" NOT NULL,
ALTER COLUMN "approvedById" SET DATA TYPE TEXT,
ALTER COLUMN "createdById" SET DATA TYPE TEXT,
ADD CONSTRAINT "Expense_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Expense_id_seq";

-- AlterTable
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "projectId" SET DATA TYPE TEXT,
ALTER COLUMN "clientId" SET DATA TYPE TEXT,
ALTER COLUMN "createdById" SET DATA TYPE TEXT,
ALTER COLUMN "approvedById" SET DATA TYPE TEXT,
ADD CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Invoice_id_seq";

-- AlterTable
ALTER TABLE "InvoiceItem" DROP CONSTRAINT "InvoiceItem_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "invoiceId" SET DATA TYPE TEXT,
ADD CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "InvoiceItem_id_seq";

-- AlterTable
ALTER TABLE "Leave" DROP CONSTRAINT "Leave_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "userId" SET DATA TYPE TEXT,
ALTER COLUMN "approvedById" SET DATA TYPE TEXT,
ADD CONSTRAINT "Leave_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Leave_id_seq";

-- AlterTable
ALTER TABLE "Material" DROP CONSTRAINT "Material_pkey",
ADD COLUMN     "lastRestocked" TIMESTAMP(3),
ADD COLUMN     "maximumStock" DOUBLE PRECISION,
ADD COLUMN     "reorderPoint" DOUBLE PRECISION,
ADD COLUMN     "supplierContact" TEXT,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "companyId" SET NOT NULL,
ALTER COLUMN "companyId" SET DATA TYPE TEXT,
ALTER COLUMN "createdById" SET DATA TYPE TEXT,
ADD CONSTRAINT "Material_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Material_id_seq";

-- AlterTable
ALTER TABLE "MaterialRequest" DROP CONSTRAINT "MaterialRequest_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "projectId" SET DATA TYPE TEXT,
ALTER COLUMN "materialId" SET DATA TYPE TEXT,
ALTER COLUMN "requestedById" SET DATA TYPE TEXT,
ALTER COLUMN "approvedById" SET DATA TYPE TEXT,
ALTER COLUMN "orderedById" SET DATA TYPE TEXT,
ADD CONSTRAINT "MaterialRequest_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "MaterialRequest_id_seq";

-- AlterTable
ALTER TABLE "Message" DROP CONSTRAINT "Message_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "senderId" SET DATA TYPE TEXT,
ALTER COLUMN "receiverId" SET DATA TYPE TEXT,
ALTER COLUMN "projectId" SET DATA TYPE TEXT,
ADD CONSTRAINT "Message_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Message_id_seq";

-- AlterTable
ALTER TABLE "Milestone" DROP CONSTRAINT "Milestone_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "projectId" SET DATA TYPE TEXT,
ALTER COLUMN "createdById" SET DATA TYPE TEXT,
ADD CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Milestone_id_seq";

-- AlterTable
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "userId" SET DATA TYPE TEXT,
ALTER COLUMN "relatedId" SET DATA TYPE TEXT,
ADD CONSTRAINT "Notification_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Notification_id_seq";

-- AlterTable
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "invoiceId" SET DATA TYPE TEXT,
ALTER COLUMN "clientId" SET DATA TYPE TEXT,
ALTER COLUMN "receivedById" SET DATA TYPE TEXT,
ALTER COLUMN "createdById" SET DATA TYPE TEXT,
ADD CONSTRAINT "Payment_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Payment_id_seq";

-- AlterTable
ALTER TABLE "Permission" DROP CONSTRAINT "Permission_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "Permission_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Permission_id_seq";

-- AlterTable
ALTER TABLE "Project" DROP CONSTRAINT "Project_pkey",
DROP COLUMN "managerId",
DROP COLUMN "siteEngineerId",
ADD COLUMN     "geofenceRadius" DOUBLE PRECISION NOT NULL DEFAULT 200,
ADD COLUMN     "latitude" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "longitude" DOUBLE PRECISION NOT NULL,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "location" SET NOT NULL,
ALTER COLUMN "clientId" SET DATA TYPE TEXT,
ALTER COLUMN "companyId" SET NOT NULL,
ALTER COLUMN "companyId" SET DATA TYPE TEXT,
ALTER COLUMN "createdById" SET DATA TYPE TEXT,
ADD CONSTRAINT "Project_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Project_id_seq";

-- AlterTable
ALTER TABLE "Role" DROP CONSTRAINT "Role_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "createdById" SET DATA TYPE TEXT,
ADD CONSTRAINT "Role_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Role_id_seq";

-- AlterTable
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "roleId" SET DATA TYPE TEXT,
ALTER COLUMN "permissionId" SET DATA TYPE TEXT,
ALTER COLUMN "grantedById" SET DATA TYPE TEXT,
ADD CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "RolePermission_id_seq";

-- AlterTable
ALTER TABLE "Subtask" DROP CONSTRAINT "Subtask_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "taskId" SET DATA TYPE TEXT,
ALTER COLUMN "createdById" SET DATA TYPE TEXT,
ADD CONSTRAINT "Subtask_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Subtask_id_seq";

-- AlterTable
ALTER TABLE "Task" DROP CONSTRAINT "Task_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "projectId" SET DATA TYPE TEXT,
ALTER COLUMN "assignedToId" SET DATA TYPE TEXT,
ALTER COLUMN "createdById" SET DATA TYPE TEXT,
ADD CONSTRAINT "Task_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Task_id_seq";

-- AlterTable
ALTER TABLE "TaskAttachment" DROP CONSTRAINT "TaskAttachment_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "taskId" SET DATA TYPE TEXT,
ALTER COLUMN "uploadedById" SET DATA TYPE TEXT,
ADD CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "TaskAttachment_id_seq";

-- AlterTable
ALTER TABLE "TaskComment" DROP CONSTRAINT "TaskComment_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "taskId" SET DATA TYPE TEXT,
ALTER COLUMN "userId" SET DATA TYPE TEXT,
ADD CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "TaskComment_id_seq";

-- AlterTable
ALTER TABLE "User" DROP CONSTRAINT "User_pkey",
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "emergencyPhone" TEXT,
ADD COLUMN     "employeeStatus" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "hourlyRate" DOUBLE PRECISION,
ADD COLUMN     "loginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "salaryType" "SalaryType" NOT NULL DEFAULT 'MONTHLY',
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "phone" SET NOT NULL,
ALTER COLUMN "createdById" SET DATA TYPE TEXT,
ALTER COLUMN "roleId" SET DATA TYPE TEXT,
ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "User_id_seq";

-- AlterTable
ALTER TABLE "UserSettings" DROP CONSTRAINT "UserSettings_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "userId" SET DATA TYPE TEXT,
ADD CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "UserSettings_id_seq";

-- DropTable
DROP TABLE "Inspection";

-- DropTable
DROP TABLE "Meeting";

-- DropTable
DROP TABLE "MeetingAttendance";

-- DropTable
DROP TABLE "MeetingMinute";

-- DropTable
DROP TABLE "SafetyIncident";

-- DropTable
DROP TABLE "SafetyTraining";

-- DropTable
DROP TABLE "SafetyTrainingAttendance";

-- CreateTable
CREATE TABLE "ProjectSettings" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "checkInStart" TEXT DEFAULT '08:00',
    "checkInEnd" TEXT DEFAULT '09:00',
    "checkOutStart" TEXT DEFAULT '17:00',
    "checkOutEnd" TEXT DEFAULT '18:00',
    "requireLocation" BOOLEAN NOT NULL DEFAULT true,
    "maxDistance" DOUBLE PRECISION DEFAULT 100,
    "notifyManagerOnDPR" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnDelay" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAlert" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "currentStock" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "message" TEXT NOT NULL,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "isNotified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "StockAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransaction" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "previousStock" DOUBLE PRECISION NOT NULL,
    "newStock" DOUBLE PRECISION NOT NULL,
    "projectId" TEXT,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSettings_projectId_key" ON "ProjectSettings"("projectId");

-- CreateIndex
CREATE INDEX "StockAlert_materialId_idx" ON "StockAlert"("materialId");

-- CreateIndex
CREATE INDEX "StockAlert_alertType_idx" ON "StockAlert"("alertType");

-- CreateIndex
CREATE INDEX "StockAlert_isResolved_idx" ON "StockAlert"("isResolved");

-- CreateIndex
CREATE INDEX "StockAlert_isNotified_idx" ON "StockAlert"("isNotified");

-- CreateIndex
CREATE INDEX "StockTransaction_materialId_idx" ON "StockTransaction"("materialId");

-- CreateIndex
CREATE INDEX "StockTransaction_transactionType_idx" ON "StockTransaction"("transactionType");

-- CreateIndex
CREATE INDEX "StockTransaction_projectId_idx" ON "StockTransaction"("projectId");

-- CreateIndex
CREATE INDEX "StockTransaction_createdAt_idx" ON "StockTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "Attendance_isVerified_idx" ON "Attendance"("isVerified");

-- CreateIndex
CREATE INDEX "Expense_category_idx" ON "Expense"("category");

-- CreateIndex
CREATE INDEX "User_phone_idx" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_employeeStatus_idx" ON "User"("employeeStatus");

-- CreateIndex
CREATE INDEX "User_salaryType_idx" ON "User"("salaryType");

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSettings" ADD CONSTRAINT "ProjectSettings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subtask" ADD CONSTRAINT "Subtask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subtask" ADD CONSTRAINT "Subtask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyProgressReport" ADD CONSTRAINT "DailyProgressReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyProgressReport" ADD CONSTRAINT "DailyProgressReport_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyProgressReport" ADD CONSTRAINT "DailyProgressReport_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DPRPhoto" ADD CONSTRAINT "DPRPhoto_dprId_fkey" FOREIGN KEY ("dprId") REFERENCES "DailyProgressReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DPRPhoto" ADD CONSTRAINT "DPRPhoto_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Leave" ADD CONSTRAINT "Leave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Leave" ADD CONSTRAINT "Leave_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAlert" ADD CONSTRAINT "StockAlert_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_orderedById_fkey" FOREIGN KEY ("orderedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
