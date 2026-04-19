// src/services/otp.service.js
import prisma from '../config/database.js';
import { generateOTP as generateOTPUtil } from './emailSms.service.js';

// Create OTP record
export const createOTP = async (identifier, type, expiryMinutes = 10) => {
  try {
    // Delete any existing OTPs for this identifier
    await prisma.oTP.deleteMany({
      where: {
        identifier,
        type,
        isUsed: false,
        expiresAt: { lt: new Date() }, // Also delete expired ones
      },
    });

    const otp = generateOTPUtil();
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    return await prisma.oTP.create({
      data: {
        identifier,
        otp,
        type,
        expiresAt,
      },
    });
  } catch (error) {
    console.error('Error creating OTP:', error);
    throw error;
  }
};

// Verify OTP
export const verifyOTP = async (identifier, otp, type) => {
  try {
    const otpRecord = await prisma.oTP.findFirst({
      where: {
        identifier,
        otp,
        type,
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!otpRecord) {
      return { success: false, message: 'Invalid or expired OTP' };
    }

    if (otpRecord.attempts >= 3) {
      await prisma.oTP.delete({
        where: { id: otpRecord.id },
      });
      return {
        success: false,
        message: 'Too many attempts. Please request a new OTP',
      };
    }

    // Increment attempts
    await prisma.oTP.update({
      where: { id: otpRecord.id },
      data: { attempts: { increment: 1 } },
    });

    return { success: true, otpRecord };
  } catch (error) {
    console.error('Error verifying OTP:', error);
    return { success: false, message: 'Failed to verify OTP' };
  }
};

// Mark OTP as used
export const markOTPAsUsed = async (otpId) => {
  try {
    await prisma.oTP.update({
      where: { id: otpId },
      data: { isUsed: true },
    });
  } catch (error) {
    console.error('Error marking OTP as used:', error);
  }
};

// Resend OTP
export const resendOTP = async (identifier, type) => {
  try {
    // Delete existing unused OTPs
    await prisma.oTP.deleteMany({
      where: {
        identifier,
        type,
        isUsed: false,
        createdAt: {
          gt: new Date(Date.now() - 1 * 60 * 1000), // Last 1 minute
        },
      },
    });

    return await createOTP(identifier, type, 10);
  } catch (error) {
    console.error('Error resending OTP:', error);
    throw error;
  }
};
