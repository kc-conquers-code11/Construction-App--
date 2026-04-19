-- Create enums for Transaction module
CREATE TYPE "TransactionType" AS ENUM (
  'INCOME',
  'EXPENSE',
  'PETTY_CASH_ISSUE',
  'PETTY_CASH_SETTLEMENT',
  'PETTY_CASH_REPLENISHMENT'
);

CREATE TYPE "TransactionStatus" AS ENUM (
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'VOIDED'
);

CREATE TYPE "TransactionSourceType" AS ENUM (
  'DIRECT',
  'INVOICE',
  'PAYMENT',
  'BUDGET',
  'PURCHASE_ORDER',
  'CONTRACTOR_PAYMENT',
  'PAYROLL',
  'PETTY_CASH'
);

-- Create ProjectCashbox table
CREATE TABLE "ProjectCashbox" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "currentBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "minimumBalance" DOUBLE PRECISION,
  "maximumBalance" DOUBLE PRECISION,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectCashbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectCashbox_projectId_key" ON "ProjectCashbox"("projectId");
CREATE INDEX "ProjectCashbox_companyId_projectId_idx" ON "ProjectCashbox"("companyId", "projectId");

-- Create Transaction table
CREATE TABLE "Transaction" (
  "id" TEXT NOT NULL,
  "transactionNo" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "type" "TransactionType" NOT NULL,
  "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "amount" DOUBLE PRECISION NOT NULL,
  "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalAmount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "transactionDate" TIMESTAMP(3) NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT,
  "counterpartyName" TEXT,
  "invoiceId" TEXT,
  "paymentId" TEXT,
  "budgetId" TEXT,
  "budgetCategoryId" TEXT,
  "purchaseOrderId" TEXT,
  "contractorPaymentId" TEXT,
  "payrollId" TEXT,
  "cashboxId" TEXT,
  "sourceType" "TransactionSourceType" NOT NULL DEFAULT 'DIRECT',
  "sourceId" TEXT,
  "referenceNo" TEXT,
  "requestedById" TEXT NOT NULL,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectedById" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "voidedById" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "notes" TEXT,
  "attachmentUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Transaction_transactionNo_key" ON "Transaction"("transactionNo");
CREATE INDEX "Transaction_projectId_transactionDate_idx" ON "Transaction"("projectId", "transactionDate" DESC);
CREATE INDEX "Transaction_companyId_type_idx" ON "Transaction"("companyId", "type");
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");
CREATE INDEX "Transaction_sourceType_sourceId_idx" ON "Transaction"("sourceType", "sourceId");

-- Foreign keys for ProjectCashbox
ALTER TABLE "ProjectCashbox"
ADD CONSTRAINT "ProjectCashbox_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectCashbox"
ADD CONSTRAINT "ProjectCashbox_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectCashbox"
ADD CONSTRAINT "ProjectCashbox_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Foreign keys for Transaction
ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_invoiceId_fkey"
FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_paymentId_fkey"
FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_budgetId_fkey"
FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_budgetCategoryId_fkey"
FOREIGN KEY ("budgetCategoryId") REFERENCES "BudgetCategoryAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_purchaseOrderId_fkey"
FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_contractorPaymentId_fkey"
FOREIGN KEY ("contractorPaymentId") REFERENCES "ContractorPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_payrollId_fkey"
FOREIGN KEY ("payrollId") REFERENCES "Payroll"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_cashboxId_fkey"
FOREIGN KEY ("cashboxId") REFERENCES "ProjectCashbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_approvedById_fkey"
FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_rejectedById_fkey"
FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_voidedById_fkey"
FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
