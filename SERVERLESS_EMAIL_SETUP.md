# 🚀 Serverless Email Setup Guide

This guide explains how the OTP email system works using serverless functions on Render/Vercel.

## Overview

The application now uses a **serverless email function** for sending OTPs instead of direct SMTP connections. This approach provides:

✅ **No Timeout Issues** - Email delivery doesn't block the main request
✅ **Faster Responses** - OTP endpoints return immediately  
✅ **Better Scalability** - Email sending runs independently
✅ **Error Isolation** - Email failures don't crash the main app
✅ **Works on Render Free Tier** - No connection limits on serverless

## Architecture

```
Frontend
   ↓
┌─────────────────────────┐
│  POST /auth/login-otp   │
│  (2-3 seconds)          │
└──────────┬──────────────┘
           ↓ (immediate response)
       Response with debug OTP
       
       Meanwhile (async):
┌──────────────────────────────┐
│  POST /api/send-otp          │
│  (Serverless Function)       │
│  - Creates transporter       │
│  - Sends email               │
│  - Returns messageId         │
└──────────────────────────────┘
           ↓
       ✅ Email arrives in inbox
```

## Files Involved

### Backend Serverless Function
- **Location**: `api/send-otp.js`
- **Purpose**: Independent Node.js serverless endpoint for email delivery
- **Triggered**: Called from `emailSms.service.js` via HTTP POST
- **Runtime**: 30-60 seconds max (serverless platform timeout)

### Email Service
- **Location**: `src/services/emailSms.service.js`
- **Function**: `sendOTPViaServerless(email, otp, type)`
- **Purpose**: Makes HTTP request to `/api/send-otp` endpoint
- **Fallback**: Uses `sendEmailOTP()` if serverless fails

### Controllers Updated
- **auth.controller.js** - `loginWithOTP()` - Now uses serverless
- **verification.controller.js** - `requestOTP()` - Now uses serverless

## Configuration

### Environment Variables

Add these to your `.env` file:

```env
# Serverless Email Function URL
SERVERLESS_EMAIL_API=http://localhost:3000/api/send-otp

# SMTP Credentials (for the serverless function)
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=your_mailtrap_user
SMTP_PASS=your_mailtrap_pass
EMAIL_FROM="App Name <email@example.com>"
```

### Development Setup

```bash
# 1. Install dependencies
npm install

# 2. Create .env file with SMTP credentials

# 3. Start dev server
npm run dev

# 4. The serverless function runs on http://localhost:3000/api/send-otp
```

### Production Setup (Render)

**1. Add Environment Variables in Render Dashboard:**

```
DATABASE_URL=postgresql://...
JWT_SECRET=your_secret
JWT_REFRESH_SECRET=your_secret
NODE_ENV=production
PORT=10000
SMTP_HOST=smtp.gmail.com  (or your SMTP provider)
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password  (from Google Account)
EMAIL_FROM="App Name <your_email@gmail.com>"
SERVERLESS_EMAIL_API=https://your-render-url/api/send-otp
```

**2. Build Command:**
```bash
npm install && npm run prisma:generate && npm run prisma:db:push
```

**3. Start Command:**
```bash
npm start
```

## How It Works

### Step 1: User Requests OTP
```bash
POST /auth/login-otp
Content-Type: application/json

{
  "identifier": "user@example.com"
}
```

### Step 2: Backend Creates OTP
- Generates 6-digit OTP code
- Stores in database with 5-minute expiry
- Returns immediately to frontend with debug OTP (development mode)

### Step 3: Backend Calls Serverless Function (Async)
```javascript
// From emailSms.service.js
const response = await fetch(apiUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    email: 'user@example.com',
    otp: '123456',
    type: 'LOGIN_OTP'
  })
});
```

### Step 4: Serverless Function Sends Email
- Receives email request
- Creates nodemailer transporter with SMTP creds
- Sends HTML-formatted email with OTP
- Returns messageId on success

### Step 5: Email Arrives in User's Inbox
- From: `"App Name" <noreply@app.com>`
- Subject: `Your OTP Code - App Name`
- Contains: 6-digit OTP in large text, validity period, security warning

## Response Format

### Success Response
```json
{
  "success": true,
  "message": "OTP sent to email",
  "data": {
    "identifier": "user@example.com",
    "expiresIn": "5 minutes",
    "sentVia": "email"
  },
  "debug": {
    "otp": "123456",
    "note": "Development mode only",
    "showInPopup": true
  }
}
```

### Error Response
```json
{
  "success": false,
  "message": "Failed to send OTP",
  "error": "SMTP connection refused"
}
```

## Troubleshooting

### Email Not Arriving

**1. Check Development Console:**
```
✅ OTP sent via serverless email to user@example.com
```

**2. Verify SMTP Credentials:**
```bash
# Test SMTP connection
curl -X POST http://localhost:3000/api/send-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "otp": "123456",
    "type": "LOGIN_OTP"
  }'
```

**3. Check Mailtrap/Gmail:**
- Mailtrap: Go to Inbox tab at https://mailtrap.io
- Gmail: Check spam folder, may need to allow less secure apps

### Serverless Function Not Found

**Error**: `Cannot POST /api/send-otp`

**Solution**: 
- Ensure `api/send-otp.js` exists in project root
- Restart dev server (`npm run dev`)
- Check `SERVERLESS_EMAIL_API` URL in `.env`

### Timeout Issues

**Error**: `Request timeout after 30s`

**Solution**:
- This is normal - serverless functions have timeout limits
- The email usually sends even if response times out
- Add retry logic in frontend for better UX

## SMTP Providers

### Mailtrap (Development) ✅
- **Host**: `sandbox.smtp.mailtrap.io`
- **Port**: `2525` or `587`
- **Free Tier**: 500 emails/month
- **Setup**: https://mailtrap.io/register

### Gmail (Production)
- **Host**: `smtp.gmail.com`
- **Port**: `587`
- **Setup**: https://support.google.com/accounts/answer/185833
- **App Password**: https://myaccount.google.com/apppasswords

### SendGrid (Production)
- **Host**: `smtp.sendgrid.net`
- **Port**: `587`
- **API Key**: From dashboard
- **Setup**: https://sendgrid.com

## Testing Locally

```bash
# 1. Start dev server
npm run dev

# 2. In another terminal, test the endpoint
curl -X POST http://localhost:3000/api/send-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@gmail.com",
    "otp": "654321",
    "type": "LOGIN_OTP"
  }'

# 3. Expected response
# {
#   "success": true,
#   "messageId": "<message@id>",
#   "note": "Email sent successfully"
# }

# 4. Check email inbox (Mailtrap or Gmail)
```

## Production Checklist

- [ ] Add SMTP credentials to Render environment variables
- [ ] Set `NODE_ENV=production` in Render
- [ ] Set `SERVERLESS_EMAIL_API` to your Render domain: `https://your-app.onrender.com/api/send-otp`
- [ ] Test OTP flow end-to-end
- [ ] Check email arrives from correct sender
- [ ] Verify OTP code is readable
- [ ] Test OTP expiry (5 minutes)
- [ ] Test max 3 verification attempts
- [ ] Remove debug OTP from production response (already done - only in development mode)

## Security Notes

⚠️ **Development Mode Only**:
- Debug OTP is included in response only when `NODE_ENV=development`
- This allows frontend to display OTP in popup for testing
- **REMOVE** in production - `NODE_ENV=production` will exclude it

🔒 **Production Best Practices**:
- Use environment variables for SMTP credentials
- Never hardcode passwords in code
- Use app passwords instead of account passwords (Gmail)
- Enable 2FA on SMTP account
- Monitor failed delivery attempts
- Log email sending activities
- Implement rate limiting on OTP endpoints

## Next Steps

1. ✅ Serverless function created (`api/send-otp.js`)
2. ✅ Email service updated (`sendOTPViaServerless`)
3. ✅ Controllers updated to use serverless
4. ✅ Environment variables configured
5. ⏳ **Frontend**: Create OTP popup component
6. ⏳ **Testing**: Test full OTP flow with Mailtrap
7. ⏳ **Deployment**: Push to Render and verify production email

## References

- [Nodemailer SMTP Transport](https://nodemailer.com/smtp/)
- [Render Serverless Functions](https://render.com/docs)
- [Vercel Serverless Functions](https://vercel.com/docs/concepts/functions/serverless-functions)
- [Gmail App Passwords](https://support.google.com/accounts/answer/185833)
- [Mailtrap SMTP Settings](https://mailtrap.io/inboxes)
