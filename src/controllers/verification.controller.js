// src/controllers/verification.controller.js
import bcrypt from 'bcryptjs';
import prisma from '../config/database.js';
import {
  createOTP,
  verifyOTP,
  markOTPAsUsed,
} from '../services/otp.service.js';
import { sendEmailOTP, sendSMSOTP } from '../services/emailSms.service.js';

// Request OTP for email/phone verification
export const requestOTP = async (req, res) => {
  try {
    const { identifier } = req.body; // Can be email or phone

    // Check if user exists
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { phone: identifier }],
      },
      include: {
        company: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Determine if identifier is email or phone
    const isEmail = identifier.includes('@');
    const otpType = isEmail ? 'EMAIL_VERIFICATION' : 'PHONE_VERIFICATION';

    // Generate OTP
    const otpRecord = await createOTP(identifier, otpType, 10);

    // Send OTP
    let sendResult;
    if (isEmail) {
      sendResult = await sendEmailOTP(identifier, otpRecord.otp);
    } else {
      sendResult = await sendSMSOTP(identifier, otpRecord.otp);
    }

    if (!sendResult.success) {
      return res.status(500).json({
        success: false,
        message: `Failed to send OTP to ${isEmail ? 'email' : 'phone'}`,
        error: sendResult.error,
      });
    }

    res.json({
      success: true,
      message: `OTP sent to ${isEmail ? 'email' : 'phone'}`,
      identifier: isEmail ? user.email : user.phone,
      expiresIn: '10 minutes',
      // For development, include OTP in response
      ...(process.env.NODE_ENV === 'development' && { otp: otpRecord.otp }),
    });
  } catch (error) {
    console.error('Request OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Verify OTP
export const verifyOTPCode = async (req, res) => {
  try {
    const { identifier, otp, type = 'VERIFICATION' } = req.body;

    const verification = await verifyOTP(identifier, otp, type);

    if (!verification.success) {
      return res.status(400).json(verification);
    }

    // Mark OTP as used
    await markOTPAsUsed(verification.otpRecord.id);

    // Get user
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { phone: identifier }],
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Update user as verified
    const updateData = {};
    if (type === 'EMAIL_VERIFICATION') {
      updateData.emailVerified = true;
      updateData.emailVerifiedAt = new Date();
    } else if (type === 'PHONE_VERIFICATION') {
      updateData.phoneVerified = true;
      updateData.phoneVerifiedAt = new Date();
    }

    await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    });

    res.json({
      success: true,
      message: `${type === 'EMAIL_VERIFICATION' ? 'Email' : 'Phone'} verified successfully`,
      canSetPassword: true,
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP',
    });
  }
};

export const completeAccountSetup = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    // Find user
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { phone: identifier }],
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Check if email/phone is verified (user should have verified via OTP first)
    if (!user.emailVerified && user.email === identifier) {
      return res.status(400).json({
        success: false,
        message: 'Email must be verified before setting password',
      });
    }

    if (!user.phoneVerified && user.phone === identifier) {
      return res.status(400).json({
        success: false,
        message: 'Phone must be verified before setting password',
      });
    }

    // Check if user already has a password
    if (user.password && user.password !== '') {
      return res.status(400).json({
        success: false,
        message: 'Password already set. Please use login instead.',
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update user with password
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        isActive: true,
        accountSetupCompleted: true,
        accountSetupCompletedAt: new Date(),
      },
    });

    res.json({
      success: true,
      message: 'Account setup completed successfully. You can now login.',
    });
  } catch (error) {
    console.error('Complete account setup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete account setup',
    });
  }
};

// Test SMS OTP endpoint
export const testSMSOTP = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required',
      });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Send SMS OTP
    const result = await sendSMSOTP(phone, otp);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send SMS OTP',
        error: result.error,
        details: result.details,
      });
    }

    res.json({
      success: true,
      message: 'SMS OTP sent successfully',
      data: {
        phone,
        otp: result.otp, // Return OTP for testing
        details: result.details,
        developmentMode: result.developmentMode || false,
      },
    });
  } catch (error) {
    console.error('Test SMS OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
