// src/controllers/auth.controller.js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/database.js';
import {
  createOTP,
  verifyOTP,
  markOTPAsUsed,
} from '../services/otp.service.js';
import { sendEmailOTP, sendSMSOTP } from '../services/emailSms.service.js';

// Helper to check for secrets
const getSecret = (key) => {
  const value = process.env[key];
  if (!value) throw new Error(`Environment variable ${key} is missing`);
  return value;
};

// Generate JWT tokens
const generateTokens = (userId) => {
  const accessToken = jwt.sign({ userId }, getSecret('JWT_SECRET'), {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

  const refreshToken = jwt.sign({ userId }, getSecret('JWT_REFRESH_SECRET'), {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  });

  return { accessToken, refreshToken };
};

// Login (Supports Email OR Phone)
export const login = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    // Determine if identifier looks like an email or phone
    // We use a simple regex or just query both with OR
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { phone: identifier }],
      },
      include: {
        company: true,
        role: {
          include: {
            rolePermissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials', // Generic message for security
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact administrator.',
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user.id);

    // Save refresh token to user
    await prisma.user.update({
      where: { id: user.id },
      data: {
        refreshToken,
        lastLogin: new Date(),
      },
    });

    // Prepare permission codes list
    const permissions =
      user.role?.rolePermissions.map((rp) => rp.permission.code) || [];

    // Prepare user data for response (sanitize)
    const userResponse = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      userType: user.userType,
      designation: user.designation,
      profilePicture: user.profilePicture,
      department: user.department,
      profilePicture: user.profilePicture,
      employeeId: user.employeeId,
      employeeStatus: user.employeeStatus,
      defaultLocation: user.defaultLocation,
      salaryType: user.salaryType,
      isSystemAdmin: user.isSystemAdmin,
      lastLogin: user.lastLogin,
      company: user.company
        ? {
            id: user.company.id,
            name: user.company.name,
            logo: user.company.logo,
          }
        : null,
      role: user.role
        ? {
            id: user.role.id,
            name: user.role.name,
            permissions: permissions,
          }
        : null,
    };

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: userResponse,
        tokens: {
          accessToken,
          refreshToken,
        },
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Refresh Token
export const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, getSecret('JWT_REFRESH_SECRET'));

    // Find user with this refresh token
    const user = await prisma.user.findFirst({
      where: {
        id: decoded.userId,
        refreshToken,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token',
      });
    }

    // Generate new tokens
    const tokens = generateTokens(user.id);

    // Update refresh token in database
    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: tokens.refreshToken },
    });

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: tokens,
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid refresh token',
    });
  }
};

// Logout
export const logout = async (req, res) => {
  try {
    // Get userId from req.user - handle both userId and id properties
    const userId = req.user.userId || req.user.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User ID not found in request.',
      });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Current User Profile
export const getProfile = async (req, res) => {
  try {
    // Get userId from req.user - handle both userId and id properties
    const userId = req.user.userId || req.user.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User ID not found in request.',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        company: true,
        role: {
          include: {
            rolePermissions: {
              include: {
                permission: true,
              },
            },
          },
        },
        settings: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Sanitize Response
    const { password, refreshToken, resetPasswordToken, ...userResponse } =
      user;

    // Transform permissions for frontend ease
    if (userResponse.role && userResponse.role.rolePermissions) {
      userResponse.role.permissions = userResponse.role.rolePermissions.map(
        (rp) => rp.permission.code
      );
      delete userResponse.role.rolePermissions;
    }

    res.json({
      success: true,
      data: userResponse,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Change Password
export const changePassword = async (req, res) => {
  try {
    // Get userId from req.user - handle both userId and id properties
    const userId = req.user.userId || req.user.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User ID not found in request.',
      });
    }

    const { currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user)
      return res
        .status(404)
        .json({ success: false, message: 'User not found' });

    const isValidPassword = await bcrypt.compare(
      currentPassword,
      user.password
    );
    if (!isValidPassword) {
      return res
        .status(401)
        .json({ success: false, message: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        refreshToken: null,
      },
    });

    res.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Forgot Password
export const forgotPassword = async (req, res) => {
  try {
    const { identifier } = req.body;

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { phone: identifier }],
      },
    });

    // Always return success to prevent user enumeration
    if (!user) {
      return res.json({
        success: true,
        message: 'If an account exists, you will receive a reset link.',
      });
    }

    const resetToken = uuidv4();
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: resetToken,
        resetPasswordExpiry: resetTokenExpiry,
      },
    });

    // In a real app, send Email/SMS here
    console.log(
      `[DEV ONLY] Reset token for ${user.email || user.phone}: ${resetToken}`
    );

    res.json({
      success: true,
      message: 'If an account exists, you will receive a reset link.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Reset Password
export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    const user = await prisma.user.findFirst({
      where: {
        resetPasswordToken: token,
        resetPasswordExpiry: { gt: new Date() },
      },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token',
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpiry: null,
        refreshToken: null,
      },
    });

    res.json({
      success: true,
      message: 'Password reset successfully',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const checkAccountStatus = async (req, res) => {
  try {
    const { identifier } = req.body;

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { phone: identifier }],
      },
      select: {
        id: true,
        email: true,
        phone: true,
        isActive: true,
        userType: true,
        password: true,
        emailVerified: true,
        phoneVerified: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const response = {
      success: true,
      needsPassword: !user.password || user.password === '',
      needsVerification: !user.emailVerified || !user.phoneVerified,
      email: user.email,
      phone: user.phone,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      accountStatus: !user.password
        ? 'SETUP_REQUIRED'
        : user.isActive
          ? 'ACTIVE'
          : 'INACTIVE',
    };

    res.json(response);
  } catch (error) {
    console.error('Check account status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Login with OTP instead of password
export const loginWithOTP = async (req, res) => {
  try {
    const { identifier } = req.body;

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { phone: identifier }],
        isActive: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Send OTP for login
    const isEmail = identifier.includes('@');
    const otpType = 'LOGIN_OTP';

    // Create OTP
    const otpRecord = await createOTP(identifier, otpType, 5);

    // Send OTP
    if (isEmail) {
      await sendEmailOTP(identifier, otpRecord.otp);
    } else {
      await sendSMSOTP(identifier, otpRecord.otp);
    }

    res.json({
      success: true,
      message: `OTP sent to ${isEmail ? 'email' : 'phone'}`,
      identifier,
      expiresIn: '5 minutes',
    });
  } catch (error) {
    console.error('Login with OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP',
    });
  }
};

// Verify OTP and login
export const verifyOTPAndLogin = async (req, res) => {
  try {
    const { identifier, otp } = req.body;

    const verification = await verifyOTP(identifier, otp, 'LOGIN_OTP');

    if (!verification.success) {
      return res.status(400).json(verification);
    }

    // Mark OTP as used
    await markOTPAsUsed(verification.otpRecord.id);

    // Get user
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { phone: identifier }],
        isActive: true,
      },
      include: {
        company: true,
        role: {
          include: {
            rolePermissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user.id);

    // Update refresh token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        refreshToken,
        lastLogin: new Date(),
      },
    });

    // Prepare response
    const permissions =
      user.role?.rolePermissions.map((rp) => rp.permission.code) || [];

    const userResponse = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      userType: user.userType,
      designation: user.designation,
      department: user.department,
      profilePicture: user.profilePicture,
      employeeId: user.employeeId,
      employeeStatus: user.employeeStatus,
      defaultLocation: user.defaultLocation,
      salaryType: user.salaryType,
      isSystemAdmin: user.isSystemAdmin,
      lastLogin: user.lastLogin,
      company: user.company
        ? {
            id: user.company.id,
            name: user.company.name,
            logo: user.company.logo,
          }
        : null,
      role: user.role
        ? {
            id: user.role.id,
            name: user.role.name,
            permissions: permissions,
          }
        : null,
    };

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: userResponse,
        tokens: {
          accessToken,
          refreshToken,
        },
      },
    });
  } catch (error) {
    console.error('Verify OTP and login error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to login with OTP',
    });
  }
};
