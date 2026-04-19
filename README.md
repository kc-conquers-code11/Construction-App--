# Construction Management App - Backend API

## 🚀 Overview

A **production-ready, comprehensive** Node.js + Express + PostgreSQL backend API for a complete construction management system. This robust backend provides end-to-end management of construction projects, from user authentication to financial tracking, with role-based access control and real-time features.

## 🌟 Key Features

- 🔐 **Multi-role authentication** (8 user roles)
- 📊 **Complete project lifecycle management**
- 👥 **Attendance & leave tracking** with GPS support
- 📋 **Task management** with subtasks and comments
- 📸 **Daily Progress Reports** with photo documentation
- 💰 **Financial management** (invoices, expenses, payments)
- 📦 **Material & inventory management**
- 📁 **Document management** with file uploads
- 🎯 **Meeting management** with minutes tracking
- ⚠️ **Safety & compliance tracking**
- 🔔 **Real-time notifications**
- 📈 **Dashboard & reporting**

## 📋 Tech Stack

- **Runtime:** Node.js v18+
- **Framework:** Express.js 5.x
- **Database:** PostgreSQL 14+ with Prisma ORM
- **Authentication:** JWT with refresh tokens
- **Validation:** Zod schemas
- **Security:** Helmet, CORS, Rate Limiting, XSS protection
- **File Upload:** Multer with validation
- **Real-time:** Socket.io (optional)
- **Email:** Nodemailer
- **Reporting:** ExcelJS, PDFKit
- **Environment:** Dotenv

## 🏗️ Detailed Project Structure

Root Structure
```
construction-app/
├── src/                    # Source code
├── prisma/                 # Database schema & migrations
├── uploads/                # File uploads (optional)
├── .env                    # Environment configuration
├── .env.example           # Environment template
├── package.json           # Dependencies & scripts
├── README.md              # This documentation
└── LICENSE                # MIT License
```

📁 src/ - Source Code Architecture

```
src/
├── config/                    # Configuration files
│   ├── database.js           # PostgreSQL + Prisma setup
│   └── upload.js             # (Future) File upload config
│
├── controllers/              # Business logic handlers
│   ├── auth.controller.js    # Authentication (login, logout, OTP)
│   ├── company.controller.js # Company CRUD operations
│   ├── user.controller.js    # User/employee management
│   ├── role.controller.js    # Role & permission management
│   ├── permission.controller.js # Permission listing
│   ├── verification.controller.js # OTP verification flow
│   ├── project.controller.js # Project management
│   ├── client.controller.js  # Client management
│   └── task.controller.js    # Task, Subtask, TaskComment management
│
├── middleware/               # Request processing middleware
│   ├── auth.middleware.js    # JWT verification & role checking
│   └── validation.middleware.js # Zod validation wrapper
│
├── routes/                   # API route definitions
│   ├── auth.routes.js        # Authentication endpoints
│   ├── company.routes.js     # Company management (Super Admin)
│   ├── user.routes.js        # User/employee endpoints
│   ├── role.routes.js        # Role management
│   ├── permission.routes.js  # Permission listing
│   ├── verification.routes.js # OTP verification
│   ├── project.routes.js     # Project management endpoints
│   ├── client.routes.js      # Client management endpoints
│   └── task.routes.js        # Task management endpoints
│
├── services/                 # External service integrations
│   ├── emailSms.service.js   # Email & SMS (Gmail + 2Factor.in)
│   └── otp.service.js        # OTP generation & verification
│
├── validations/              # Request validation schemas
│   ├── auth.validations.js   # Login, password validations
│   ├── company.validations.js # Company creation validations
│   ├── user.validations.js   # User/employee validations
│   ├── project.validations.js # Project management validations
│   ├── client.validations.js # Client management validations
│   ├── task.validations.js   # Task, Subtask, TaskComment validations
│   └── index.js              # Validation middleware export
│
└── index.js                  # Main application entry point
```

📁 prisma/ - Database Layer
```
prisma/
├── schema.prisma            # Complete database schema (40+ models)
├── migrations/              # Database migration history
│   ├── 20240101000000_init/
│   └── 20240102000000_add_otp/
│── seed-permissions.js   # Permission seed data
└──seed-simple.js        # Initial super admin seed
```

## 🗄️ Database Schema

View the complete, detailed database schema with relationships:

🔗 **Interactive Database Schema Diagram:** [Eraser.io](https://app.eraser.io/workspace/uymka4d3uYNZLks7ufd8?origin=share)

### 📊 Core Models (40+ Models)

#### 👥 **User Management**

- `User` - Complete user profiles with 8 roles
- `UserSettings` - User preferences and configurations
- `Company` - Organization details
- `Client` - Client/customer management

#### 🏗️ **Project Management**

- `Project` - Comprehensive project tracking
- `Milestone` - Project milestones with payments
- `Task` - Task management with assignments
- `Subtask` - Task breakdown
- `DailyProgressReport` - Daily site reports
- `DPRPhoto` - Report documentation photos

#### 👨‍💼 **HR & Operations**

- `Attendance` - GPS-based attendance tracking
- `Leave` - Leave management with approvals
- `SafetyTraining` - Training records
- `SafetyIncident` - Incident reporting

#### 💰 **Financial Management**

- `Invoice` - Complete invoicing system
- `InvoiceItem` - Invoice line items
- `Payment` - Payment tracking
- `Expense` - Expense management

#### 📦 **Inventory & Materials**

- `Material` - Material catalog
- `MaterialRequest` - Material requisitions

#### 📋 **Administration**

- `Document` - File management
- `Meeting` - Meeting scheduling
- `MeetingMinute` - Action items tracking
- `Inspection` - Site inspections

#### 💬 **Communication**

- `Message` - Internal messaging
- `Notification` - System notifications

---

## 🚦 Prerequisites

- **Node.js 18** or higher
- **PostgreSQL 14** or higher
- **npm** package manager
- **Git** for version control

## ⚡ Quick Start

### 1. Clone & Install

```bash
# Clone the repository
git clone <repository-url>
cd construction-app

# Install dependencies
npm install
```

### 2. Environment Setup

Create a `.env` file in the root directory:

```env
# =============== SERVER CONFIG ===============
PORT=3000
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000,http://localhost:5173

# =============== DATABASE CONFIG ===============
DATABASE_URL="postgresql://username:password@localhost:5432/construction_db?schema=public"

# =============== AUTHENTICATION ===============
JWT_SECRET="your-super-secret-jwt-key-change-this-in-production"
JWT_REFRESH_SECRET="your-refresh-token-secret-key"
JWT_EXPIRE=7d
JWT_REFRESH_EXPIRE=30d

# =============== FILE UPLOADS ===============
UPLOAD_MAX_SIZE=10485760  # 10MB
UPLOAD_PATH=./uploads

# =============== EMAIL (Optional) ===============
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
EMAIL_FROM=noreply@constructionapp.com

# =============== SMS (Optional) ===============
TWO_FACTOR_API_KEY=api_key_here
```

### 3. Database Setup

```bash
# Generate Prisma client
npx prisma generate

# Run migrations (Development)
npx prisma migrate dev --name init

# Push schema (Alternative)
npx prisma db push

# Seed database with initial data (if available)
npx prisma db seed

# Open Prisma Studio to view data
npx prisma studio
```

### 4. Start the Server

```bash
# Development (with hot reload)
npm run dev

# Production
npm start

# With PM2 (Production)
pm2 start src/index.js --name construction-app
```

## 📡 API Endpoints
I'll create a comprehensive README.md file based on your updated codebase. Here's a professional, well-structured documentation:

```markdown
# Construction Management System - Backend API

## 📋 Project Overview

A **complete, production-ready** backend API for a multi-tenant construction management system with **Super Admin, Company Admin, and Employee** roles. This system enables construction companies to manage projects, employees, materials, finances, and operations with granular permissions and OTP-based authentication.

## 🚀 Quick Start

### Prerequisites
- Node.js v18+ 
- PostgreSQL 14+
- npm or yarn

### Installation

```bash
# 1. Clone repository
git clone <repository-url>
cd construction-app

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your configuration

# 4. Set up database
npm run db:setup

# 5. Start development server
npm run dev

# 6. For production
npm run build
npm start
```

## 📁 Project Structure

```
src/
├── config/           # Database & configuration
├── controllers/      # Business logic handlers
├── middleware/       # Authentication & validation
├── routes/          # API endpoints
├── services/        # Email/SMS, OTP services
├── validations/     # Zod schemas
└── index.js         # Entry point
```

## 🔐 Core Features

### 1. **Multi-Tenant Architecture**
- Super Admin (Platform owner)
- Company Admin (Per company)
- Employees (Per company)
- Isolated data per company

### 2. **Secure Authentication**
- JWT with refresh tokens
- OTP-based login (Email/SMS)
- Passwordless first-time setup
- Role-based access control

### 3. **Company Management**
- Create companies with admin users
- Admin setup via OTP verification
- Company settings & configurations
- Bulk user management

### 4. **Permission System**
- Granular permission control
- Role-based permission assignment
- Company-level permission isolation
- System vs company permissions

## 🗄️ Database Schema

### Key Models
- **User** - All system users with 3 roles
- **Company** - Multi-tenancy isolation
- **Role** - Permission groups
- **Permission** - Action controls
- **OTP** - Secure verification
- **Project** - Construction projects
- **Attendance** - GPS-based tracking
- **Material** - Inventory management
- **Invoice** - Financial management

### Detailed Schema Diagram
🔗 [View Interactive Schema](https://app.eraser.io/workspace/uymka4d3uYNZLks7ufd8?origin=share)

## **📡 API Endpoints**

### **🔐 Authentication (`/api/v1/auth`)**
| Method | Endpoint | Description | Authentication Required |
|--------|----------|-------------|-------------------------|
| POST | `/login` | Login with email or phone | ❌ Public |
| POST | `/check-status` | Check account status | ❌ Public |
| POST | `/login-with-otp` | Login using OTP | ❌ Public |
| POST | `/verify-otp-login` | Verify OTP and login | ❌ Public |
| POST | `/refresh-token` | Refresh access token | ❌ Public |
| POST | `/forgot-password` | Request password reset | ❌ Public |
| POST | `/reset-password` | Reset password | ❌ Public |
| POST | `/logout` | Logout user | ✅ Required |
| GET | `/profile` | Get current user profile | ✅ Required |
| POST | `/change-password` | Change password | ✅ Required |

---

### **🏢 Company Management (`/api/v1/companies`) - Super Admin Only**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| POST | `/create` | Create company with admin | Super Admin |
| GET | `/` | List all companies | Super Admin |
| GET | `/:id` | Get company details | Super Admin |
| PUT | `/:id` | Update company | Super Admin |
| PATCH | `/:id/status` | Activate/deactivate company | Super Admin |
| GET | `/:companyId/admins` | List company admins | Super Admin |
| POST | `/:companyId/admins` | Add new admin to company | Super Admin |
| PUT | `/:companyId/admins/:adminId/permissions` | Update admin permissions | Super Admin |

---

### **📱 Verification (`/api/v1/verification`) - Public**
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/request-otp` | Send OTP to email/phone |
| POST | `/verify-otp` | Verify OTP code |
| POST | `/complete-setup` | Complete account setup |
| POST | `/test-sms` | Test SMS OTP (Development) |

---

### **👥 User Management (`/api/v1/users`)**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| POST | `/` | Create employee | Company Admin |
| GET | `/` | List employees | Company Admin |
| GET | `/:id` | Get employee details | Self or Admin |
| PUT | `/:id` | Update employee | Self or Admin |
| DELETE | `/:id` | Delete employee | Company Admin |
| PATCH | `/:id/status` | Toggle employee status | Company Admin |
| PATCH | `/:id/role` | Assign role to employee | Company Admin |
| POST | `/:id/reset-password` | Reset employee password | Company Admin |
| POST | `/:id/send-welcome` | Send welcome email/SMS | Company Admin |
| GET | `/dashboard/me` | Employee dashboard | Employee |

---

### **🎭 Role Management (`/api/v1/roles`)**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| POST | `/` | Create role | Company Admin |
| GET | `/` | List roles | All Authenticated |
| GET | `/:id` | Get role details | All Authenticated |
| PUT | `/:id` | Update role | Company Admin |
| DELETE | `/:id` | Delete role | Company Admin |
| GET | `/:id/permissions` | Get role permissions | All Authenticated |
| PUT | `/:id/permissions` | Update role permissions | Company Admin |

---

### **🔐 Permissions (`/api/v1/permissions`)**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| GET | `/` | List all permissions | All Authenticated |
| GET | `/grouped` | Permissions grouped by module/category | All Authenticated |
| GET | `/available` | Permissions available for companies | All Authenticated |

---

### **🏗️ Project Management (`/api/v1/projects`)**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| POST | `/` | Create project | TASK_CREATE |
| GET | `/` | List projects | TASK_READ |
| GET | `/:id` | Get project details | TASK_READ |
| PUT | `/:id` | Update project | TASK_UPDATE |
| DELETE | `/:id` | Delete project | TASK_DELETE |
| POST | `/:id/team` | Assign team to project | TASK_UPDATE |
| GET | `/:id/team` | Get project team | TASK_READ |
| GET | `/:id/statistics` | Get project statistics | TASK_READ |
| POST | `/:id/settings` | Create project settings | PROJECT_SETTINGS_UPDATE |
| GET | `/:id/settings` | Get project settings | TASK_READ |
| PUT | `/:id/settings` | Update project settings | PROJECT_SETTINGS_UPDATE |

---

### **🤝 Client Management (`/api/v1/clients`)**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| POST | `/` | Create client | CLIENT_CREATE |
| GET | `/` | List clients | CLIENT_READ |
| GET | `/:id` | Get client details | CLIENT_READ |
| PUT | `/:id` | Update client | CLIENT_UPDATE |
| DELETE | `/:id` | Delete client | CLIENT_DELETE |
| PATCH | `/:id/status` | Toggle client status | CLIENT_UPDATE |
| GET | `/:id/statistics` | Get client statistics | CLIENT_READ |
| GET | `/:id/projects` | Get client projects | CLIENT_READ |
| GET | `/:id/invoices` | Get client invoices | CLIENT_READ |
| GET | `/:id/payments` | Get client payments | CLIENT_READ |

---

### **📋 Task Management (`/api/v1/tasks`)**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| POST | `/` | Create task | TASK_CREATE |
| GET | `/` | List tasks | TASK_READ |
| GET | `/user-tasks` | Get user's tasks | Employee |
| GET | `/:id` | Get task details | TASK_READ |
| PUT | `/:id` | Update task | TASK_UPDATE |
| DELETE | `/:id` | Delete task | TASK_DELETE |
| POST | `/subtasks` | Create subtask | Access to Task |
| PUT | `/subtasks/:id` | Update subtask | Access to Task |
| DELETE | `/subtasks/:id` | Delete subtask | Access to Task |
| POST | `/comments` | Create task comment | Access to Task |
| GET | `/:taskId/comments` | Get task comments | Access to Task |
| DELETE | `/comments/:id` | Delete comment | Comment Creator or Admin |

---

### **📊 Attendance (`/api/v1/attendance`)**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| POST | `/` | Mark attendance | ATTENDANCE_CREATE |
| GET | `/` | List attendance records | ATTENDANCE_READ |
| GET | `/:id` | Get attendance record | ATTENDANCE_READ |
| PUT | `/:id` | Update attendance | ATTENDANCE_UPDATE |
| POST | `/:id/verify` | Verify attendance | ATTENDANCE_VERIFY |
| GET | `/user/:userId` | Get user's attendance | ATTENDANCE_READ |
| GET | `/project/:projectId` | Get project attendance | ATTENDANCE_READ |
| GET | `/summary` | Get attendance summary | ATTENDANCE_READ |

---

### **💰 Expense Management (`/api/v1/expenses`)**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| POST | `/` | Create expense | EXPENSE_CREATE |
| GET | `/` | List expenses | EXPENSE_READ |
| GET | `/:id` | Get expense details | EXPENSE_READ |
| PUT | `/:id` | Update expense | EXPENSE_UPDATE |
| PATCH | `/:id/approve` | Approve expense | EXPENSE_APPROVE |
| DELETE | `/:id` | Delete expense | EXPENSE_DELETE |
| GET | `/project/:projectId` | Get project expenses | EXPENSE_READ |
| GET | `/category/:category` | Get expenses by category | EXPENSE_READ |

---

### **📦 Material Management (`/api/v1/materials`)**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| POST | `/` | Create material | MATERIAL_CREATE |
| GET | `/` | List materials | MATERIAL_READ |
| GET | `/:id` | Get material details | MATERIAL_READ |
| PUT | `/:id` | Update material | MATERIAL_UPDATE |
| DELETE | `/:id` | Delete material | MATERIAL_DELETE |
| POST | `/request` | Request material | MATERIAL_REQUEST |
| PATCH | `/:id/request/approve` | Approve material request | MATERIAL_APPROVE |
| GET | `/stock-alerts` | Get stock alerts | MATERIAL_READ |
| GET | `/transactions` | Get stock transactions | MATERIAL_READ |

---

### **🧾 Invoice Management (`/api/v1/invoices`)**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| POST | `/` | Create invoice | INVOICE_CREATE |
| GET | `/` | List invoices | INVOICE_READ |
| GET | `/:id` | Get invoice details | INVOICE_READ |
| PUT | `/:id` | Update invoice | INVOICE_UPDATE |
| PATCH | `/:id/approve` | Approve invoice | INVOICE_APPROVE |
| DELETE | `/:id` | Delete invoice | INVOICE_DELETE |
| GET | `/project/:projectId` | Get project invoices | INVOICE_READ |
| GET | `/client/:clientId` | Get client invoices | INVOICE_READ |
| POST | `/:id/send` | Send invoice to client | INVOICE_UPDATE |

---

### **💸 Payment Management (`/api/v1/payments`)**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| POST | `/` | Create payment | INVOICE_UPDATE |
| GET | `/` | List payments | INVOICE_READ |
| GET | `/:id` | Get payment details | INVOICE_READ |
| PUT | `/:id` | Update payment | INVOICE_UPDATE |
| DELETE | `/:id` | Delete payment | INVOICE_DELETE |
| GET | `/invoice/:invoiceId` | Get invoice payments | INVOICE_READ |
| GET | `/client/:clientId` | Get client payments | INVOICE_READ |

---

### **📝 Daily Progress Report (DPR) (`/api/v1/dpr`)**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| POST | `/` | Create DPR | DPR_CREATE |
| GET | `/` | List DPRs | DPR_READ |
| GET | `/:id` | Get DPR details | DPR_READ |
| PUT | `/:id` | Update DPR | DPR_UPDATE |
| PATCH | `/:id/approve` | Approve DPR | DPR_APPROVE |
| DELETE | `/:id` | Delete DPR | DPR_DELETE |
| GET | `/project/:projectId` | Get project DPRs | DPR_READ |
| POST | `/:id/photos` | Add DPR photo | DPR_CREATE |

---

### **🚜 Equipment Management (`/api/v1/equipment`)**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| POST | `/` | Create equipment | EQUIPMENT_CREATE |
| GET | `/` | List equipment | EQUIPMENT_READ |
| GET | `/:id` | Get equipment details | EQUIPMENT_READ |
| PUT | `/:id` | Update equipment | EQUIPMENT_UPDATE |
| DELETE | `/:id` | Delete equipment | EQUIPMENT_DELETE |
| POST | `/:id/assign` | Assign equipment | EQUIPMENT_ASSIGN |
| GET | `/maintenance` | Get maintenance records | EQUIPMENT_READ |
| POST | `/:id/maintenance` | Add maintenance record | EQUIPMENT_UPDATE |

---

### **💰 Payroll Management (`/api/v1/payroll`)**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| POST | `/` | Create payroll | PAYROLL_CREATE |
| GET | `/` | List payrolls | PAYROLL_READ |
| GET | `/:id` | Get payroll details | PAYROLL_READ |
| PUT | `/:id` | Update payroll | PAYROLL_UPDATE |
| PATCH | `/:id/approve` | Approve payroll | PAYROLL_APPROVE |
| DELETE | `/:id` | Delete payroll | PAYROLL_DELETE |
| GET | `/user/:userId` | Get user's payrolls | PAYROLL_READ |
| GET | `/company/:companyId` | Get company payrolls | PAYROLL_READ |

---

### **📅 Leave Management (`/api/v1/leaves`)**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| POST | `/` | Apply for leave | User |
| GET | `/` | List leaves | TASK_READ |
| GET | `/:id` | Get leave details | User or Admin |
| PUT | `/:id` | Update leave | User |
| PATCH | `/:id/approve` | Approve/reject leave | TASK_UPDATE |
| DELETE | `/:id` | Delete leave | User or Admin |
| GET | `/user/:userId` | Get user's leaves | User or Admin |
| GET | `/pending` | Get pending leaves | TASK_READ |

---

### **⏱️ Timesheet Management (`/api/v1/timesheets`)**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| POST | `/` | Create timesheet | User |
| GET | `/` | List timesheets | TASK_READ |
| GET | `/:id` | Get timesheet details | User or Admin |
| PUT | `/:id` | Update timesheet | User |
| PATCH | `/:id/approve` | Approve timesheet | TASK_UPDATE |
| DELETE | `/:id` | Delete timesheet | User or Admin |
| GET | `/user/:userId` | Get user's timesheets | User or Admin |

---

### **📄 Document Management (`/api/v1/documents`)**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| POST | `/` | Upload document | User |
| GET | `/` | List documents | User |
| GET | `/:id` | Get document details | User |
| PUT | `/:id` | Update document | Uploader or Admin |
| DELETE | `/:id` | Delete document | Uploader or Admin |
| GET | `/project/:projectId` | Get project documents | User |
| GET | `/type/:documentType` | Get documents by type | User |

---

### **📨 Messaging (`/api/v1/messages`)**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| POST | `/` | Send message | User |
| GET | `/` | List messages | User |
| GET | `/:id` | Get message details | User |
| PUT | `/:id/read` | Mark as read | User |
| DELETE | `/:id` | Delete message | User |
| GET | `/conversation/:userId` | Get conversation | User |
| GET | `/unread` | Get unread messages | User |

---

### **🔔 Notifications (`/api/v1/notifications`)**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| GET | `/` | List notifications | User |
| GET | `/:id` | Get notification | User |
| PUT | `/:id/read` | Mark as read | User |
| DELETE | `/:id` | Delete notification | User |
| PUT | `/read-all` | Mark all as read | User |
| GET | `/unread` | Get unread notifications | User |

---

### **⚙️ Settings (`/api/v1/settings`)**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| GET | `/company` | Get company settings | Company Admin |
| PUT | `/company` | Update company settings | SETTINGS_UPDATE |
| GET | `/user` | Get user settings | User |
| PUT | `/user` | Update user settings | User |

---

### **📈 Reports (`/api/v1/reports`)**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| GET | `/attendance` | Attendance report | REPORTS_VIEW |
| GET | `/project-progress` | Project progress report | REPORTS_VIEW |
| GET | `/financial` | Financial report | REPORTS_VIEW |
| GET | `/inventory` | Inventory report | REPORTS_VIEW |
| GET | `/payroll` | Payroll report | REPORTS_VIEW |
| GET | `/employee-performance` | Employee performance report | REPORTS_VIEW |

---

### **📊 Audit Logs (`/api/v1/audit-logs`) - Admin Only**
| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| GET | `/` | List audit logs | Company Admin |
| GET | `/:id` | Get audit log | Company Admin |
| GET | `/user/:userId` | Get user's audit logs | Company Admin |
| GET | `/company/:companyId` | Get company audit logs | Super Admin |

---

## 🔐 Authentication Flow

1. **Registration:** User provides email, password, name → Returns JWT token
2. **Login:** Email/password verification → Returns access & refresh tokens
3. **Access Token:** Short-lived (7 days) for API access
4. **Refresh Token:** Long-lived (30 days) to get new access tokens
5. **Protected Routes:** Include `Authorization: Bearer <access_token>` header
6. **Role-based Access:** Middleware validates user roles for endpoints

Perfect — this schema is **enterprise-grade**, so your **permissions must be equally granular**.
Below is a **production-ready, README-friendly permission catalog**, designed for **RBAC + predefined permissions**, where:

- ✅ **Permissions are predefined (not dynamic strings)**
- ✅ **Only SUPER_ADMIN can create roles & assign permissions**
- ✅ **Roles = collection of permissions**
- ✅ **Multiple users can share the same role**

```
  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   User Enters   │────▶│ System Checks   │────▶│   Password      │
│ Email/Phone     │     │ Account Status  │     │   Exists?       │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                    ┌─────────────┐ No    ┌─────────────▼─────────┐
                    │ Send OTP    │◀──────│   OTP Verification    │
                    │ to Email/   │       │    + Set Password     │
                    │   Phone     │       └───────────────────────┘
                    └─────────────┘                 │ Yes
                           │                        │
                    ┌──────▼───────────────────────┐▼──────────────┐
                    │    Verify OTP &              │ Verify        │
                    │    Set Password              │ Password      │
                    └────────────┬─────────────────┴───────┬───────┘
                                 │                         │
                    ┌────────────▼─────────────────────────▼────────────┐
                    │          Generate JWT Tokens                       │
                    │    (Access: 7 days, Refresh: 30 days)              │
                    └───────────────────────────────────────────────────┘

```
---

# 🔐 RBAC Permission Catalog (Predefined)

> These permissions are **derived directly from your Prisma schema** and cover **minute-to-minute operational control**.

---

## 🧑‍💼 User & Role Management

| Permission Code            | Description                            |
| -------------------------- | -------------------------------------- |
| `user.create`              | Create new users                       |
| `user.view`                | View user profiles                     |
| `user.update`              | Update user details                    |
| `user.delete`              | Deactivate / delete users              |
| `user.assign_role`         | Assign role to user                    |
| `user.reset_password`      | Reset user password                    |
| `user.activate_deactivate` | Enable / disable user                  |
| `role.create`              | Create new role (**SUPER ADMIN only**) |
| `role.update`              | Update role permissions                |
| `role.delete`              | Delete role                            |
| `role.view`                | View roles & permissions               |
| `permission.assign`        | Assign permissions to roles            |

---

## 🏢 Company & Settings

| Permission Code           | Description               |
| ------------------------- | ------------------------- |
| `company.create`          | Create company            |
| `company.view`            | View company details      |
| `company.update`          | Update company profile    |
| `company.settings.manage` | Manage company settings   |
| `company.bank.manage`     | Manage bank & GST details |

---

## 👤 Client Management

| Permission Code          | Description                     |
| ------------------------ | ------------------------------- |
| `client.create`          | Add client                      |
| `client.view`            | View client details             |
| `client.update`          | Update client                   |
| `client.delete`          | Deactivate client               |
| `client.view_financials` | View client invoices & payments |

---

## 📁 Project Management

| Permission Code                | Description                     |
| ------------------------------ | ------------------------------- |
| `project.create`               | Create project                  |
| `project.view`                 | View project                    |
| `project.update`               | Update project                  |
| `project.delete`               | Archive / delete project        |
| `project.assign_manager`       | Assign project manager          |
| `project.assign_site_engineer` | Assign site engineer            |
| `project.update_status`        | Change project status           |
| `project.update_budget`        | Modify budget & contract values |
| `project.view_reports`         | View project analytics          |

---

## 🎯 Milestones

| Permission Code      | Description              |
| -------------------- | ------------------------ |
| `milestone.create`   | Create milestone         |
| `milestone.view`     | View milestones          |
| `milestone.update`   | Update milestone         |
| `milestone.complete` | Mark milestone completed |
| `milestone.delete`   | Delete milestone         |

---

## 🧩 Task & Subtask Management

| Permission Code          | Description           |
| ------------------------ | --------------------- |
| `task.create`            | Create task           |
| `task.view`              | View task             |
| `task.update`            | Update task           |
| `task.assign`            | Assign task           |
| `task.change_status`     | Change task status    |
| `task.delete`            | Delete task           |
| `subtask.create`         | Create subtask        |
| `subtask.update`         | Update subtask        |
| `subtask.complete`       | Mark subtask complete |
| `task.comment.add`       | Add comment           |
| `task.attachment.upload` | Upload attachment     |

---

## 📊 Daily Progress Report (DPR)

| Permission Code    | Description       |
| ------------------ | ----------------- |
| `dpr.create`       | Create DPR        |
| `dpr.view`         | View DPR          |
| `dpr.update`       | Edit DPR          |
| `dpr.approve`      | Approve DPR       |
| `dpr.reject`       | Reject DPR        |
| `dpr.upload_photo` | Upload DPR photos |

---

## ⏱ Attendance & Leave

| Permission Code   | Description     |
| ----------------- | --------------- |
| `attendance.mark` | Mark attendance |
| `attendance.view` | View attendance |
| `attendance.edit` | Edit attendance |
| `leave.apply`     | Apply leave     |
| `leave.view`      | View leave      |
| `leave.approve`   | Approve leave   |
| `leave.reject`    | Reject leave    |

---

## 💰 Expenses

| Permission Code   | Description     |
| ----------------- | --------------- |
| `expense.create`  | Create expense  |
| `expense.view`    | View expenses   |
| `expense.update`  | Update expense  |
| `expense.approve` | Approve expense |
| `expense.reject`  | Reject expense  |

---

## 🧱 Materials & Inventory

| Permission Code            | Description      |
| -------------------------- | ---------------- |
| `material.create`          | Add material     |
| `material.view`            | View materials   |
| `material.update`          | Update material  |
| `material.deactivate`      | Disable material |
| `material.request.create`  | Request material |
| `material.request.approve` | Approve material |
| `material.request.order`   | Place order      |
| `material.request.receive` | Mark delivered   |
| `material.request.reject`  | Reject request   |

---

## 🧾 Invoicing & Payments

| Permission Code   | Description     |
| ----------------- | --------------- |
| `invoice.create`  | Create invoice  |
| `invoice.view`    | View invoice    |
| `invoice.update`  | Update invoice  |
| `invoice.approve` | Approve invoice |
| `invoice.cancel`  | Cancel invoice  |
| `payment.record`  | Record payment  |
| `payment.view`    | View payments   |

---

## 📄 Documents

| Permission Code    | Description      |
| ------------------ | ---------------- |
| `document.upload`  | Upload document  |
| `document.view`    | View document    |
| `document.update`  | Update document  |
| `document.archive` | Archive document |
| `document.delete`  | Delete document  |

---

## 📅 Meetings & MOM

| Permission Code          | Description       |
| ------------------------ | ----------------- |
| `meeting.create`         | Schedule meeting  |
| `meeting.view`           | View meetings     |
| `meeting.update`         | Update meeting    |
| `meeting.attend`         | Attend meeting    |
| `meeting.minutes.create` | Create MOM        |
| `meeting.minutes.assign` | Assign MOM action |

---

## 🔍 Inspections

| Permission Code     | Description       |
| ------------------- | ----------------- |
| `inspection.create` | Create inspection |
| `inspection.view`   | View inspection   |
| `inspection.update` | Update inspection |
| `inspection.close`  | Close inspection  |

---

## 🦺 Safety & Compliance

| Permission Code           | Description            |
| ------------------------- | ---------------------- |
| `safety.training.create`  | Create safety training |
| `safety.training.attend`  | Attend training        |
| `safety.training.certify` | Upload certificate     |
| `safety.incident.report`  | Report incident        |
| `safety.incident.view`    | View incidents         |
| `safety.incident.update`  | Update incident        |
| `safety.incident.close`   | Close incident         |

---

## 💬 Messaging & Notifications

| Permission Code       | Description          |
| --------------------- | -------------------- |
| `message.send`        | Send message         |
| `message.view`        | View messages        |
| `notification.view`   | View notifications   |
| `notification.manage` | Manage notifications |

---

## ⚙️ System & Audit (SUPER ADMIN)

| Permission Code          | Description           |
| ------------------------ | --------------------- |
| `system.view_logs`       | View system logs      |
| `system.audit`           | Audit actions         |
| `system.override`        | Override approvals    |
| `system.settings.manage` | Manage system configs |

---

## 🧪 Testing the API

### Postman Collection

Import the complete Postman collection to test all endpoints:

🔗 **[Postman Collection](https://sidd66.postman.co/workspace/Personal-Workspace~208509c3-6d5e-4e99-adff-8eaca3f79b0c/folder/38580206-35520c35-52f8-4658-839e-294072bd1663?action=share&source=copy-link&creator=38580206&ctx=documentation)**

### Quick Test Commands

```bash
# Health check
curl http://localhost:3000/api/health

# Test endpoint
curl http://localhost:3000/api/test

# Register user (Super Admin)
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@construction.com",
    "password": "Admin@123",
    "name": "System Admin",
    "role": "SUPER_ADMIN",
    "employeeId": "SA001"
  }'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@construction.com","password":"Admin@123"}'

# Get profile (with token)
curl -X GET http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## 🛡️ Security Features

- **JWT Authentication:** Secure token-based auth with refresh tokens
- **Password Hashing:** bcrypt with 10 salt rounds
- **Input Validation:** Zod schemas for all endpoints
- **SQL Injection Protection:** Prisma ORM with parameterized queries
- **XSS Protection:** Input sanitization middleware
- **Rate Limiting:** 1000 requests/15 minutes per IP
- **CORS:** Configurable cross-origin resource sharing
- **Helmet:** 11 security headers
- **File Upload Validation:** MIME type and size validation
- **Environment Variables:** Sensitive data protection
- **Audit Logging:** All critical operations logged

## 📊 Database Features

- **PostgreSQL 14+:** Robust relational database
- **Prisma ORM:** Type-safe database access
- **Migrations:** Version-controlled schema changes
- **Relationships:** 40+ models with proper relations
- **Indexes:** Optimized query performance
- **Cascade Delete:** Proper referential integrity
- **Transactions:** ACID compliance
- **Backup Ready:** Easy backup and restore

## 🚀 Deployment

### 1. Production Build

```bash
# Install production dependencies only
npm ci --only=production

# Set environment to production
export NODE_ENV=production

# Run database migrations
npx prisma migrate deploy

# Start the server
npm start
```

### 2. Environment Variables for Production

```env
# =============== SERVER CONFIG ===============
PORT=5000
NODE_ENV=production
CORS_ORIGIN=http://localhost:3000

# =============== DATABASE CONFIG ===============
DATABASE_URL="postgresql://construction_user:SecurePass123@localhost:5432/construction_db?schema=public"

# =============== JWT CONFIGURATION ===============
JWT_SECRET="your-32-character-super-secret-jwt-key-here"
JWT_REFRESH_SECRET="another-32-character-refresh-secret-key"
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# =============== EMAIL CONFIG (Gmail) ===============
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-specific-password
EMAIL_FROM="Construction App <your-email@gmail.com>"

# =============== SMS CONFIG (2Factor.in) ===============
TWO_FACTOR_API_KEY=your-api-key-from-2factor.in

# =============== APPLICATION URL ===============
APP_URL=http://localhost:3000
```

## 🐛 Error Handling

The API returns consistent error responses:

| Status Code | Error Type           | Description              | Example Response                                              |
| ----------- | -------------------- | ------------------------ | ------------------------------------------------------------- |
| 400         | Bad Request          | Validation error         | `{success: false, error: "Validation Error", details: [...]}` |
| 401         | Unauthorized         | Authentication required  | `{success: false, error: "Authentication required"}`          |
| 403         | Forbidden            | Insufficient permissions | `{success: false, error: "Access denied"}`                    |
| 404         | Not Found            | Resource doesn't exist   | `{success: false, error: "Not found"}`                        |
| 409         | Conflict             | Duplicate entry          | `{success: false, error: "User already exists"}`              |
| 413         | Payload Too Large    | File too large           | `{success: false, error: "File too large"}`                   |
| 422         | Unprocessable Entity | Business logic error     | `{success: false, error: "Invalid operation"}`                |
| 429         | Too Many Requests    | Rate limit exceeded      | `{success: false, error: "Too many requests"}`                |
| 500         | Server Error         | Internal server error    | `{success: false, error: "Internal server error"}`            |

## 📝 Scripts

```bash
# Development
npm run dev           # Start dev server with nodemon
npm run dev:debug     # Start with debugger

# Production
npm start            # Start production server
npm run build        # Build for production

# Database
npm run prisma:generate  # Generate Prisma client
npm run prisma:migrate   # Run migrations
npm run prisma:studio    # Open Prisma Studio
npm run prisma:reset     # Reset database (dev only)

# Code Quality
npm run lint          # Lint code
npm run format        # Format code with Prettier
npm run format:check  # Check code formatting
npm run test          # Run tests
npm run test:watch    # Run tests in watch mode

# Maintenance
npm run backup:db     # Backup database
npm run restore:db    # Restore database
npm run clean         # Clean build artifacts
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test file
npm test -- --testPathPattern=auth.test.js

# Run with coverage
npm test -- --coverage

# Run in watch mode
npm run test:watch

# Run integration tests
npm run test:integration
```

## 📈 Monitoring & Logging

- **Console Logging:** Development environment
- **File Logging:** Production (rotating logs)
- **Health Checks:** `/api/health` endpoint
- **Metrics:** Prometheus metrics endpoint (optional)
- **Error Tracking:** Sentry integration (optional)

## 🔄 API Versioning

- Current version: v1
- URL pattern: `/api/v1/endpoint`
- Future versions will maintain backward compatibility
- Deprecated endpoints will have 1-year sunset period

## 🤝 Contributing

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/AmazingFeature`)
3. **Commit** your changes (`git commit -m 'Add AmazingFeature'`)
4. **Push** to the branch (`git push origin feature/AmazingFeature`)
5. **Open** a Pull Request

### Contribution Guidelines

- Follow existing code style
- Write tests for new features
- Update documentation
- Use meaningful commit messages
- Keep PRs focused and small
