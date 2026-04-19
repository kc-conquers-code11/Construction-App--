// src/middleware/auth.middleware.js
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';

// JWT verification middleware
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    console.log('Authorization Header:', req.headers.authorization);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.',
      });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Invalid token format.',
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Decoded JWT:', decoded);

    // Find user
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        company: true,
        role: true,
      },
    });
    console.log('Authenticated User:', user);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found.',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated.',
      });
    }

    // Attach user to request - FIXED: Include userId explicitly
    req.user = {
      userId: user.id,
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      userType: user.userType,
      companyId: user.companyId,
      roleId: user.roleId,
      company: user.company,
      role: user.role,
    };

    console.log('Request User Object:', req.user);

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token has expired. Please login again.',
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.',
      });
    }

    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication failed.',
    });
  }
};

// Super Admin only middleware
export const requireSuperAdmin = async (req, res, next) => {
  if (req.user.userType !== 'SUPER_ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Super Admin privileges required.',
    });
  }
  next();
};

// Company Admin only middleware
export const requireCompanyAdmin = async (req, res, next) => {
  if (req.user.userType !== 'COMPANY_ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Company Admin privileges required.',
    });
  }
  next();
};

// Company context middleware (ensures user can only access their company data)
export const companyContext = async (req, res, next) => {
  console.log('User in companyContext middleware:', req.user);
  // Super Admin can access all companies
  if (req.user.userType === 'SUPER_ADMIN') {
    req.companyId = req.query.companyId || req.body.companyId;
    return next();
  }

  // Company Admin and Employees can only access their own company
  if (!req.user.companyId) {
    return res.status(403).json({
      success: false,
      message: 'No company assigned to user.',
    });
  }

  req.companyId = req.user.companyId;
  next();
};
