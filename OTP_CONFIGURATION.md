# OTP Configuration Guide

## Overview
OTP (One-Time Password) system is now configured with intelligent fallback mechanisms.

## How it Works

### 1. **Email OTP (Primary)**
- Uses Gmail/SMTP
- Requires environment variables:
  - `SMTP_USER` - Gmail email
  - `SMTP_PASS` - Gmail app password
  - `SMTP_HOST` - Default: `smtp.gmail.com`
  - `SMTP_PORT` - Default: `587`

### 2. **SMS OTP (Fallback)**
- Two implementations available:
  - **Fast2SMS** - Requires `FAST2SMS_API_KEY`
  - **2Factor.in** - Requires `TWO_FACTOR_API_KEY`

### 3. **Development Mode**
- OTP is printed to console logs for testing
- Response includes OTP code when `NODE_ENV=development`

## Setup Instructions

### Gmail Configuration (Recommended)
```bash
# 1. Create Gmail App Password
# Go to: https://myaccount.google.com/apppasswords
# Select "Mail" and "Windows Computer"
# Copy the 16-character password

# 2. Add to .env
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_16_char_app_password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
EMAIL_FROM="Your App Name <your_email@gmail.com>"
```

### SMS API Setup (Optional)
```bash
# Choose one:
# Option 1: Fast2SMS
FAST2SMS_API_KEY=your_fast2sms_api_key

# Option 2: 2Factor.in
TWO_FACTOR_API_KEY=your_2factor_api_key
```

## OTP Endpoints

### Request OTP
```
POST /api/auth/login-otp
Body: { "identifier": "email@example.com" or "9876543210" }
```

**Response (Development):**
```json
{
  "success": true,
  "message": "OTP sent to email",
  "data": {
    "identifier": "email@example.com",
    "expiresIn": "5 minutes",
    "sentVia": "email"
  },
  "otp": "123456"  // Only in development!
}
```

### Verify OTP
```
POST /api/verify-otp
Body: { "identifier": "email@example.com", "otp": "123456", "type": "LOGIN_OTP" }
```

## Features

✅ **Intelligent Fallback**
- Primary: Email (always tried first if available)
- Secondary: SMS (tried if email fails)

✅ **Development Mode**
- OTP logged to console
- OTP included in response for easy testing

✅ **Error Handling**
- Validates phone numbers (10+ digits)
- Detects email vs phone automatically
- Includes error messages in development

✅ **Expiry Management**
- Email OTP: 5 minutes (configurable)
- SMS OTP: 10 minutes (configurable)
- Prevents duplicate OTPs

## Testing

### Local Development
```bash
# 1. Login endpoint will return OTP in response
curl -X POST http://localhost:3000/api/auth/login-otp \
  -H "Content-Type: application/json" \
  -d '{"identifier":"test@example.com"}'

# 2. Check console for OTP
# Console output: "OTP Code: 123456"

# 3. Use OTP to verify
curl -X POST http://localhost:3000/api/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"identifier":"test@example.com","otp":"123456","type":"LOGIN_OTP"}'
```

### Production
- Email OTP is sent silently
- SMS OTP as fallback if email fails
- No OTP in response (removed in production)

## Troubleshooting

### Email OTP Not Sending
1. Check `SMTP_USER` and `SMTP_PASS` are correct
2. Gmail account must have 2-step verification enabled
3. Use App Password (not regular Gmail password)
4. Check console logs for specific errors

### SMS OTP Not Sending
1. Verify API key is valid
2. Phone number must be 10+ digits
3. Template name must be approved (for 2Factor.in)
4. Check API quota limits

### OTP Expired
- User must request new OTP
- Previous OTP is automatically deleted
- Rate limited to prevent spam

## Security Notes

⚠️ **IMPORTANT**
- Never log OTP in production
- OTP is removed from response in production
- Database stores hashed attempts count
- Maximum 3 verification attempts per OTP
- OTP marked as "used" after successful verification

## Files Modified
- `src/controllers/auth.controller.js` - loginWithOTP endpoint
- `src/controllers/verification.controller.js` - requestOTP endpoint
- `src/services/otp.service.js` - OTP creation and verification
- `src/services/emailSms.service.js` - Email and SMS sending

