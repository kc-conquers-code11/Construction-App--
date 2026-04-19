// src/validations/project.validations.js
import { z } from 'zod';

// Create project validation
export const createProjectSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  name: z.string().min(2, 'Project name must be at least 2 characters'),
  description: z.string().optional(),
  location: z.string().min(3, 'Location is required'),
  latitude: z
    .union([z.string(), z.number()])
    .transform((val) => parseFloat(val)),
  longitude: z
    .union([z.string(), z.number()])
    .transform((val) => parseFloat(val)),
  geofenceRadius: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => (val ? parseFloat(val) : 200)),
  estimatedBudget: z
    .union([z.string(), z.number()])
    .transform((val) => parseFloat(val)),
  contractValue: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => (val ? parseFloat(val) : null)),
  advanceReceived: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => (val ? parseFloat(val) : 0)),
  clientId: z.string().optional(),
  startDate: z.string().min(1, 'Start date is required'),
  estimatedEndDate: z.string().min(1, 'Estimated end date is required'),
  priority: z
    .enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
    .optional()
    .default('MEDIUM'),
});

// Update project validation
export const updateProjectSchema = z.object({
  name: z
    .string()
    .min(2, 'Project name must be at least 2 characters')
    .optional(),
  description: z.string().optional(),
  location: z.string().min(3, 'Location is required').optional(),
  latitude: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => (val ? parseFloat(val) : undefined)),
  longitude: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => (val ? parseFloat(val) : undefined)),
  geofenceRadius: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => (val ? parseFloat(val) : undefined)),
  estimatedBudget: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => (val ? parseFloat(val) : undefined)),
  contractValue: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => (val ? parseFloat(val) : undefined)),
  advanceReceived: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => (val ? parseFloat(val) : undefined)),
  clientId: z.string().optional(),
  status: z
    .enum([
      'PLANNING',
      'ONGOING',
      'ON_HOLD',
      'COMPLETED',
      'CANCELLED',
      'DELAYED',
    ])
    .optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  progress: z.number().min(0).max(100).optional(),
  startDate: z.string().optional(),
  estimatedEndDate: z.string().optional(),
  actualEndDate: z.string().optional(),
});

// Team assignment validation
export const assignTeamSchema = z.object({
  assignments: z
    .array(
      z.object({
        userId: z.string().min(1, 'User ID is required'),
        roleId: z.string().optional(),
        designation: z.string().optional(),
        startDate: z.string().min(1, 'Start date is required'),
        endDate: z.string().optional(),
        isPrimary: z.boolean().optional().default(false),
      })
    )
    .min(1, 'At least one assignment is required'),
});

// Project settings validation
export const projectSettingsSchema = z.object({
  checkInStart: z
    .string()
    .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)')
    .optional(),
  checkInEnd: z
    .string()
    .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)')
    .optional(),
  checkOutStart: z
    .string()
    .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)')
    .optional(),
  checkOutEnd: z
    .string()
    .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)')
    .optional(),
  requireLocation: z.boolean().optional(),
  maxDistance: z.number().min(10).max(1000).optional(),
  notifyManagerOnDPR: z.boolean().optional(),
  notifyOnDelay: z.boolean().optional(),
  safetyRequirements: z.any().optional(),
  qualityStandards: z.any().optional(),
});
