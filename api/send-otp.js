// api/send-otp.js - Vercel Serverless Function
import nodemailer from 'nodemailer';

// Create transporter (cached for performance)
let transporter = null;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'sandbox.smtp.mailtrap.io',
      port: parseInt(process.env.SMTP_PORT || '2525'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
  }
  return transporter;
};

// Send OTP Email
export default async function handler(req, res) {
  // Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, otp, type = 'LOGIN' } = req.body;

  // Validate
  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and OTP required' });
  }

  try {
    const transporter = getTransporter();

    // Email template
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2c3e50; margin-bottom: 10px;">🏗️ Construction App</h1>
          <p style="color: #7f8c8d; font-size: 16px;">Your OTP for ${type === 'LOGIN' ? 'Login' : 'Verification'}</p>
        </div>
        
        <div style="background: #f8f9fa; border: 2px dashed #dee2e6; padding: 30px; border-radius: 10px; text-align: center; margin: 20px 0;">
          <h2 style="color: #2c3e50; margin: 0; font-size: 48px; letter-spacing: 5px;">${otp}</h2>
          <p style="color: #6c757d; margin-top: 10px;">Valid for 10 minutes</p>
        </div>
        
        <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0; color: #856404; font-size: 14px;">
            <strong>⚠️ Security Notice:</strong> Never share this OTP with anyone. We will never ask for your OTP.
          </p>
        </div>
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; text-align: center;">
          <p style="color: #6c757d; font-size: 12px; margin: 0;">
            This is an automated message. Please do not reply.<br>
            © ${new Date().getFullYear()} Construction App
          </p>
        </div>
      </div>
    `;

    // Send email
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'Construction App <noreply@constructionapp.com>',
      to: email,
      subject: `Your OTP Code - Construction App (${otp})`,
      html: htmlContent,
    });

    console.log('✅ OTP Email sent:', info.messageId);

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      messageId: info.messageId,
    });
  } catch (error) {
    console.error('❌ Email error:', error);

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
