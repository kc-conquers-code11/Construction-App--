// src/validations/superAdmin.validations.js
import { z } from 'zod';

/**
 * Super Admin Profile Update Validation
 * Used for PATCH /super-admin/profile
 */
export const updateSuperAdminProfileSchema = z
  .object({
    name: z
      .string()
      .min(2, 'Name must be at least 2 characters')
      .max(100, 'Name too long')
      .optional(),

    email: z.string().email('Invalid email format').optional(),

    phone: z
      .string()
      .regex(/^[6-9]\d{9}$/, 'Invalid Indian phone number')
      .optional(),

    designation: z.string().min(2, 'Designation too short').max(100).optional(),

    department: z.string().min(2, 'Department too short').max(100).optional(),

    address: z.string().max(255, 'Address too long').optional(),

    profilePicture: z
      .string()
      .url('Profile picture must be a valid URL')
      .optional(),

    defaultLocation: z.enum(['OFFICE', 'SITE', 'REMOTE']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required to update',
  });

export const dashboardQuerySchema = z
  .object({
    query: z
      .object({
        limit: z
          .union([
            z.string().regex(/^\d+$/, 'Limit must be a number'),
            z.number().int().positive(),
          ])
          .transform((val) => Number(val))
          .refine((val) => val >= 1 && val <= 50, {
            message: 'Limit must be between 1 and 50',
          })
          .optional()
          .default(10),

        days: z
          .union([
            z.string().regex(/^\d+$/, 'Days must be a number'),
            z.number().int().positive(),
          ])
          .transform((val) => Number(val))
          .refine((val) => val >= 1 && val <= 90, {
            message: 'Days must be between 1 and 90',
          })
          .optional()
          .default(30),

        type: z
          .enum([
            'all',
            'company_created',
            'company_suspended',
            'inactive_warning',
          ])
          .optional()
          .default('all'),
      })
      .optional()
      .default({}), // This makes the entire query object optional
  })
  .optional();

/**
 * Company Status Update Validation
 * Used for PATCH /super-admin/companies/:id/status
 */
export const updateCompanyStatusSchema = z.object({
  body: z.object({
    isActive: z.boolean({
      required_error: 'isActive field is required',
      invalid_type_error: 'isActive must be a boolean',
    }),
    reason: z
      .string()
      .min(5, 'Reason must be at least 5 characters')
      .max(500, 'Reason too long')
      .optional(),
  }),
});

/**
 * Company Admin Creation Validation
 * Used for POST /super-admin/companies/:companyId/admins
 */
export const createCompanyAdminSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .min(2, 'Name must be at least 2 characters')
        .max(100, 'Name too long'),

      email: z.string().email('Invalid email format').optional().nullable(),

      phone: z.string().regex(/^[6-9]\d{9}$/, 'Invalid Indian phone number'),

      permissions: z.array(z.string()).optional().default([]),
    })
    .refine((data) => data.email || data.phone, {
      message: 'Either email or phone is required',
      path: ['email', 'phone'],
    }),
});

/**
 * Company Admin Permissions Update Validation
 * Used for PATCH /super-admin/companies/:companyId/admins/:adminId/permissions
 */
export const updateAdminPermissionsSchema = z.object({
  body: z.object({
    permissions: z
      .array(z.string())
      .min(1, 'At least one permission is required'),
  }),
});

// src/validations/superAdmin.validations.js

/**
 * Company Filter Query Validation - FIXED
 * Used for GET /super-admin/companies
 */
export const companyFilterSchema = z
  .object({
    query: z
      .object({
        page: z
          .union([
            z.string().regex(/^\d+$/, 'Page must be a number'),
            z.number().int().positive(),
          ])
          .transform((val) => Number(val))
          .refine((val) => val >= 1, {
            message: 'Page must be at least 1',
          })
          .optional()
          .default(1),

        limit: z
          .union([
            z.string().regex(/^\d+$/, 'Limit must be a number'),
            z.number().int().positive(),
          ])
          .transform((val) => Number(val))
          .refine((val) => val >= 1 && val <= 100, {
            message: 'Limit must be between 1 and 100',
          })
          .optional()
          .default(10),

        search: z.string().max(100, 'Search term too long').optional(),

        status: z.enum(['active', 'inactive', 'all']).optional().default('all'),

        sortBy: z
          .enum(['name', 'createdAt', 'updatedAt'])
          .optional()
          .default('createdAt'),

        sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
      })
      .optional()
      .default({}), // This makes the entire query object optional
  })
  .optional(); // This makes the whole schema optional

/**
 * Admin Filter Query Validation
 * Used for GET /super-admin/companies/:companyId/admins
 */
export const adminFilterSchema = z.object({
  query: z.object({
    page: z
      .string()
      .regex(/^\d+$/, 'Page must be a number')
      .transform(Number)
      .refine((val) => val >= 1, {
        message: 'Page must be at least 1',
      })
      .optional()
      .default('1'),

    limit: z
      .string()
      .regex(/^\d+$/, 'Limit must be a number')
      .transform(Number)
      .refine((val) => val >= 1 && val <= 100, {
        message: 'Limit must be between 1 and 100',
      })
      .optional()
      .default('10'),

    status: z.enum(['active', 'inactive', 'all']).optional().default('active'),
  }),
});

/**
 * Date Range Validation
 * Used for various reports and exports
 */
export const dateRangeSchema = z.object({
  query: z
    .object({
      startDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)')
        .optional()
        .transform((val) => (val ? new Date(val) : undefined)),

      endDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)')
        .optional()
        .transform((val) => (val ? new Date(val) : undefined)),
    })
    .refine(
      (data) => {
        if (data.startDate && data.endDate) {
          return data.startDate <= data.endDate;
        }
        return true;
      },
      {
        message: 'End date must be after start date',
        path: ['endDate'],
      }
    ),
});
