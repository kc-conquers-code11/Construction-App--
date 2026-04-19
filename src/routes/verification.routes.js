// src/routes/verification.routes.js
import express from 'express';
import { validate } from '../validations/index.js';
import {
  requestOTP,
  verifyOTPCode,
  completeAccountSetup,
} from '../controllers/verification.controller.js';
import { testSMSOTP } from '../controllers/verification.controller.js';

const router = express.Router();

// Public routes
router.post('/request-otp', requestOTP);
router.post('/verify-otp', verifyOTPCode);
router.post('/complete-setup', completeAccountSetup);
router.post('/test-sms', testSMSOTP);

export default router;
