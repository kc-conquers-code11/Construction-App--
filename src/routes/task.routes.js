// src/routes/task.routes.js
import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../validations/index.js'; // FIXED: Changed from '../validations/auth.validations.js'
import {
  createTaskSchema,
  updateTaskSchema,
  createSubtaskSchema,
  updateSubtaskSchema,
  createTaskCommentSchema,
} from '../validations/task.validations.js';
import {
  createTask,
  getAllTasks,
  getTaskById,
  updateTask,
  deleteTask,
  createSubtask,
  updateSubtask,
  deleteSubtask,
  createTaskComment,
  getTaskComments,
  deleteTaskComment,
  getUserTasks,
  bulkUpdateSubtasks,
} from '../controllers/task.controller.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Task CRUD operations
router.post('/', validate(createTaskSchema), createTask);
router.get('/', getAllTasks);
router.get('/user-tasks', getUserTasks);
router.get('/:id', getTaskById);
router.put('/:id', validate(updateTaskSchema), updateTask);
router.delete('/:id', deleteTask);

// Subtask operations
router.post('/subtasks', validate(createSubtaskSchema), createSubtask);
router.put('/subtasks/bulk', bulkUpdateSubtasks);
router.put('/subtasks/:id', validate(updateSubtaskSchema), updateSubtask);
router.delete('/subtasks/:id', deleteSubtask);

// Task comment operations
router.post('/comments', validate(createTaskCommentSchema), createTaskComment);
router.get('/:taskId/comments', getTaskComments);
router.delete('/comments/:id', deleteTaskComment);

export default router;
