// src/validations/task.validations.js
import { z } from 'zod';

// Create task validation
export const createTaskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  projectId: z.string().min(1, 'Project ID is required'),
  assignedToId: z.string().min(1, 'Assignee is required'),
  status: z
    .enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'BLOCKED'])
    .optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  progress: z.number().min(0).max(100).optional(),
  startDate: z.string().optional(),
  dueDate: z.string().optional(),
  estimatedHours: z.number().positive().optional(),
});

// Update task validation
export const updateTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').optional(),
  description: z.string().optional(),
  assignedToId: z.string().min(1, 'Assignee is required').optional(),
  status: z
    .enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'BLOCKED'])
    .optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  progress: z.number().min(0).max(100).optional(),
  startDate: z.string().optional(),
  dueDate: z.string().optional(),
  estimatedHours: z.number().positive().optional(),
  actualHours: z.number().positive().optional(),
  completedDate: z.string().optional(),
});

// Create subtask validation
export const createSubtaskSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  taskId: z.string().min(1, 'Task ID is required'),
});

// Update subtask validation
export const updateSubtaskSchema = z.object({
  description: z.string().min(1, 'Description is required').optional(),
  isCompleted: z.boolean().optional(),
});

// Create task comment validation
export const createTaskCommentSchema = z.object({
  content: z.string().min(1, 'Comment content is required'),
  taskId: z.string().min(1, 'Task ID is required'),
});
