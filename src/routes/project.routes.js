import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../validations/index.js';
import {
  createProjectSchema,
  updateProjectSchema,
  assignTeamSchema,
  projectSettingsSchema,
} from '../validations/project.validations.js';
import {
  createProject,
  getAllProjects,
  getProjectById,
  updateProject,
  deleteProject,
  assignTeamToProject,
  getProjectTeam,
  getProjectStatistics,
  createProjectSettings, // Add this import
  getProjectSettings, // Add this import
  updateProjectSettings,
} from '../controllers/project.controller.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Project CRUD operations
router.post('/', validate(createProjectSchema), createProject);
router.get('/', getAllProjects);
router.get('/:id', getProjectById);
router.put('/:id', validate(updateProjectSchema), updateProject);
router.delete('/:id', deleteProject);

// Project team management
router.post('/:id/team', validate(assignTeamSchema), assignTeamToProject);
router.get('/:id/team', getProjectTeam);

// Project statistics
router.get('/:id/statistics', getProjectStatistics);

// Project settings management
router.post(
  '/:id/settings',
  validate(projectSettingsSchema),
  createProjectSettings
); // POST - Create
router.get('/:id/settings', getProjectSettings); // GET - View
router.put(
  '/:id/settings',
  validate(projectSettingsSchema),
  updateProjectSettings
); // PUT - Update

export default router;
