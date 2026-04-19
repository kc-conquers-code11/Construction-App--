// src/validations/auth.validations.js
import { z } from 'zod';

// Login validation schema
// Updated to accept EITHER phone OR email as "identifier"
export const loginSchema = z.object({
  identifier: z.string().min(3, 'Identifier (Email or Phone) is required'),
  password: z.string().min(1, 'Password is required'),
});

// Refresh token validation
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

// Change password validation
export const changePasswordSchema = z.object({
  currentPassword: z
    .string()
    .min(6, 'Current password must be at least 6 characters'),
  newPassword: z
    .string()
    .min(6, 'New password must be at least 6 characters')
    .max(100, 'Password too long'),
});

// Forgot password validation
export const forgotPasswordSchema = z.object({
  identifier: z.string().min(1, 'Email or Phone is required'),
});

// Reset password validation
export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  newPassword: z
    .string()
    .min(6, 'Password must be at least 6 characters')
    .max(100, 'Password too long'),
});

// Validation middleware
export const validate = (schema) => (req, res, next) => {
  try {
    // Parse body using Zod schema
    const result = schema.safeParse(req.body);

    if (!result.success) {
      // Format Zod errors into a readable structure
      const formattedErrors = result.error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      }));

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: formattedErrors,
      });
    }

    // Replace req.body with the validated (sanitized) data
    req.body = result.data;
    next();
  } catch (error) {
    console.error('Validation Middleware Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during validation',
    });
  }
};
