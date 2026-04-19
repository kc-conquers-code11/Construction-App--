// src/validations/index.js
import { validate } from '../middleware/validation.middleware.js';

export * from './auth.validations.js';
export * from './client.validations.js';
export * from './company.validations.js';
export * from './project.validations.js';
export * from './task.validations.js';
export * from './user.validations.js';
export * from './dpr.validations.js';
export * from './superAdmin.validations.js';
export * from './material.validations.js';
export * from './subcontractor.validations.js';
export * from './attendance.validations.js';
export * from './worker.validations.js';
export * from './payroll.validations.js';
export * from './budget.validations.js';
export * from './purchaseOrder.validations.js';
export * from './supplier.validations.js';
export * from './transaction.validations.js';
export * from './dashboard.validations.js';

export { validate };
