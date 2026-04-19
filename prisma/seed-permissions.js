// prisma/seed-permissions.js
import prisma from '../src/config/database.js';

const permissions = [
  // User Management
  {
    code: 'USER_CREATE',
    name: 'Create User',
    module: 'USER_MANAGEMENT',
    description: 'Create new users in the company',
    category: 'HR',
  },
  {
    code: 'USER_READ',
    name: 'View Users',
    module: 'USER_MANAGEMENT',
    description: 'View all users in the company',
    category: 'HR',
  },
  {
    code: 'USER_UPDATE',
    name: 'Update User',
    module: 'USER_MANAGEMENT',
    description: 'Update user details',
    category: 'HR',
  },
  {
    code: 'USER_DELETE',
    name: 'Delete User',
    module: 'USER_MANAGEMENT',
    description: 'Delete users from the company',
    category: 'HR',
  },
  {
    code: 'USER_ACTIVATE',
    name: 'Activate/Deactivate User',
    module: 'USER_MANAGEMENT',
    description: 'Activate or deactivate user accounts',
    category: 'HR',
  },

  // Project Management
  {
    code: 'PROJECT_CREATE',
    name: 'Create Project',
    module: 'PROJECT_MANAGEMENT',
    description: 'Create new projects',
    category: 'PROJECTS',
  },
  {
    code: 'PROJECT_READ',
    name: 'View Projects',
    module: 'PROJECT_MANAGEMENT',
    description: 'View all projects',
    category: 'PROJECTS',
  },
  {
    code: 'PROJECT_UPDATE',
    name: 'Update Project',
    module: 'PROJECT_MANAGEMENT',
    description: 'Update project details',
    category: 'PROJECTS',
  },
  {
    code: 'PROJECT_DELETE',
    name: 'Delete Project',
    module: 'PROJECT_MANAGEMENT',
    description: 'Delete projects',
    category: 'PROJECTS',
  },
  {
    code: 'PROJECT_SETTINGS_UPDATE',
    name: 'Update Project Settings',
    module: 'PROJECT_MANAGEMENT',
    description: 'Update project-specific settings',
    category: 'PROJECTS',
  },
  {
    code: 'VIEW_ALL_PROJECTS',
    name: 'View All Projects',
    module: 'PROJECT_MANAGEMENT',
    description: 'View all projects in company without assignment',
    category: 'PROJECTS',
  },

  // Attendance Management
  {
    code: 'ATTENDANCE_CREATE',
    name: 'Mark Attendance',
    module: 'ATTENDANCE_MANAGEMENT',
    description: 'Mark attendance for users',
    category: 'HR',
  },
  {
    code: 'ATTENDANCE_READ',
    name: 'View Attendance',
    module: 'ATTENDANCE_MANAGEMENT',
    description: 'View attendance records',
    category: 'HR',
  },
  {
    code: 'ATTENDANCE_UPDATE',
    name: 'Update Attendance',
    module: 'ATTENDANCE_MANAGEMENT',
    description: 'Update attendance records',
    category: 'HR',
  },
  {
    code: 'ATTENDANCE_VERIFY',
    name: 'Verify Attendance',
    module: 'ATTENDANCE_MANAGEMENT',
    description: 'Verify attendance records',
    category: 'HR',
  },

  // Task Management
  {
    code: 'TASK_CREATE',
    name: 'Create Task',
    module: 'TASK_MANAGEMENT',
    description: 'Create tasks',
    category: 'PROJECTS',
  },
  {
    code: 'TASK_READ',
    name: 'View Tasks',
    module: 'TASK_MANAGEMENT',
    description: 'View all tasks',
    category: 'PROJECTS',
  },
  {
    code: 'TASK_UPDATE',
    name: 'Update Task',
    module: 'TASK_MANAGEMENT',
    description: 'Update task details',
    category: 'PROJECTS',
  },
  {
    code: 'TASK_DELETE',
    name: 'Delete Task',
    module: 'TASK_MANAGEMENT',
    description: 'Delete tasks',
    category: 'PROJECTS',
  },

  // Expense Management
  {
    code: 'EXPENSE_CREATE',
    name: 'Create Expense',
    module: 'EXPENSE_MANAGEMENT',
    description: 'Create expense entries',
    category: 'FINANCE',
  },
  {
    code: 'EXPENSE_READ',
    name: 'View Expenses',
    module: 'EXPENSE_MANAGEMENT',
    description: 'View all expenses',
    category: 'FINANCE',
  },
  {
    code: 'EXPENSE_APPROVE',
    name: 'Approve Expenses',
    module: 'EXPENSE_MANAGEMENT',
    description: 'Approve or reject expenses',
    category: 'FINANCE',
  },
  {
    code: 'EXPENSE_UPDATE',
    name: 'Update Expense',
    module: 'EXPENSE_MANAGEMENT',
    description: 'Update expense details',
    category: 'FINANCE',
  },

  // Transaction Management
  {
    code: 'TRANSACTION_CREATE',
    name: 'Create Transaction',
    module: 'TRANSACTION_MANAGEMENT',
    description: 'Create income, expense, and petty cash transactions',
    category: 'FINANCE',
  },
  {
    code: 'TRANSACTION_READ',
    name: 'View Transactions',
    module: 'TRANSACTION_MANAGEMENT',
    description: 'View transaction ledger and details',
    category: 'FINANCE',
  },
  {
    code: 'TRANSACTION_APPROVE',
    name: 'Approve Transactions',
    module: 'TRANSACTION_MANAGEMENT',
    description: 'Approve or reject pending transactions',
    category: 'FINANCE',
  },
  {
    code: 'TRANSACTION_VOID',
    name: 'Void Transactions',
    module: 'TRANSACTION_MANAGEMENT',
    description: 'Void approved transactions and reverse effects',
    category: 'FINANCE',
  },
  {
    code: 'TRANSACTION_REPORT',
    name: 'View Transaction Reports',
    module: 'TRANSACTION_MANAGEMENT',
    description: 'View transaction summaries and cashbox statements',
    category: 'FINANCE',
  },
  {
    code: 'PETTY_CASH_MANAGE',
    name: 'Manage Petty Cash',
    module: 'TRANSACTION_MANAGEMENT',
    description: 'Manage project petty cash operations',
    category: 'FINANCE',
  },

  // Inventory General (NEW)
  {
    code: 'INVENTORY_READ',
    name: 'View Inventory',
    module: 'INVENTORY_MANAGEMENT',
    description: 'View global and project inventory levels',
    category: 'INVENTORY',
  },
  {
    code: 'INVENTORY_WRITE',
    name: 'Manage Inventory Stock',
    module: 'INVENTORY_MANAGEMENT',
    description: 'Add opening stock, perform stock transactions',
    category: 'INVENTORY',
  },

  // Material Management
  {
    code: 'MATERIAL_CREATE',
    name: 'Create Material',
    module: 'MATERIAL_MANAGEMENT',
    description: 'Create material inventory definitions',
    category: 'INVENTORY',
  },
  {
    code: 'MATERIAL_READ',
    name: 'View Materials',
    module: 'MATERIAL_MANAGEMENT',
    description: 'View material definitions',
    category: 'INVENTORY',
  },
  {
    code: 'MATERIAL_UPDATE', // NEW
    name: 'Update Material',
    module: 'MATERIAL_MANAGEMENT',
    description: 'Update material definitions',
    category: 'INVENTORY',
  },
  {
    code: 'MATERIAL_DELETE', // NEW
    name: 'Delete Material',
    module: 'MATERIAL_MANAGEMENT',
    description: 'Delete material definitions',
    category: 'INVENTORY',
  },
  {
    code: 'MATERIAL_REQUEST',
    name: 'Request Materials',
    module: 'MATERIAL_MANAGEMENT',
    description: 'Request materials for projects',
    category: 'INVENTORY',
  },
  {
    code: 'MATERIAL_APPROVE',
    name: 'Approve Material Requests',
    module: 'MATERIAL_MANAGEMENT',
    description: 'Approve material requests',
    category: 'INVENTORY',
  },
  {
    code: 'MATERIAL_STOCK_MANAGE',
    name: 'Manage Material Stock',
    module: 'MATERIAL_MANAGEMENT',
    description: 'Update material stock quantities',
    category: 'INVENTORY',
  },
  {
    code: 'MATERIAL_STOCK_VIEW',
    name: 'View Material Stock',
    module: 'MATERIAL_MANAGEMENT',
    description: 'View material stock levels',
    category: 'INVENTORY',
  },
  {
    code: 'MATERIAL_STOCK_ADJUST',
    name: 'Adjust Material Stock',
    module: 'MATERIAL_MANAGEMENT',
    description: 'Adjust material stock quantities',
    category: 'INVENTORY',
  },
  {
    code: 'MATERIAL_CONSUME',
    name: 'Consume Materials',
    module: 'MATERIAL_MANAGEMENT',
    description: 'Consume materials for projects',
    category: 'INVENTORY',
  },
  {
    code: 'MATERIAL_REPORT',
    name: 'View Material Reports',
    module: 'MATERIAL_MANAGEMENT',
    description: 'View material consumption reports',
    category: 'INVENTORY',
  },

  // Client Management
  {
    code: 'CLIENT_CREATE',
    name: 'Create Client',
    module: 'CLIENT_MANAGEMENT',
    description: 'Create new clients',
    category: 'CRM',
  },
  {
    code: 'CLIENT_READ',
    name: 'View Clients',
    module: 'CLIENT_MANAGEMENT',
    description: 'View all clients',
    category: 'CRM',
  },
  {
    code: 'CLIENT_UPDATE',
    name: 'Update Client',
    module: 'CLIENT_MANAGEMENT',
    description: 'Update client details',
    category: 'CRM',
  },
  {
    code: 'CLIENT_DELETE',
    name: 'Delete Client',
    module: 'CLIENT_MANAGEMENT',
    description: 'Delete clients',
    category: 'CRM',
  },

  // Invoice Management
  {
    code: 'INVOICE_CREATE',
    name: 'Create Invoice',
    module: 'INVOICE_MANAGEMENT',
    description: 'Create invoices',
    category: 'FINANCE',
  },
  {
    code: 'INVOICE_READ',
    name: 'View Invoices',
    module: 'INVOICE_MANAGEMENT',
    description: 'View all invoices',
    category: 'FINANCE',
  },
  {
    code: 'INVOICE_APPROVE',
    name: 'Approve Invoices',
    module: 'INVOICE_MANAGEMENT',
    description: 'Approve invoices',
    category: 'FINANCE',
  },
  {
    code: 'INVOICE_UPDATE',
    name: 'Update Invoice',
    module: 'INVOICE_MANAGEMENT',
    description: 'Update invoice details',
    category: 'FINANCE',
  },

  // DPR Management
  {
    code: 'DPR_CREATE',
    name: 'Create DPR',
    module: 'DPR_MANAGEMENT',
    description: 'Create Daily Progress Reports',
    category: 'PROJECTS',
  },
  {
    code: 'DPR_READ',
    name: 'View DPR',
    module: 'DPR_MANAGEMENT',
    description: 'View Daily Progress Reports',
    category: 'PROJECTS',
  },
  {
    code: 'DPR_UPDATE',
    name: 'Update DPR',
    module: 'DPR_MANAGEMENT',
    description: 'Update Daily Progress Reports',
    category: 'PROJECTS',
  },
  {
    code: 'DPR_DELETE',
    name: 'Delete DPR',
    module: 'DPR_MANAGEMENT',
    description: 'Delete Daily Progress Reports',
    category: 'PROJECTS',
  },
  {
    code: 'DPR_APPROVE',
    name: 'Approve DPR',
    module: 'DPR_MANAGEMENT',
    description: 'Approve Daily Progress Reports',
    category: 'PROJECTS',
  },
  {
    code: 'DPR_PHOTO_UPLOAD',
    name: 'Upload DPR Photos',
    module: 'DPR_MANAGEMENT',
    description: 'Upload photos to Daily Progress Reports',
    category: 'PROJECTS',
  },
  {
    code: 'VIEW_ALL_DPRS',
    name: 'View All DPRs',
    module: 'DPR_MANAGEMENT',
    description: 'View all DPRs in company without project assignment',
    category: 'PROJECTS',
  },

  // Equipment Management
  {
    code: 'EQUIPMENT_CREATE',
    name: 'Create Equipment',
    module: 'EQUIPMENT_MANAGEMENT',
    description: 'Add equipment to inventory',
    category: 'INVENTORY',
  },
  {
    code: 'EQUIPMENT_READ',
    name: 'View Equipment',
    module: 'EQUIPMENT_MANAGEMENT',
    description: 'View equipment inventory',
    category: 'INVENTORY',
  },
  {
    code: 'EQUIPMENT_ASSIGN',
    name: 'Assign Equipment',
    module: 'EQUIPMENT_MANAGEMENT',
    description: 'Assign equipment to projects/users',
    category: 'INVENTORY',
  },

  // Payroll Management
  {
    code: 'PAYROLL_CREATE',
    name: 'Create Payroll',
    module: 'PAYROLL_MANAGEMENT',
    description: 'Generate payroll',
    category: 'FINANCE',
  },
  {
    code: 'PAYROLL_READ',
    name: 'View Payroll',
    module: 'PAYROLL_MANAGEMENT',
    description: 'View payroll records',
    category: 'FINANCE',
  },
  {
    code: 'PAYROLL_APPROVE',
    name: 'Approve Payroll',
    module: 'PAYROLL_MANAGEMENT',
    description: 'Approve payroll',
    category: 'FINANCE',
  },

  // Settings Management
  {
    code: 'SETTINGS_UPDATE',
    name: 'Update Settings',
    module: 'SETTINGS_MANAGEMENT',
    description: 'Update company settings',
    category: 'ADMIN',
  },
  {
    code: 'ROLE_MANAGE',
    name: 'Manage Roles',
    module: 'SETTINGS_MANAGEMENT',
    description: 'Create and manage roles',
    category: 'ADMIN',
  },
  {
    code: 'PERMISSION_MANAGE',
    name: 'Manage Permissions',
    module: 'SETTINGS_MANAGEMENT',
    description: 'Manage role permissions',
    category: 'ADMIN',
  },

  // Reports
  {
    code: 'REPORTS_VIEW',
    name: 'View Reports',
    module: 'REPORTS',
    description: 'View all reports',
    category: 'ADMIN',
  },

  // Contractor Management
  {
    code: 'CONTRACTOR_CREATE',
    name: 'Create Subcontractor',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Create new subcontractor profiles',
    category: 'PROJECTS',
  },
  {
    code: 'CONTRACTOR_READ',
    name: 'View Subcontractors',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'View all subcontractors',
    category: 'PROJECTS',
  },
  {
    code: 'CONTRACTOR_UPDATE',
    name: 'Update Subcontractor',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Update subcontractor details',
    category: 'PROJECTS',
  },
  {
    code: 'CONTRACTOR_DELETE',
    name: 'Delete Subcontractor',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Delete subcontractors',
    category: 'PROJECTS',
  },
  {
    code: 'CONTRACTOR_VERIFY',
    name: 'Verify Subcontractor',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Verify subcontractor documents and details',
    category: 'PROJECTS',
  },
  {
    code: 'CONTRACTOR_BLACKLIST',
    name: 'Blacklist Subcontractor',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Blacklist or unblacklist subcontractors',
    category: 'PROJECTS',
  },

  // Contractor Worker Management
  {
    code: 'CONTRACTOR_WORKER_CREATE',
    name: 'Add Contractor Worker',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Add workers to subcontractor',
    category: 'PROJECTS',
  },
  {
    code: 'CONTRACTOR_WORKER_READ',
    name: 'View Contractor Workers',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'View subcontractor workers',
    category: 'PROJECTS',
  },
  {
    code: 'CONTRACTOR_WORKER_UPDATE',
    name: 'Update Contractor Worker',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Update worker details',
    category: 'PROJECTS',
  },
  {
    code: 'CONTRACTOR_WORKER_DELETE',
    name: 'Remove Contractor Worker',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Remove workers from subcontractor',
    category: 'PROJECTS',
  },

  // Contractor Project Management
  {
    code: 'CONTRACTOR_PROJECT_CREATE',
    name: 'Create Contractor Project',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Create subcontractor work assignments',
    category: 'PROJECTS',
  },
  {
    code: 'CONTRACTOR_PROJECT_READ',
    name: 'View Contractor Projects',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'View subcontractor work assignments',
    category: 'PROJECTS',
  },
  {
    code: 'CONTRACTOR_PROJECT_UPDATE',
    name: 'Update Contractor Project',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Update subcontractor work details',
    category: 'PROJECTS',
  },
  {
    code: 'CONTRACTOR_PROJECT_DELETE',
    name: 'Delete Contractor Project',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Delete subcontractor work assignments',
    category: 'PROJECTS',
  },
  {
    code: 'CONTRACTOR_PROJECT_APPROVE',
    name: 'Approve Contractor Project',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Approve subcontractor work completion',
    category: 'PROJECTS',
  },

  // Contractor Assignment Management
  {
    code: 'CONTRACTOR_ASSIGNMENT_CREATE',
    name: 'Create Work Assignment',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Assign workers to specific tasks',
    category: 'PROJECTS',
  },
  {
    code: 'CONTRACTOR_ASSIGNMENT_READ',
    name: 'View Work Assignments',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'View worker assignments',
    category: 'PROJECTS',
  },
  {
    code: 'CONTRACTOR_ASSIGNMENT_UPDATE',
    name: 'Update Work Assignment',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Update worker assignment details',
    category: 'PROJECTS',
  },
  {
    code: 'CONTRACTOR_ASSIGNMENT_VERIFY',
    name: 'Verify Work Completion',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Verify completion of assigned work',
    category: 'PROJECTS',
  },

  // Contractor Payment Management
  {
    code: 'CONTRACTOR_PAYMENT_CREATE',
    name: 'Create Contractor Payment',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Create payments for subcontractors',
    category: 'FINANCE',
  },
  {
    code: 'CONTRACTOR_PAYMENT_READ',
    name: 'View Contractor Payments',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'View subcontractor payment history',
    category: 'FINANCE',
  },
  {
    code: 'CONTRACTOR_PAYMENT_UPDATE',
    name: 'Update Contractor Payment',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Update payment details',
    category: 'FINANCE',
  },
  {
    code: 'CONTRACTOR_PAYMENT_APPROVE',
    name: 'Approve Contractor Payment',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Approve subcontractor payments',
    category: 'FINANCE',
  },
  {
    code: 'CONTRACTOR_PAYMENT_PROCESS',
    name: 'Process Contractor Payment',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Process subcontractor payments',
    category: 'FINANCE',
  },

  // Contractor Review Management
  {
    code: 'CONTRACTOR_REVIEW_CREATE',
    name: 'Create Contractor Review',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Create reviews for subcontractors',
    category: 'PROJECTS',
  },
  {
    code: 'CONTRACTOR_REVIEW_READ',
    name: 'View Contractor Reviews',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'View subcontractor reviews',
    category: 'PROJECTS',
  },
  {
    code: 'CONTRACTOR_REVIEW_UPDATE',
    name: 'Update Contractor Review',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Update subcontractor reviews',
    category: 'PROJECTS',
  },
  {
    code: 'CONTRACTOR_REVIEW_APPROVE',
    name: 'Approve Contractor Review',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Approve subcontractor reviews',
    category: 'PROJECTS',
  },

  // Contractor Document Management
  {
    code: 'CONTRACTOR_DOCUMENT_UPLOAD',
    name: 'Upload Contractor Document',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Upload documents for subcontractors',
    category: 'PROJECTS',
  },
  {
    code: 'CONTRACTOR_DOCUMENT_READ',
    name: 'View Contractor Documents',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'View subcontractor documents',
    category: 'PROJECTS',
  },
  {
    code: 'CONTRACTOR_DOCUMENT_DELETE',
    name: 'Delete Contractor Document',
    module: 'CONTRACTOR_MANAGEMENT',
    description: 'Delete subcontractor documents',
    category: 'PROJECTS',
  },

  // Worker Management
  {
    code: 'WORKER_CREATE',
    name: 'Create Worker',
    module: 'WORKER_MANAGEMENT',
    description: 'Create new site staff or subcontractor workers',
    category: 'HR',
  },
  {
    code: 'WORKER_READ',
    name: 'View Workers',
    module: 'WORKER_MANAGEMENT',
    description: 'View all workers',
    category: 'HR',
  },
  {
    code: 'WORKER_UPDATE',
    name: 'Update Worker',
    module: 'WORKER_MANAGEMENT',
    description: 'Update worker details',
    category: 'HR',
  },
  {
    code: 'WORKER_DELETE',
    name: 'Delete Worker',
    module: 'WORKER_MANAGEMENT',
    description: 'Delete workers',
    category: 'HR',
  },
  {
    code: 'WORKER_ACTIVATE',
    name: 'Activate/Deactivate Worker',
    module: 'WORKER_MANAGEMENT',
    description: 'Activate or deactivate worker accounts',
    category: 'HR',
  },

  // Worker Attendance Permissions
  {
    code: 'WORKER_ATTENDANCE_MARK',
    name: 'Mark Worker Attendance',
    module: 'WORKER_ATTENDANCE',
    description: 'Mark attendance for workers',
    category: 'HR',
  },
  {
    code: 'WORKER_ATTENDANCE_READ',
    name: 'View Worker Attendance',
    module: 'WORKER_ATTENDANCE',
    description: 'View worker attendance records',
    category: 'HR',
  },
  {
    code: 'WORKER_ATTENDANCE_UPDATE',
    name: 'Update Worker Attendance',
    module: 'WORKER_ATTENDANCE',
    description: 'Update worker attendance records',
    category: 'HR',
  },
  {
    code: 'WORKER_ATTENDANCE_VERIFY',
    name: 'Verify Worker Attendance',
    module: 'WORKER_ATTENDANCE',
    description: 'Verify worker attendance records',
    category: 'HR',
  },
  {
    code: 'WORKER_ATTENDANCE_BULK_MARK',
    name: 'Bulk Mark Worker Attendance',
    module: 'WORKER_ATTENDANCE',
    description: 'Mark attendance for multiple workers at once',
    category: 'HR',
  },

  // Worker Subtask Assignment Permissions
  {
    code: 'WORKER_SUBTASK_ASSIGN',
    name: 'Assign Subtask to Worker',
    module: 'WORKER_ASSIGNMENT',
    description: 'Assign subtasks to workers',
    category: 'PROJECTS',
  },
  {
    code: 'WORKER_SUBTASK_READ',
    name: 'View Worker Subtasks',
    module: 'WORKER_ASSIGNMENT',
    description: 'View subtasks assigned to workers',
    category: 'PROJECTS',
  },
  {
    code: 'WORKER_SUBTASK_UPDATE',
    name: 'Update Worker Subtask',
    module: 'WORKER_ASSIGNMENT',
    description: 'Update worker subtask assignments',
    category: 'PROJECTS',
  },
  {
    code: 'WORKER_SUBTASK_VERIFY',
    name: 'Verify Worker Subtask',
    module: 'WORKER_ASSIGNMENT',
    description: 'Verify completion of worker subtasks',
    category: 'PROJECTS',
  },
  {
    code: 'WORKER_SUBTASK_REMOVE',
    name: 'Remove Worker Subtask',
    module: 'WORKER_ASSIGNMENT',
    description: 'Remove subtask assignments from workers',
    category: 'PROJECTS',
  },

  // System Permissions
  {
    code: 'ALL_ACCESS',
    name: 'All Access',
    module: 'SYSTEM',
    description: 'Full access to all features',
    category: 'SYSTEM',
  },
  {
    code: 'FULL_COMPANY_ACCESS',
    name: 'Full Company Access',
    module: 'SYSTEM',
    description: 'Full access to all company features and settings',
    category: 'SYSTEM',
  },

  // Timeline Management Permissions
  {
    code: 'TIMELINE_CREATE',
    name: 'Create Timeline',
    module: 'TIMELINE_MANAGEMENT',
    description: 'Create new project timelines',
    category: 'PROJECTS',
  },
  {
    code: 'TIMELINE_READ',
    name: 'View Timelines',
    module: 'TIMELINE_MANAGEMENT',
    description: 'View project timelines',
    category: 'PROJECTS',
  },
  {
    code: 'TIMELINE_UPDATE',
    name: 'Update Timeline',
    module: 'TIMELINE_MANAGEMENT',
    description: 'Update timeline details',
    category: 'PROJECTS',
  },
  {
    code: 'TIMELINE_DELETE',
    name: 'Delete Timeline',
    module: 'TIMELINE_MANAGEMENT',
    description: 'Delete timelines',
    category: 'PROJECTS',
  },

  // Timeline Version Management
  {
    code: 'TIMELINE_VERSION_CREATE',
    name: 'Create Timeline Version',
    module: 'TIMELINE_MANAGEMENT',
    description: 'Create new timeline versions',
    category: 'PROJECTS',
  },
  {
    code: 'TIMELINE_VERSION_READ',
    name: 'View Timeline Versions',
    module: 'TIMELINE_MANAGEMENT',
    description: 'View timeline version history',
    category: 'PROJECTS',
  },
  {
    code: 'TIMELINE_VERSION_UPDATE',
    name: 'Update Timeline Version',
    module: 'TIMELINE_MANAGEMENT',
    description: 'Update timeline versions',
    category: 'PROJECTS',
  },
  {
    code: 'TIMELINE_VERSION_DELETE',
    name: 'Delete Timeline Version',
    module: 'TIMELINE_MANAGEMENT',
    description: 'Delete timeline versions',
    category: 'PROJECTS',
  },
  {
    code: 'TIMELINE_VERSION_SET_BASELINE',
    name: 'Set Timeline Baseline',
    module: 'TIMELINE_MANAGEMENT',
    description: 'Set timeline version as baseline',
    category: 'PROJECTS',
  },

  // Timeline Task Management
  {
    code: 'TIMELINE_TASK_CREATE',
    name: 'Add Tasks to Timeline',
    module: 'TIMELINE_MANAGEMENT',
    description: 'Add tasks to project timeline',
    category: 'PROJECTS',
  },
  {
    code: 'TIMELINE_TASK_READ',
    name: 'View Timeline Tasks',
    module: 'TIMELINE_MANAGEMENT',
    description: 'View tasks in timeline',
    category: 'PROJECTS',
  },
  {
    code: 'TIMELINE_TASK_UPDATE',
    name: 'Update Timeline Tasks',
    module: 'TIMELINE_MANAGEMENT',
    description: 'Update timeline task scheduling',
    category: 'PROJECTS',
  },
  {
    code: 'TIMELINE_TASK_DELETE',
    name: 'Remove Timeline Tasks',
    module: 'TIMELINE_MANAGEMENT',
    description: 'Remove tasks from timeline',
    category: 'PROJECTS',
  },

  // Timeline Workflow Permissions
  {
    code: 'TIMELINE_SUBMIT',
    name: 'Submit Timeline for Approval',
    module: 'TIMELINE_MANAGEMENT',
    description: 'Submit timeline for approval',
    category: 'PROJECTS',
  },
  {
    code: 'TIMELINE_APPROVE',
    name: 'Approve/Reject Timeline',
    module: 'TIMELINE_MANAGEMENT',
    description: 'Approve or reject timelines',
    category: 'PROJECTS',
  },
  {
    code: 'TIMELINE_LOCK',
    name: 'Lock/Unlock Timeline',
    module: 'TIMELINE_MANAGEMENT',
    description: 'Lock or unlock timeline editing',
    category: 'PROJECTS',
  },
  {
    code: 'TIMELINE_ARCHIVE',
    name: 'Archive/Restore Timeline',
    module: 'TIMELINE_MANAGEMENT',
    description: 'Archive or restore timelines',
    category: 'PROJECTS',
  },

  // Timeline Analysis Permissions
  {
    code: 'TIMELINE_COMPARE',
    name: 'Compare Timeline Versions',
    module: 'TIMELINE_MANAGEMENT',
    description: 'Compare different timeline versions',
    category: 'PROJECTS',
  },
  {
    code: 'TIMELINE_ANALYZE',
    name: 'Analyze Timeline Data',
    module: 'TIMELINE_MANAGEMENT',
    description: 'Analyze timeline progress and metrics',
    category: 'PROJECTS',
  },

  // Timeline Audit Permissions
  {
    code: 'TIMELINE_HISTORY_READ',
    name: 'View Timeline History',
    module: 'TIMELINE_MANAGEMENT',
    description: 'View timeline change history',
    category: 'PROJECTS',
  },
  {
    code: 'TIMELINE_APPROVAL_READ',
    name: 'View Approval History',
    module: 'TIMELINE_MANAGEMENT',
    description: 'View timeline approval workflow history',
    category: 'PROJECTS',
  },
  // Add to your permissions array
  {
    code: 'PAYROLL_SHIFT_CREATE',
    name: 'Create Shift Type',
    module: 'PAYROLL_MANAGEMENT',
    description: 'Create new shift types with multipliers',
    category: 'PAYROLL',
  },
  {
    code: 'PAYROLL_SHIFT_READ',
    name: 'View Shift Types',
    module: 'PAYROLL_MANAGEMENT',
    description: 'View all shift types',
    category: 'PAYROLL',
  },
  {
    code: 'PAYROLL_SHIFT_UPDATE',
    name: 'Update Shift Type',
    module: 'PAYROLL_MANAGEMENT',
    description: 'Update shift type details',
    category: 'PAYROLL',
  },
  {
    code: 'PAYROLL_SHIFT_DELETE',
    name: 'Delete Shift Type',
    module: 'PAYROLL_MANAGEMENT',
    description: 'Delete shift types',
    category: 'PAYROLL',
  },
  {
    code: 'PAYROLL_RATE_CREATE',
    name: 'Create Labour Rate',
    module: 'PAYROLL_MANAGEMENT',
    description: 'Create new labour rates for workers',
    category: 'PAYROLL',
  },
  {
    code: 'PAYROLL_RATE_READ',
    name: 'View Labour Rates',
    module: 'PAYROLL_MANAGEMENT',
    description: 'View labour rates history',
    category: 'PAYROLL',
  },
  {
    code: 'PAYROLL_RATE_UPDATE',
    name: 'Update Labour Rate',
    module: 'PAYROLL_MANAGEMENT',
    description: 'Update labour rates',
    category: 'PAYROLL',
  },
  {
    code: 'PAYROLL_CALCULATE',
    name: 'Calculate Payroll',
    module: 'PAYROLL_MANAGEMENT',
    description: 'Calculate payroll for a period',
    category: 'PAYROLL',
  },
  {
    code: 'PAYROLL_CREATE',
    name: 'Create Payroll',
    module: 'PAYROLL_MANAGEMENT',
    description: 'Create payroll from calculations',
    category: 'PAYROLL',
  },
  {
    code: 'PAYROLL_READ',
    name: 'View Payrolls',
    module: 'PAYROLL_MANAGEMENT',
    description: 'View all payrolls',
    category: 'PAYROLL',
  },
  {
    code: 'PAYROLL_UPDATE',
    name: 'Update Payroll',
    module: 'PAYROLL_MANAGEMENT',
    description: 'Update payroll details',
    category: 'PAYROLL',
  },
  {
    code: 'PAYROLL_PROCESS',
    name: 'Process Payroll',
    module: 'PAYROLL_MANAGEMENT',
    description: 'Process payroll (mark as processed)',
    category: 'PAYROLL',
  },
  {
    code: 'PAYROLL_PAY',
    name: 'Mark Payroll as Paid',
    module: 'PAYROLL_MANAGEMENT',
    description: 'Mark payroll as paid',
    category: 'PAYROLL',
  },
  {
    code: 'PAYROLL_APPROVE',
    name: 'Approve Payroll',
    module: 'PAYROLL_MANAGEMENT',
    description: 'Approve payroll',
    category: 'PAYROLL',
  },
  {
    code: 'PAYROLL_CANCEL',
    name: 'Cancel Payroll',
    module: 'PAYROLL_MANAGEMENT',
    description: 'Cancel payroll',
    category: 'PAYROLL',
  },
  {
    code: 'PAYROLL_DELETE',
    name: 'Delete Payroll',
    module: 'PAYROLL_MANAGEMENT',
    description: 'Delete pending payrolls',
    category: 'PAYROLL',
  },
  {
    code: 'DASHBOARD_VIEW',
    name: 'View Dashboard',
    module: 'DASHBOARD',
    description: 'Can view dashboard and analytics',
    category: 'Dashboard',
  },
  {
    code: 'REPORTS_VIEW',
    name: 'View Reports',
    module: 'REPORTS',
    description: 'Can view reports and analytics',
    category: 'Reports',
  },

  // Purchase Order Management
  {
    code: 'PO_CREATE',
    name: 'Create Purchase Order',
    module: 'PURCHASE_ORDER_MANAGEMENT',
    description: 'Create new purchase orders',
    category: 'PURCHASE',
  },
  {
    code: 'PO_READ',
    name: 'View Purchase Orders',
    module: 'PURCHASE_ORDER_MANAGEMENT',
    description: 'View all purchase orders',
    category: 'PURCHASE',
  },
  {
    code: 'PO_UPDATE',
    name: 'Update Purchase Order',
    module: 'PURCHASE_ORDER_MANAGEMENT',
    description: 'Update purchase order details',
    category: 'PURCHASE',
  },
  {
    code: 'PO_DELETE',
    name: 'Delete Purchase Order',
    module: 'PURCHASE_ORDER_MANAGEMENT',
    description: 'Delete purchase orders',
    category: 'PURCHASE',
  },
  {
    code: 'PO_APPROVE',
    name: 'Approve Purchase Order',
    module: 'PURCHASE_ORDER_MANAGEMENT',
    description: 'Approve or reject purchase orders',
    category: 'PURCHASE',
  },
  {
    code: 'PO_ALL_ACCESS',
    name: 'PO All Access',
    module: 'PURCHASE_ORDER_MANAGEMENT',
    description: 'Full access to all purchase order operations',
    category: 'PURCHASE',
  },

  // Goods Receipt Management (GRN)
  {
    code: 'GRN_CREATE',
    name: 'Create Goods Receipt',
    module: 'INVENTORY_MANAGEMENT',
    description: 'Create goods receipt notes (GRN)',
    category: 'INVENTORY',
  },
  {
    code: 'GRN_READ',
    name: 'View Goods Receipt',
    module: 'INVENTORY_MANAGEMENT',
    description: 'View goods receipt notes (GRN)',
    category: 'INVENTORY',
  },
  {
    code: 'GRN_UPDATE',
    name: 'Update Goods Receipt',
    module: 'INVENTORY_MANAGEMENT',
    description: 'Update goods receipt notes (GRN)',
    category: 'INVENTORY',
  },
  {
    code: 'GRN_DELETE',
    name: 'Delete Goods Receipt',
    module: 'INVENTORY_MANAGEMENT',
    description: 'Delete goods receipt notes (GRN)',
    category: 'INVENTORY',
  },
];

async function seedPermissions() {
  try {
    console.log('Starting permission seeding...');
    console.log(`Checking database connection...`);

    // Test connection
    await prisma.$connect();
    console.log('Database connection successful');

    // Get existing permission codes
    console.log('Fetching existing permissions...');
    const existingPermissions = await prisma.permission.findMany({
      select: { code: true },
    });

    console.log(`Found ${existingPermissions.length} existing permissions`);

    const existingCodes = new Set(existingPermissions.map((p) => p.code));

    // Filter out permissions that already exist
    const newPermissions = permissions.filter(
      (permission) => !existingCodes.has(permission.code)
    );

    console.log(
      `${newPermissions.length} new permissions to add out of ${permissions.length} total`
    );

    if (newPermissions.length > 0) {
      console.log('Creating new permissions...');

      // Create in batches to avoid issues
      const batchSize = 10;
      for (let i = 0; i < newPermissions.length; i += batchSize) {
        const batch = newPermissions.slice(i, i + batchSize);
        console.log(
          `   Batch ${Math.floor(i / batchSize) + 1}: Creating ${batch.length} permissions`
        );

        await prisma.permission.createMany({
          data: batch,
          skipDuplicates: true,
        });
      }

      console.log(
        `${newPermissions.length} new permissions seeded successfully`
      );
      console.log(
        `New permissions added:`,
        newPermissions.map((p) => p.code)
      );
    } else {
      console.log('All permissions already exist. No new permissions to seed.');
    }

    // Log total count
    const totalCount = await prisma.permission.count();
    console.log(`Total permissions in database: ${totalCount}`);

    console.log(' Permission seeding completed successfully!');
  } catch (error) {
    console.error('Error seeding permissions:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    console.log('🔌 Disconnecting from database...');
    await prisma.$disconnect();
  }
}

// Add this at the end of the file to execute when run directly
if (process.argv[1] === import.meta.url.slice('file://'.length)) {
  seedPermissions().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

export default seedPermissions;
