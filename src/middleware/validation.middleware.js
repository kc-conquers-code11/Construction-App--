// src/middleware/validation.middleware.js
import { z } from 'zod';

// export const  validate = (schema) => (req, res, next) => {
//   try {
//     // Direct validation without nested structure
//     const result = schema.safeParse(req.body);
//     console.log('Validation result:', result);

//     if (!result.success) {
//       const formattedErrors = result.error.issues.map((issue) => ({
//         field: issue.path.join('.'),
//         message: issue.message,
//       }));

//       return res.status(400).json({
//         success: false,
//         message: 'Validation failed',
//         errors: formattedErrors,
//       });
//     }

//     // Replace req.body with validated data
//     req.body = result.data;
//     next();
//   } catch (error) {
//     console.error('Validation Middleware Error:', error);
//     return res.status(500).json({
//       success: false,
//       message: 'Internal server error during validation',
//     });
//   }
// };

export const validate =
  (schema, property = 'body') =>
  (req, res, next) => {
    try {
      const dataToValidate = req[property];

      const result = schema.safeParse(dataToValidate);
      console.log('Validation result:', result);

      if (!result.success) {
        const formattedErrors = result.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        }));

        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: formattedErrors,
        });
      }

      // Safely replace validated data (Handles req.query getter restrictions)
      Object.defineProperty(req, property, {
        value: result.data,
        writable: true,
        enumerable: true,
        configurable: true,
      });

      next();
    } catch (error) {
      console.error('Validation Middleware Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error during validation',
      });
    }
  };
