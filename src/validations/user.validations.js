// src/validations/user.validations.js
import { z } from 'zod';

// Create employee validation
export const createEmployeeSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  phone: z.string().min(10, 'Phone must be at least 10 digits'),
  employeeId: z.string().min(1, 'Employee ID is required'),
  designation: z.string().min(2, 'Designation is required'),
  department: z.string().min(2, 'Department is required'),
  salary: z.string().optional().or(z.number().optional()),
  salaryType: z
    .enum(['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'PROJECT_BASED'])
    .optional(),
  roleId: z.string().min(1, 'Role ID is required'),
  employeeStatus: z
    .enum([
      'ACTIVE',
      'INACTIVE',
      'SUSPENDED',
      'RETIRED',
      'INJURED',
      'TERMINATED',
      'ON_PROBATION',
    ])
    .optional(),
  defaultLocation: z.enum(['OFFICE', 'SITE', 'REMOTE']).optional(),
  dateOfJoining: z.string().optional(),
  address: z.string().optional(),
  emergencyContact: z.string().optional(),
  emergencyPhone: z.string().optional(),
  aadharNumber: z.string().optional(),
  panNumber: z.string().optional(),
  bankAccount: z.string().optional(),
  ifscCode: z.string().optional(),
});

// Update employee validation
export const updateEmployeeSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  email: z.string().email('Invalid email address').optional(),
  phone: z.string().min(10, 'Phone must be at least 10 digits').optional(),
  designation: z.string().min(2, 'Designation is required').optional(),
  department: z.string().min(2, 'Department is required').optional(),
  salary: z.string().optional().or(z.number().optional()),
  salaryType: z
    .enum(['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'PROJECT_BASED'])
    .optional(),
  employeeStatus: z
    .enum([
      'ACTIVE',
      'INACTIVE',
      'SUSPENDED',
      'RETIRED',
      'INJURED',
      'TERMINATED',
      'ON_PROBATION',
    ])
    .optional(),
  defaultLocation: z.enum(['OFFICE', 'SITE', 'REMOTE']).optional(),
  dateOfJoining: z.string().optional(),
  address: z.string().optional(),
  emergencyContact: z.string().optional(),
  emergencyPhone: z.string().optional(),
  aadharNumber: z.string().optional(),
  panNumber: z.string().optional(),
  bankAccount: z.string().optional(),
  ifscCode: z.string().optional(),
  isActive: z.boolean().optional(),
});

// Role validation
export const createRoleSchema = z.object({
  name: z.string().min(2, 'Role name must be at least 2 characters'),
  description: z.string().optional(),
  permissions: z.array(z.string()).optional().default([]),
});

// Update role validation
export const updateRoleSchema = z.object({
  name: z.string().min(2, 'Role name must be at least 2 characters').optional(),
  description: z.string().optional(),
});

// Update permissions validation
export const updatePermissionsSchema = z.object({
  permissions: z
    .array(z.string())
    .min(1, 'At least one permission is required'),
});

// Status validation
export const statusSchema = z.object({
  isActive: z.boolean(),
  reason: z.string().optional(),
});

// Role assignment validation
export const roleAssignmentSchema = z.object({
  roleId: z.string().min(1, 'Role ID is required'),
});

// Password reset validation
export const passwordResetSchema = z.object({
  forceReset: z.boolean().optional().default(true),
});

// Welcome email validation
export const welcomeEmailSchema = z.object({
  sendEmail: z.boolean().optional().default(true),
  sendSMS: z.boolean().optional().default(true),
});
