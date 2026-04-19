// src/validations/company.validations.js
import { z } from 'zod';

// Create company validation
export const createCompanySchema = z.object({
  companyName: z.string().min(2, 'Company name must be at least 2 characters'),
  registrationNumber: z.string().optional(),
  gstNumber: z.string().optional(),
  officeAddress: z.string().min(5, 'Address must be at least 5 characters'),
  phone: z.string().min(10, 'Phone must be at least 10 digits'),
  email: z.string().email('Invalid email address'),
  website: z.string().url('Invalid website URL').optional().or(z.literal('')),

  adminName: z.string().min(2, 'Admin name must be at least 2 characters'),
  adminEmail: z.string().email('Invalid admin email address'),
  adminPhone: z.string().min(10, 'Admin phone must be at least 10 digits'),

  permissions: z.array(z.string()).optional().default([]),
});

// Update company validation
export const updateCompanySchema = z.object({
  name: z
    .string()
    .min(2, 'Company name must be at least 2 characters')
    .optional(),
  registrationNumber: z.string().optional(),
  gstNumber: z.string().optional(),
  officeAddress: z
    .string()
    .min(5, 'Address must be at least 5 characters')
    .optional(),
  phone: z.string().min(10, 'Phone must be at least 10 digits').optional(),
  email: z.string().email('Invalid email address').optional(),
  website: z.string().url('Invalid website URL').optional(),
  isActive: z.boolean().optional(),
});


// Add admin validation
export const addAdminSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  phone: z.string().min(10, 'Phone must be at least 10 digits'),
  permissions: z.array(z.string()).optional().default([]),
});

// Update permissions validation
export const updatePermissionsSchema = z.object({
  permissions: z
    .array(z.string())
    .min(1, 'At least one permission is required'),
});

// Toggle status validation
export const toggleStatusSchema = z.object({
  isActive: z.boolean(),
});
