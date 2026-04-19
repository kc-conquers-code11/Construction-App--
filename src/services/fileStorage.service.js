import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== MULTER CONFIGURATION ====================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');

    // Create uploads directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const fileExt = path.extname(file.originalname);
    const fileName = file.fieldname + '-' + uniqueSuffix + fileExt;
    cb(null, fileName);
  },
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'application/zip',
    'application/x-rar-compressed',
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type'), false);
  }
};

// Multer upload instance
export const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// ==================== LOCAL STORAGE FUNCTIONS ====================
export const uploadLocal = async (file, folder = 'general') => {
  try {
    const uploadDir = path.join(__dirname, `../../uploads/${folder}`);

    // Create folder if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Generate unique filename
    const uniqueSuffix =
      Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    const fileExt = path.extname(file.originalname);
    const fileName = `${folder}-${uniqueSuffix}${fileExt}`;
    const filePath = path.join(uploadDir, fileName);

    // Move file to destination
    await fs.promises.copyFile(file.path, filePath);
    await fs.promises.unlink(file.path);

    // Return URL (adjust based on your server configuration)
    const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
    const fileUrl = `${baseUrl}/uploads/${folder}/${fileName}`;

    return {
      success: true,
      url: fileUrl,
      fileName: file.originalname,
      storedName: fileName,
      filePath: filePath,
      size: file.size,
      mimetype: file.mimetype,
    };
  } catch (error) {
    console.error('Local upload error:', error);
    throw new Error('Failed to upload file locally');
  }
};

export const deleteLocal = async (fileUrl) => {
  try {
    // Extract filename from URL
    const urlParts = fileUrl.split('/');
    const fileName = urlParts[urlParts.length - 1];
    const folder = urlParts[urlParts.length - 2];

    const filePath = path.join(
      __dirname,
      `../../uploads/${folder}/${fileName}`
    );

    // Check if file exists
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      return {
        success: true,
        message: 'File deleted successfully',
        filePath: filePath,
      };
    } else {
      return {
        success: false,
        message: 'File not found',
      };
    }
  } catch (error) {
    console.error('Local delete error:', error);
    throw new Error('Failed to delete file locally');
  }
};

// ==================== CLOUDFLARE R2 FUNCTIONS ====================
let s3Client = null;

const getS3Client = () => {
  if (!s3Client) {
    s3Client = new S3Client({
      region: 'auto', // Cloudflare R2 uses 'auto' region
      endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
      },
      // Additional configuration for Cloudflare R2
      forcePathStyle: false,
    });
  }
  return s3Client;
};

export const uploadToCloudflare = async (file, folder = 'general') => {
  try {
    const s3 = getS3Client();
    const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;

    // Generate unique filename
    const uniqueSuffix =
      Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    const fileExt = path.extname(file.originalname);
    const fileName = `${folder}/${uniqueSuffix}${fileExt}`;

    // Read file content
    const fileContent = await fs.promises.readFile(file.path);

    // Upload to Cloudflare R2
    const uploadParams = {
      Bucket: bucketName,
      Key: fileName,
      Body: fileContent,
      ContentType: file.mimetype,
      // Note: Cloudflare R2 doesn't support ACLs like S3
      // Use bucket policies for public access instead
    };

    await s3.send(new PutObjectCommand(uploadParams));

    // Clean up local temp file
    await fs.promises.unlink(file.path);

    // Construct public URL
    const publicUrl = `https://${process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN}/${fileName}`;

    return {
      success: true,
      url: publicUrl,
      fileName: file.originalname,
      storedName: fileName,
      bucket: bucketName,
      size: file.size,
      mimetype: file.mimetype,
    };
  } catch (error) {
    console.error('Cloudflare upload error:', error);

    // Clean up local temp file on error
    try {
      await fs.promises.unlink(file.path);
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError);
    }

    throw new Error('Failed to upload file to Cloudflare R2: ' + error.message);
  }
};

export const deleteFromCloudflare = async (fileUrl) => {
  try {
    const s3 = getS3Client();
    const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;

    // Extract key from URL
    const urlParts = fileUrl.split('/');
    const fileName = urlParts.slice(3).join('/'); // Remove domain parts

    const deleteParams = {
      Bucket: bucketName,
      Key: fileName,
    };

    await s3.send(new DeleteObjectCommand(deleteParams));

    return {
      success: true,
      message: 'File deleted from Cloudflare R2 successfully',
      fileName: fileName,
    };
  } catch (error) {
    console.error('Cloudflare delete error:', error);
    throw new Error(
      'Failed to delete file from Cloudflare R2: ' + error.message
    );
  }
};

// ==================== HELPER FUNCTIONS ====================
export const getFileExtension = (filename) => {
  return path.extname(filename).toLowerCase();
};

export const getFileCategory = (mimetype) => {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype === 'application/pdf') return 'pdf';
  if (mimetype.includes('word')) return 'document';
  if (mimetype.includes('excel')) return 'spreadsheet';
  if (mimetype.includes('powerpoint')) return 'presentation';
  if (mimetype === 'text/plain') return 'text';
  if (
    mimetype === 'application/zip' ||
    mimetype === 'application/x-rar-compressed'
  )
    return 'archive';
  return 'other';
};

export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const uploadDPRPhotoToCloudflare = async (file, dprId) => {
  try {
    const s3 = getS3Client();
    const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;

    // Generate unique filename for DPR photo
    const uniqueSuffix =
      Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    const fileExt = path.extname(file.originalname).toLowerCase();

    // Validate image format
    const allowedExtensions = [
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.webp',
      '.bmp',
      '.tiff',
    ];
    if (!allowedExtensions.includes(fileExt)) {
      throw new Error(
        'Invalid image format. Allowed: JPG, PNG, GIF, WebP, BMP, TIFF'
      );
    }

    const fileName = `dpr-photos/${dprId}/${uniqueSuffix}${fileExt}`;

    // Read file content
    const fileContent = await fs.promises.readFile(file.path);

    // Upload to Cloudflare R2
    const uploadParams = {
      Bucket: bucketName,
      Key: fileName,
      Body: fileContent,
      ContentType: file.mimetype,
      Metadata: {
        'dpr-id': dprId,
        'original-filename': file.originalname,
        'uploaded-at': new Date().toISOString(),
      },
    };

    await s3.send(new PutObjectCommand(uploadParams));

    // Clean up local temp file
    await fs.promises.unlink(file.path);

    // Construct public URL
    const publicUrl = `https://${process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN}/${fileName}`;

    // Optional: Generate thumbnail URL (you would need to implement thumbnail generation)
    // For now, we'll use the same URL for thumbnail
    const thumbnailUrl = publicUrl;

    return {
      success: true,
      url: publicUrl,
      thumbnailUrl: thumbnailUrl,
      fileName: file.originalname,
      storedName: fileName,
      bucket: bucketName,
      size: file.size,
      mimetype: file.mimetype,
      dprId: dprId,
    };
  } catch (error) {
    console.error('Cloudflare DPR photo upload error:', error);

    // Clean up local temp file on error
    try {
      await fs.promises.unlink(file.path);
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError);
    }

    throw new Error(
      'Failed to upload DPR photo to Cloudflare R2: ' + error.message
    );
  }
};

export const deleteDPRPhotoFromCloudflare = async (fileUrl) => {
  try {
    const s3 = getS3Client();
    const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;

    // Extract key from URL
    const urlParts = fileUrl.split('/');
    const fileName = urlParts.slice(3).join('/'); // Remove domain parts

    const deleteParams = {
      Bucket: bucketName,
      Key: fileName,
    };

    await s3.send(new DeleteObjectCommand(deleteParams));

    // Also try to delete thumbnail if it exists (assuming thumbnail has -thumb suffix)
    const thumbnailKey = fileName.replace(/(\.[^/.]+)$/, '-thumb$1');
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: thumbnailKey,
        })
      );
    } catch (thumbError) {
      // Ignore if thumbnail doesn't exist
      console.log(
        'Thumbnail not found or already deleted:',
        thumbError.message
      );
    }

    return {
      success: true,
      message: 'DPR photo deleted from Cloudflare R2 successfully',
      fileName: fileName,
    };
  } catch (error) {
    console.error('Cloudflare DPR photo delete error:', error);
    throw new Error(
      'Failed to delete DPR photo from Cloudflare R2: ' + error.message
    );
  }
};

// Helper function to generate Cloudflare R2 signed URL (for private files)
export const generateSignedUrl = async (fileKey, expiresIn = 3600) => {
  try {
    const s3 = getS3Client();
    const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;

    // Note: Cloudflare R2 doesn't support S3's presigned URLs in the same way
    // For public files, use the public URL
    // For private files, you need to set up Cloudflare R2's custom domain with authentication
    const publicUrl = `https://${process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN}/${fileKey}`;

    return publicUrl;
  } catch (error) {
    console.error('Generate signed URL error:', error);
    throw new Error('Failed to generate signed URL');
  }
};

// Upload attendance image locally
export const uploadAttendanceImageLocal = async (
  file,
  userId,
  date,
  type = 'checkin'
) => {
  try {
    const folder = 'attendance-images';
    const uploadDir = path.join(__dirname, `../../uploads/${folder}`);

    // Create folder if it doesn't exist
    const fs = await import('fs');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Generate unique filename
    const dateStr = new Date(date).toISOString().split('T')[0];
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const fileExt = path.extname(file.originalname).toLowerCase();

    // Validate image format
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    if (!allowedExtensions.includes(fileExt)) {
      throw new Error('Invalid image format. Allowed: JPG, JPEG, PNG, WebP');
    }

    const fileName = `${userId}_${dateStr}_${type}_${uniqueSuffix}${fileExt}`;
    const filePath = path.join(uploadDir, fileName);

    // Move file to destination
    await fs.promises.rename(file.path, filePath);

    // Return URL
    const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
    const fileUrl = `${baseUrl}/uploads/${folder}/${fileName}`;

    return {
      success: true,
      url: fileUrl,
      fileName: file.originalname,
      storedName: fileName,
      filePath: filePath,
      size: file.size,
      mimetype: file.mimetype,
    };
  } catch (error) {
    console.error('Attendance image upload error:', error);
    throw new Error('Failed to upload attendance image');
  }
};

// Delete attendance image locally
export const deleteAttendanceImageLocal = async (fileUrl) => {
  try {
    // Extract filename from URL
    const urlParts = fileUrl.split('/');
    const fileName = urlParts[urlParts.length - 1];
    const folder = urlParts[urlParts.length - 2];

    const filePath = path.join(
      __dirname,
      `../../uploads/${folder}/${fileName}`
    );

    // Check if file exists
    const fs = await import('fs');
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      return {
        success: true,
        message: 'Attendance image deleted successfully',
        filePath: filePath,
      };
    } else {
      return {
        success: false,
        message: 'Attendance image not found',
      };
    }
  } catch (error) {
    console.error('Attendance image delete error:', error);
    throw new Error('Failed to delete attendance image');
  }
};
