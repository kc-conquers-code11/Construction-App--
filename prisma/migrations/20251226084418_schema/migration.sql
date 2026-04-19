/*
  Warnings:

  - You are about to drop the column `checkInDistance` on the `Attendance` table. All the data in the column will be lost.
  - You are about to drop the column `industry` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `rating` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `category` on the `Material` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `Material` table. All the data in the column will be lost.
  - You are about to drop the column `isActive` on the `Material` table. All the data in the column will be lost.
  - You are about to drop the column `lastRestocked` on the `Material` table. All the data in the column will be lost.
  - You are about to drop the column `maximumStock` on the `Material` table. All the data in the column will be lost.
  - You are about to drop the column `rate` on the `Material` table. All the data in the column will be lost.
  - You are about to drop the column `reorderPoint` on the `Material` table. All the data in the column will be lost.
  - You are about to drop the column `supplier` on the `Material` table. All the data in the column will be lost.
  - You are about to drop the column `supplierContact` on the `Material` table. All the data in the column will be lost.
  - You are about to drop the column `isDefault` on the `Role` table. All the data in the column will be lost.
  - You are about to drop the column `isSystem` on the `Role` table. All the data in the column will be lost.
  - You are about to drop the column `level` on the `Role` table. All the data in the column will be lost.
  - You are about to drop the column `bloodGroup` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `emailVerified` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `loginCount` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `phoneVerified` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[userId,date]` on the table `Attendance` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[companyId,email]` on the table `Client` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[companyId,materialCode]` on the table `Material` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[companyId,projectId]` on the table `Project` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[companyId,name]` on the table `Role` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[companyId,employeeId]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `locationType` to the `Attendance` table without a default value. This is not possible if the table is not empty.
  - Made the column `phone` on table `Client` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('SUPER_ADMIN', 'COMPANY_ADMIN', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "AttendanceLocation" AS ENUM ('OFFICE', 'SITE', 'REMOTE');

-- DropForeignKey
ALTER TABLE "Role" DROP CONSTRAINT "Role_createdById_fkey";

-- DropForeignKey
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_grantedById_fkey";

-- DropIndex
DROP INDEX "Attendance_isVerified_idx";

-- DropIndex
DROP INDEX "Attendance_markedById_idx";

-- DropIndex
DROP INDEX "Attendance_status_idx";

-- DropIndex
DROP INDEX "Attendance_userId_projectId_date_key";

-- DropIndex
DROP INDEX "AuditLog_action_idx";

-- DropIndex
DROP INDEX "AuditLog_entityType_idx";

-- DropIndex
DROP INDEX "AuditLog_timestamp_idx";

-- DropIndex
DROP INDEX "Client_companyName_idx";

-- DropIndex
DROP INDEX "Client_email_idx";

-- DropIndex
DROP INDEX "Client_email_key";

-- DropIndex
DROP INDEX "Client_gstNumber_key";

-- DropIndex
DROP INDEX "Client_isActive_idx";

-- DropIndex
DROP INDEX "Client_phone_key";

-- DropIndex
DROP INDEX "Company_gstNumber_idx";

-- DropIndex
DROP INDEX "Company_registrationNumber_idx";

-- DropIndex
DROP INDEX "DPRPhoto_uploadedById_idx";

-- DropIndex
DROP INDEX "DailyProgressReport_approvedById_idx";

-- DropIndex
DROP INDEX "DailyProgressReport_date_idx";

-- DropIndex
DROP INDEX "DailyProgressReport_preparedById_idx";

-- DropIndex
DROP INDEX "DailyProgressReport_status_idx";

-- DropIndex
DROP INDEX "Document_createdAt_idx";

-- DropIndex
DROP INDEX "Document_documentType_idx";

-- DropIndex
DROP INDEX "Document_isArchived_idx";

-- DropIndex
DROP INDEX "Document_isPublic_idx";

-- DropIndex
DROP INDEX "Document_uploadedById_idx";

-- DropIndex
DROP INDEX "Expense_approvedById_idx";

-- DropIndex
DROP INDEX "Expense_category_idx";

-- DropIndex
DROP INDEX "Expense_createdAt_idx";

-- DropIndex
DROP INDEX "Expense_createdById_idx";

-- DropIndex
DROP INDEX "Expense_status_idx";

-- DropIndex
DROP INDEX "Invoice_approvedById_idx";

-- DropIndex
DROP INDEX "Invoice_clientId_idx";

-- DropIndex
DROP INDEX "Invoice_createdById_idx";

-- DropIndex
DROP INDEX "Invoice_dueDate_idx";

-- DropIndex
DROP INDEX "Invoice_invoiceNo_idx";

-- DropIndex
DROP INDEX "Invoice_status_idx";

-- DropIndex
DROP INDEX "Leave_approvedById_idx";

-- DropIndex
DROP INDEX "Leave_startDate_idx";

-- DropIndex
DROP INDEX "Leave_status_idx";

-- DropIndex
DROP INDEX "Leave_type_idx";

-- DropIndex
DROP INDEX "Material_category_idx";

-- DropIndex
DROP INDEX "Material_createdById_idx";

-- DropIndex
DROP INDEX "Material_isActive_idx";

-- DropIndex
DROP INDEX "Material_materialCode_key";

-- DropIndex
DROP INDEX "Material_name_idx";

-- DropIndex
DROP INDEX "MaterialRequest_approvedById_idx";

-- DropIndex
DROP INDEX "MaterialRequest_createdAt_idx";

-- DropIndex
DROP INDEX "MaterialRequest_materialId_idx";

-- DropIndex
DROP INDEX "MaterialRequest_orderedById_idx";

-- DropIndex
DROP INDEX "MaterialRequest_requestedById_idx";

-- DropIndex
DROP INDEX "MaterialRequest_status_idx";

-- DropIndex
DROP INDEX "MaterialRequest_urgency_idx";

-- DropIndex
DROP INDEX "Message_createdAt_idx";

-- DropIndex
DROP INDEX "Message_isRead_idx";

-- DropIndex
DROP INDEX "Message_projectId_idx";

-- DropIndex
DROP INDEX "Message_receiverId_idx";

-- DropIndex
DROP INDEX "Milestone_createdById_idx";

-- DropIndex
DROP INDEX "Milestone_dueDate_idx";

-- DropIndex
DROP INDEX "Milestone_status_idx";

-- DropIndex
DROP INDEX "Notification_createdAt_idx";

-- DropIndex
DROP INDEX "Notification_isRead_idx";

-- DropIndex
DROP INDEX "Notification_type_idx";

-- DropIndex
DROP INDEX "Payment_clientId_idx";

-- DropIndex
DROP INDEX "Payment_createdById_idx";

-- DropIndex
DROP INDEX "Payment_paymentDate_idx";

-- DropIndex
DROP INDEX "Payment_paymentMethod_idx";

-- DropIndex
DROP INDEX "Payment_receivedById_idx";

-- DropIndex
DROP INDEX "Permission_category_idx";

-- DropIndex
DROP INDEX "Project_priority_idx";

-- DropIndex
DROP INDEX "Project_projectId_idx";

-- DropIndex
DROP INDEX "Project_projectId_key";

-- DropIndex
DROP INDEX "Project_startDate_idx";

-- DropIndex
DROP INDEX "Project_status_idx";

-- DropIndex
DROP INDEX "Role_isSystem_idx";

-- DropIndex
DROP INDEX "Role_level_idx";

-- DropIndex
DROP INDEX "Role_name_idx";

-- DropIndex
DROP INDEX "Role_name_key";

-- DropIndex
DROP INDEX "RolePermission_permissionId_idx";

-- DropIndex
DROP INDEX "StockAlert_alertType_idx";

-- DropIndex
DROP INDEX "StockAlert_isNotified_idx";

-- DropIndex
DROP INDEX "StockAlert_isResolved_idx";

-- DropIndex
DROP INDEX "StockTransaction_createdAt_idx";

-- DropIndex
DROP INDEX "StockTransaction_projectId_idx";

-- DropIndex
DROP INDEX "StockTransaction_transactionType_idx";

-- DropIndex
DROP INDEX "Subtask_createdById_idx";

-- DropIndex
DROP INDEX "Subtask_isCompleted_idx";

-- DropIndex
DROP INDEX "Task_createdById_idx";

-- DropIndex
DROP INDEX "Task_dueDate_idx";

-- DropIndex
DROP INDEX "Task_priority_idx";

-- DropIndex
DROP INDEX "Task_startDate_idx";

-- DropIndex
DROP INDEX "Task_status_idx";

-- DropIndex
DROP INDEX "TaskAttachment_uploadedById_idx";

-- DropIndex
DROP INDEX "TaskComment_createdAt_idx";

-- DropIndex
DROP INDEX "TaskComment_userId_idx";

-- DropIndex
DROP INDEX "User_aadharNumber_key";

-- DropIndex
DROP INDEX "User_createdAt_idx";

-- DropIndex
DROP INDEX "User_department_idx";

-- DropIndex
DROP INDEX "User_designation_idx";

-- DropIndex
DROP INDEX "User_employeeId_key";

-- DropIndex
DROP INDEX "User_employeeStatus_idx";

-- DropIndex
DROP INDEX "User_isActive_idx";

-- DropIndex
DROP INDEX "User_panNumber_key";

-- DropIndex
DROP INDEX "User_salaryType_idx";

-- AlterTable
ALTER TABLE "Attendance" DROP COLUMN "checkInDistance",
ADD COLUMN     "distanceFromBase" DOUBLE PRECISION,
ADD COLUMN     "locationType" "AttendanceLocation" NOT NULL,
ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Client" DROP COLUMN "industry",
DROP COLUMN "rating",
DROP COLUMN "type",
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "phone" SET NOT NULL;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "officeGeofence" DOUBLE PRECISION NOT NULL DEFAULT 100,
ADD COLUMN     "officeLatitude" DOUBLE PRECISION,
ADD COLUMN     "officeLongitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Material" DROP COLUMN "category",
DROP COLUMN "description",
DROP COLUMN "isActive",
DROP COLUMN "lastRestocked",
DROP COLUMN "maximumStock",
DROP COLUMN "rate",
DROP COLUMN "reorderPoint",
DROP COLUMN "supplier",
DROP COLUMN "supplierContact";

-- AlterTable
ALTER TABLE "Role" DROP COLUMN "isDefault",
DROP COLUMN "isSystem",
DROP COLUMN "level",
ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "isSystemAdmin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "bloodGroup",
DROP COLUMN "emailVerified",
DROP COLUMN "loginCount",
DROP COLUMN "phoneVerified",
ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "defaultLocation" "AttendanceLocation" NOT NULL DEFAULT 'OFFICE',
ADD COLUMN     "userType" "UserType" NOT NULL DEFAULT 'EMPLOYEE';

-- CreateTable
CREATE TABLE "_PermissionGranter" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PermissionGranter_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_PermissionGranter_B_index" ON "_PermissionGranter"("B");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_userId_date_key" ON "Attendance"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Client_companyId_email_key" ON "Client"("companyId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Material_companyId_materialCode_key" ON "Material"("companyId", "materialCode");

-- CreateIndex
CREATE UNIQUE INDEX "Project_companyId_projectId_key" ON "Project"("companyId", "projectId");

-- CreateIndex
CREATE INDEX "Role_companyId_idx" ON "Role"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_companyId_name_key" ON "Role"("companyId", "name");

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "User"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "User_companyId_employeeId_key" ON "User"("companyId", "employeeId");

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PermissionGranter" ADD CONSTRAINT "_PermissionGranter_A_fkey" FOREIGN KEY ("A") REFERENCES "RolePermission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PermissionGranter" ADD CONSTRAINT "_PermissionGranter_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
