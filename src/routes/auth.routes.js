// src/routes/auth.routes.js
import express from 'express';
import {
  authenticate,
  requireSuperAdmin,
} from '../middleware/auth.middleware.js';
import { validate } from '../validations/index.js';
import {
  loginSchema,
  refreshTokenSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../validations/auth.validations.js';
import {
  login,
  refreshToken,
  logout,
  getProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  checkAccountStatus,
  loginWithOTP,
  verifyOTPAndLogin,
} from '../controllers/auth.controller.js';

const router = express.Router();

// Public routes
router.post('/login', validate(loginSchema), login);
router.post('/check-status', checkAccountStatus);
router.post('/login-with-otp', loginWithOTP);
router.post('/verify-otp-login', verifyOTPAndLogin);
router.post('/refresh-token', validate(refreshTokenSchema), refreshToken);
router.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), resetPassword);

// Protected routes (require authentication)
router.use(authenticate);

router.post('/logout', logout);
router.get('/profile', getProfile);
router.post('/change-password', validate(changePasswordSchema), changePassword);

// Super Admin only routes
router.use('/super-admin', requireSuperAdmin);

export default router;
