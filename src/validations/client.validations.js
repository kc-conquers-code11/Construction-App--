// src/validations/client.validations.js
import { z } from 'zod';

// Create client validation
export const createClientSchema = z.object({
  companyName: z.string().min(2, 'Company name must be at least 2 characters'),
  contactPerson: z.string().min(2, 'Contact person name is required'),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  phone: z.string().min(10, 'Phone must be at least 10 digits'),
  gstNumber: z.string().optional(),
  address: z.string().optional(),
});

// Update client validation
export const updateClientSchema = z.object({
  companyName: z
    .string()
    .min(2, 'Company name must be at least 2 characters')
    .optional(),
  contactPerson: z
    .string()
    .min(2, 'Contact person name is required')
    .optional(),
  email: z.string().email('Invalid email address').optional(),
  phone: z.string().min(10, 'Phone must be at least 10 digits').optional(),
  gstNumber: z.string().optional(),
  address: z.string().optional(),
  isActive: z.boolean().optional(),
});

// Client status validation
export const clientStatusSchema = z.object({
  isActive: z.boolean(),
  reason: z.string().optional(),
});
