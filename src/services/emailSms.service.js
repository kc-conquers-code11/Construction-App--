import nodemailer from 'nodemailer';

// Generate OTP
export const generateOTP = (length = 6) => {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * 10)];
  }
  return otp;
};

// Create Gmail transporter
let gmailTransporter = null;

const getGmailTransporter = () => {
  if (!gmailTransporter && process.env.SMTP_USER && process.env.SMTP_PASS) {
    gmailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
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
  return gmailTransporter;
};

// Send Email OTP via Gmail
export const sendEmailOTP = async (email, otp) => {
  try {
    const transporter = getGmailTransporter();

    if (!transporter) {
      console.error('❌ Gmail transporter not configured');
      return {
        success: false,
        error: 'Email service not configured. Check SMTP settings.',
      };
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2c3e50; margin-bottom: 10px;">Neev Construction App</h1>
          <p style="color: #7f8c8d; font-size: 16px;">Your OTP for verification</p>
        </div>
        
        <div style="background: #f8f9fa; border: 2px dashed #dee2e6; padding: 30px; border-radius: 10px; text-align: center; margin: 20px 0;">
          <h2 style="color: #2c3e50; margin: 0; font-size: 36px; letter-spacing: 10px;">${otp}</h2>
          <p style="color: #6c757d; margin-top: 10px;">Valid for 10 minutes</p>
        </div>
        
        <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0; color: #856404; font-size: 14px;">
            <strong>⚠️ Security Notice:</strong> Never share this OTP with anyone. 
            Neev Construction will never ask for your OTP.
          </p>
        </div>
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; text-align: center;">
          <p style="color: #6c757d; font-size: 12px; margin: 0;">
            This is an automated message. Please do not reply.<br>
            © ${new Date().getFullYear()} Neev Construction App
          </p>
        </div>
      </div>
    `;

    const info = await transporter.sendMail({
      from:
        process.env.EMAIL_FROM ||
        '"Neev Construction" <neevconstructionapp@gmail.com>',
      to: email,
      subject: 'Your OTP Code - Neev Construction App',
      html,
    });

    console.log(`✅ Gmail OTP sent to: ${email}`);

    return {
      success: true,
      messageId: info.messageId,
      otp: otp,
    };
  } catch (error) {
    console.error('❌ Gmail sending error:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
};

/* ===================== FAST2SMS IMPLEMENTATION ===================== */
/*
// Send SMS OTP via Fast2SMS
export const sendSMSOTP = async (phone, otp) => {
  const apiKey = process.env.FAST2SMS_API_KEY;
  const senderId = process.env.FAST2SMS_SENDER_ID || 'FSTSMS';

  // Development mode - no API key
  if (!apiKey) {
    console.log('\n📱 SMS OTP (Development Mode):');
    console.log('============================');
    console.log(`To: ${phone}`);
    console.log(`OTP: ${otp}`);
    console.log(`Message: ${otp} is your OTP for Neev Construction App. Valid for 10 minutes.`);
    console.log('============================\n');

    await new Promise((resolve) => setTimeout(resolve, 1000));

    return {
      success: true,
      message: 'SMS would be sent in production',
      developmentMode: true,
      otp: otp,
    };
  }

  // Format phone number
  let formattedPhone = phone.replace(/\D/g, '');

  // Validate phone number
  if (!formattedPhone || formattedPhone.length < 10) {
    console.error('❌ Invalid phone number:', phone);
    return {
      success: false,
      error: 'Invalid phone number. Must be at least 10 digits.',
    };
  }

  // Make sure phone number is 10 digits (Fast2SMS expects Indian numbers without country code)
  if (formattedPhone.length > 10) {
    // Remove country code if present
    if (formattedPhone.startsWith('91') && formattedPhone.length === 12) {
      formattedPhone = formattedPhone.substring(2);
    } else if (formattedPhone.startsWith('+91') && formattedPhone.length === 13) {
      formattedPhone = formattedPhone.substring(3);
    }
  }

  if (formattedPhone.length !== 10) {
    console.error('❌ Phone number must be exactly 10 digits after formatting:', formattedPhone);
    return {
      success: false,
      error: 'Phone number must be exactly 10 digits.',
    };
  }

  // Fast2SMS API endpoint
  const url = 'https://www.fast2sms.com/dev/bulkV2';

  const message = `${otp} is your OTP for Neev Construction App. Valid for 10 minutes.`;

  const payload = {
    route: 'otp',
    variables_values: otp,
    numbers: formattedPhone,
    flash: 0,
  };

  console.log('\n📱 Sending SMS OTP via Fast2SMS:');
  console.log('==============================');
  console.log(`Phone: ${formattedPhone}`);
  console.log(`OTP: ${otp}`);
  console.log(`Sender ID: ${senderId}`);
  console.log(`Route: ${payload.route}`);
  console.log('==============================\n');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    console.log('📱 Fast2SMS Response:', JSON.stringify(data, null, 2));

    if (data.return === true) {
      console.log(`✅ SMS OTP sent successfully to ${phone}`);
      return {
        success: true,
        data,
        details: {
          messageId: data.request_id,
          message: 'SMS OTP sent successfully',
          numbers: data.contact_number,
        },
        otp: otp,
      };
    } else {
      console.error('❌ SMS failed:', data.message || 'Unknown error');
      return {
        success: false,
        error: data.message || 'Failed to send SMS',
        data: data,
        otp: otp,
      };
    }
  } catch (error) {
    console.error('❌ SMS sending error:', error.message);
    return {
      success: false,
      error: error.message,
      otp: otp,
    };
  }
};

// Send SMS Welcome Message via Fast2SMS
export const sendSMSWelcome = async (phone, companyName) => {
  const apiKey = process.env.FAST2SMS_API_KEY;
  const senderId = process.env.FAST2SMS_SENDER_ID || 'FSTSMS';

  if (!apiKey) {
    console.log(`📱 Welcome SMS (Dev Mode) to ${phone}: Welcome to ${companyName}!`);
    return { success: true, developmentMode: true };
  }

  // Format phone number
  let formattedPhone = phone.replace(/\D/g, '');
  
  // Format for Fast2SMS (10 digits)
  if (formattedPhone.length > 10) {
    if (formattedPhone.startsWith('91') && formattedPhone.length === 12) {
      formattedPhone = formattedPhone.substring(2);
    } else if (formattedPhone.startsWith('+91') && formattedPhone.length === 13) {
      formattedPhone = formattedPhone.substring(3);
    }
  }

  if (formattedPhone.length !== 10) {
    console.error('❌ Phone number must be 10 digits:', formattedPhone);
    return { success: false, error: 'Phone number must be exactly 10 digits.' };
  }

  // Welcome message
  const message = `Welcome to ${companyName}! Your Neev Construction account is ready. Open the app and login with your phone number to complete setup.`;

  const url = 'https://www.fast2sms.com/dev/bulkV2';
  
  const payload = {
    route: 'q',
    message: message,
    language: 'english',
    flash: 0,
    numbers: formattedPhone,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.return === true) {
      console.log(`✅ Welcome SMS sent to ${phone}`);
      return { success: true, data };
    } else {
      console.error('❌ Welcome SMS failed:', data.message);
      return { success: false, error: data.message };
    }
  } catch (error) {
    console.error('❌ Welcome SMS error:', error.message);
    return { success: false, error: error.message };
  }
};

// Send Custom SMS via Fast2SMS
export const sendCustomSMS = async (phone, message) => {
  const apiKey = process.env.FAST2SMS_API_KEY;
  const senderId = process.env.FAST2SMS_SENDER_ID || 'FSTSMS';

  if (!apiKey) {
    console.log(`📱 Custom SMS (Dev Mode) to ${phone}: ${message}`);
    return { success: false, error: 'API key not configured' };
  }

  // Format phone number
  let formattedPhone = phone.replace(/\D/g, '');
  
  // Format for Fast2SMS (10 digits)
  if (formattedPhone.length > 10) {
    if (formattedPhone.startsWith('91') && formattedPhone.length === 12) {
      formattedPhone = formattedPhone.substring(2);
    } else if (formattedPhone.startsWith('+91') && formattedPhone.length === 13) {
      formattedPhone = formattedPhone.substring(3);
    }
  }

  if (formattedPhone.length !== 10) {
    console.error('❌ Phone number must be 10 digits:', formattedPhone);
    return { success: false, error: 'Phone number must be exactly 10 digits.' };
  }

  const url = 'https://www.fast2sms.com/dev/bulkV2';
  
  const payload = {
    route: 'q',
    message: message,
    language: 'english',
    flash: 0,
    numbers: formattedPhone,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.return === true) {
      console.log(`✅ Custom SMS sent to ${phone}`);
      return { success: true, data };
    } else {
      console.error('❌ Custom SMS failed:', data.message);
      return { success: false, error: data.message };
    }
  } catch (error) {
    console.error('❌ Custom SMS error:', error.message);
    return { success: false, error: error.message };
  }
};
*/

/* ===================== 2FACTOR.IN IMPLEMENTATION ===================== */
// Send SMS OTP via 2Factor.in - CORRECTED VERSION
export const sendSMSOTP = async (phone, otp) => {
  const apiKey = process.env.TWO_FACTOR_API_KEY;
  const templateName = 'NeevConstructionOTP'; // Your approved template name

  // Development mode - no API key
  if (!apiKey) {
    console.log('\n📱 SMS OTP (Development Mode):');
    console.log('============================');
    console.log(`To: ${phone}`);
    console.log(`OTP: ${otp}`);
    console.log(
      `Message: ${otp} is your OTP for Neev Construction App. Valid for 10 minutes.`
    );
    console.log('============================\n');

    await new Promise((resolve) => setTimeout(resolve, 1000));

    return {
      success: true,
      message: 'SMS would be sent in production',
      developmentMode: true,
      otp: otp,
    };
  }

  // Format phone number
  let formattedPhone = phone.replace(/\D/g, '');

  // Validate phone number
  if (!formattedPhone || formattedPhone.length < 10) {
    console.error('❌ Invalid phone number:', phone);
    return {
      success: false,
      error: 'Invalid phone number. Must be at least 10 digits.',
    };
  }

  // Add country code for India (91) if not present
  if (formattedPhone.length === 10) {
    formattedPhone = '91' + formattedPhone;
  }

  // Make sure it starts with 91 (India code)
  if (!formattedPhone.startsWith('91')) {
    formattedPhone = '91' + formattedPhone;
  }

  // URL Format: https://2factor.in/API/V1/{APIKEY}/SMS/{Mobile}/{OTP}/{TemplateName}
  const url = `https://2factor.in/API/V1/${apiKey}/SMS/${formattedPhone}/${otp}/${templateName}`;

  console.log('\n📱 Sending SMS OTP via 2Factor.in:');
  console.log('==============================');
  console.log(`Phone: ${formattedPhone}`);
  console.log(`OTP: ${otp}`);
  console.log(`Template: ${templateName}`);
  console.log(`URL: ${url}`);
  console.log('==============================\n');

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    console.log('📱 2Factor.in Response:', JSON.stringify(data, null, 2));

    if (data.Status === 'Success') {
      console.log(`✅ SMS OTP sent successfully to ${phone}`);
      return {
        success: true,
        data,
        details: {
          sessionId: data.Details,
          message: 'SMS OTP sent successfully',
        },
        otp: otp,
      };
    } else {
      console.error('❌ SMS failed:', data.Details || 'Unknown error');
      return {
        success: false,
        error: data.Details || 'Failed to send SMS',
        data: data,
        otp: otp, // Return OTP for development purposes
      };
    }
  } catch (error) {
    console.error('❌ SMS sending error:', error.message);
    return {
      success: false,
      error: error.message,
      otp: otp,
    };
  }
};

// Send welcome email via Gmail - UPDATED FOR FLUTTER APP
export const sendWelcomeEmail = async (email, phone, companyName) => {
  try {
    const transporter = getGmailTransporter();

    if (!transporter) {
      console.error('❌ Gmail transporter not configured');
      return false;
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px;">
        <div style="text-align: center; margin-bottom: 40px;">
          <h1 style="color: #2c3e50; font-size: 36px; margin-bottom: 10px;">Welcome to Neev Construction!</h1>
          <p style="color: #7f8c8d; font-size: 18px;">Your account has been created successfully</p>
        </div>
        
        <div style="background: white; border: 1px solid #e0e0e0; border-radius: 10px; padding: 30px; margin-bottom: 30px;">
          <h2 style="color: #2c3e50; margin-top: 0; border-bottom: 2px solid #f8f9fa; padding-bottom: 10px;">Account Details</h2>
          
          <div style="margin: 25px 0;">
            <p style="margin: 12px 0; font-size: 16px;">
              <strong style="color: #495057; min-width: 120px; display: inline-block;">Company:</strong>
              <span style="color: #2c3e50;">${companyName}</span>
            </p>
            ${email
        ? `
            <p style="margin: 12px 0; font-size: 16px;">
              <strong style="color: #495057; min-width: 120px; display: inline-block;">Email:</strong>
              <span style="color: #2c3e50;">${email}</span>
            </p>`
        : ''
      }
            ${phone
        ? `
            <p style="margin: 12px 0; font-size: 16px;">
              <strong style="color: #495057; min-width: 120px; display: inline-block;">Phone:</strong>
              <span style="color: #2c3e50;">${phone}</span>
            </p>`
        : ''
      }
          </div>
          
          <div style="background: #f8f9fa; padding: 25px; border-radius: 8px; margin: 25px 0;">
            <h3 style="color: #2c3e50; margin-top: 0; margin-bottom: 15px;">📋 Setup Instructions:</h3>
            <ol style="margin: 0; padding-left: 20px; color: #495057;">
              <li style="margin-bottom: 10px;">Open the <strong>Neev Construction App</strong> on your mobile device</li>
              <li style="margin-bottom: 10px;">Click on <strong>"Login"</strong> button</li>
              <li style="margin-bottom: 10px;">Enter your <strong>${email ? 'email address' : 'phone number'}</strong></li>
              <li style="margin-bottom: 10px;">Check for OTP (sent via ${email ? 'email' : 'SMS'})</li>
              <li style="margin-bottom: 10px;">Enter the OTP to verify your identity</li>
              <li>Set your secure password to complete account setup</li>
            </ol>
          </div>
          
          <div style="background: #e8f5e9; border: 1px solid #c8e6c9; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; color: #2e7d32; font-size: 14px;">
              <strong>💡 Tip:</strong> Download the app from the official app store if you haven't already.
            </p>
          </div>
        </div>
        
        <div style="text-align: center; color: #6c757d; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
          <p style="margin: 0 0 10px 0;">
            Need help? Contact support at support@neevconstructionapp.com
          </p>
          <p style="margin: 0;">
            © ${new Date().getFullYear()} Neev Construction App. All rights reserved.
          </p>
        </div>
      </div>
    `;

    if (email) {
      const info = await transporter.sendMail({
        from:
          process.env.EMAIL_FROM ||
          '"Neev Construction" <neevconstructionapp@gmail.com>',
        to: email,
        subject: `Welcome to Neev Construction - ${companyName}`,
        html,
      });
      console.log(`✅ Welcome email sent to: ${email}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error('❌ Welcome email error:', error.message);
    return false;
  }
};

// Send SMS Welcome Message via 2Factor.in
export const sendSMSWelcome = async (phone, companyName) => {
  const apiKey = process.env.TWO_FACTOR_API_KEY;
  const senderId = 'NEECON';

  if (!apiKey) {
    console.log(
      `📱 Welcome SMS (Dev Mode) to ${phone}: Welcome to ${companyName}!`
    );
    return { success: true, developmentMode: true };
  }

  let formattedPhone = phone.replace(/\D/g, '');
  if (formattedPhone.length === 10) {
    formattedPhone = '91' + formattedPhone;
  }

  // Welcome message
  const message = `Welcome to ${companyName}! Your Neev Construction account is ready. Open the app and login with your phone number to complete setup.`;

  // Using Promotional SMS for welcome messages
  const url = `https://2factor.in/API/V1/${apiKey}/ADDON_SERVICES/SEND/PSMS?sender_id=${senderId}&to=${formattedPhone}&msg=${encodeURIComponent(message)}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.Status === 'Success') {
      console.log(`✅ Welcome SMS sent to ${phone}`);
      return { success: true, data };
    } else {
      console.error('❌ Welcome SMS failed:', data.Details);
      return { success: false, error: data.Details };
    }
  } catch (error) {
    console.error('❌ Welcome SMS error:', error.message);
    return { success: false, error: error.message };
  }
};

// Send Custom SMS via 2Factor.in
export const sendCustomSMS = async (phone, message) => {
  const apiKey = process.env.TWO_FACTOR_API_KEY;
  const senderId = process.env.TWO_FACTOR_SENDER_ID || 'NEECON';

  if (!apiKey) {
    console.log(`📱 Custom SMS (Dev Mode) to ${phone}: ${message}`);
    return { success: false, error: 'API key not configured' };
  }

  let formattedPhone = phone.replace(/\D/g, '');
  if (formattedPhone.length === 10) {
    formattedPhone = '91' + formattedPhone;
  }

  const encodedMessage = encodeURIComponent(message);
  // Using Promotional SMS for generic messages
  const url = `https://2factor.in/API/V1/${apiKey}/ADDON_SERVICES/SEND/PSMS?sender_id=${senderId}&to=${formattedPhone}&msg=${encodedMessage}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.Status === 'Success') {
      console.log(`✅ Custom SMS sent to ${phone}`);
      return { success: true, data };
    } else {
      console.error('❌ Custom SMS failed:', data.Details);
      return { success: false, error: data.Details };
    }
  } catch (error) {
    console.error('❌ Custom SMS error:', error.message);
    return { success: false, error: error.message };
  }
};

// Verify 2Factor.in OTP (Not needed if you're using your own OTP storage)
export const verify2FactorOTP = async (sessionId, otp) => {
  return { success: true, message: 'Verification handled by DB' };
};

// Configuration instructions for Fast2SMS
/*
To switch from 2Factor.in to Fast2SMS:
1. Uncomment the Fast2SMS functions above
2. Comment out the current 2Factor.in implementations
3. Update your .env file with:
   FAST2SMS_API_KEY=your_fast2sms_api_key_here
   FAST2SMS_SENDER_ID=FSTSMS (or your approved sender ID)
4. Remove or keep the 2Factor.in API keys as backup

Note: Fast2SMS requires phone numbers in 10-digit format (without country code)
*/

export default {
  sendEmailOTP,
  sendSMSOTP,
  sendWelcomeEmail,
  sendSMSWelcome,
  generateOTP,
  sendCustomSMS,
  verify2FactorOTP,
};