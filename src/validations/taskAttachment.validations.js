import { z } from 'zod';

// Upload attachment validation (for request body, file validation is handled by multer)
export const uploadAttachmentSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
});

// Get attachments validation (query parameters)
export const getAttachmentsSchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive().default(1)),
  limit: z
    .string()
    .optional()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive().max(100).default(20)),
});
