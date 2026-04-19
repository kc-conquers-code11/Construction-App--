import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../validations/index.js';
import {
  createClientSchema,
  updateClientSchema,
  clientStatusSchema,
} from '../validations/client.validations.js';
import {
  createClient,
  getAllClients,
  getClientById,
  updateClient,
  deleteClient,
  toggleClientStatus,
  getClientStatistics,
  getClientProjects,
  getClientInvoices,
  getClientPayments,
} from '../controllers/client.controller.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Client CRUD operations
router.post('/', validate(createClientSchema), createClient);
router.get('/', getAllClients);
router.get('/:id', getClientById);
router.put('/:id', validate(updateClientSchema), updateClient);
router.delete('/:id', deleteClient);

// Client status management
router.patch('/:id/status', validate(clientStatusSchema), toggleClientStatus);

// Client statistics and details
router.get('/:id/statistics', getClientStatistics);
router.get('/:id/projects', getClientProjects);
router.get('/:id/invoices', getClientInvoices);
router.get('/:id/payments', getClientPayments);

export default router;
