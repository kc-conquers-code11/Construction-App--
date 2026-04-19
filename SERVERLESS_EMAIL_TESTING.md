# 🧪 Serverless Email Function - Testing Guide

Quick reference for testing the serverless OTP email flow locally and in production.

## Local Testing

### Setup

```bash
# 1. Ensure .env has Mailtrap credentials
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=71e8ffe9532936
SMTP_PASS=41868d98c1f45d
EMAIL_FROM="Construction App <project9960@gmail.com>"
SERVERLESS_EMAIL_API=http://localhost:3000/api/send-otp

# 2. Start dev server
npm run dev

# Server should be running on http://localhost:10000
```

### Test 1: Direct API Call

```bash
# Test the serverless function directly
curl -X POST http://localhost:3000/api/send-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@gmail.com",
    "otp": "123456",
    "type": "LOGIN_OTP"
  }'

# Expected response:
# {
#   "success": true,
#   "messageId": "<20250102T120000.abc123@localhost>",
#   "note": "Email sent successfully"
# }
```

### Test 2: Through Login OTP Endpoint

```bash
# Step 1: Request OTP
curl -X POST http://localhost:10000/api/auth/login-otp \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "test@gmail.com"
  }'

# Expected response (with debug OTP in development):
# {
#   "success": true,
#   "message": "OTP sent to email",
#   "data": {
#     "identifier": "test@gmail.com",
#     "expiresIn": "5 minutes",
#     "sentVia": "email"
#   },
#   "debug": {
#     "otp": "654321",
#     "note": "Development mode only",
#     "showInPopup": true
#   }
# }

# Step 2: Verify OTP (use the OTP from debug field)
curl -X POST http://localhost:10000/api/auth/verify-otp-and-login \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "test@gmail.com",
    "otp": "654321"
  }'
```

### Test 3: Console Logs Check

When you run `npm run dev`, watch for these logs:

```
✅ OTP created: 654321
📧 Attempting serverless email to test@gmail.com
✅ OTP sent via serverless email to test@gmail.com

🔐 DEBUG - OTP Generated (Development Only):
=========================================
OTP Code: 654321
For: test@gmail.com
Expires in: 5 minutes
=========================================
```

### Test 4: Mailtrap Inbox Verification

1. Go to https://mailtrap.io
2. Login with your account
3. Click "Inbox" tab
4. Look for email titled: **"Your OTP Code - Construction App"**
5. Open email and verify:
   - ✅ From: Construction App <project9960@gmail.com>
   - ✅ To: test@gmail.com
   - ✅ OTP displayed in large text: **654321**
   - ✅ Validity: "Valid for 10 minutes"
   - ✅ Security warning included

## Production Testing (Render)

### Prerequisites

```
✅ Render account created
✅ App deployed with environment variables
✅ GitHub repo connected for auto-deploy
✅ SMTP credentials set in Render dashboard
```

### Environment Variables in Render

```
DATABASE_URL=postgresql://...
JWT_SECRET=your_secret
JWT_REFRESH_SECRET=your_secret
NODE_ENV=production
PORT=10000
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
EMAIL_FROM="Construction App <your_email@gmail.com>"
SERVERLESS_EMAIL_API=https://your-app-name.onrender.com/api/send-otp
```

### Test on Production

```bash
# Replace with your actual Render URL
RENDER_URL="https://construction-app.onrender.com"

# Step 1: Request OTP
curl -X POST $RENDER_URL/api/auth/login-otp \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "your-email@gmail.com"
  }'

# Step 2: Check Gmail inbox
# - Open Gmail
# - Look for email from "Construction App"
# - Copy the 6-digit OTP

# Step 3: Verify OTP (paste actual OTP)
curl -X POST $RENDER_URL/api/auth/verify-otp-and-login \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "your-email@gmail.com",
    "otp": "123456"
  }'

# Expected: Login successful with JWT tokens
```

## Verification Checklist

### ✅ Email Sending
- [ ] Serverless function receives request
- [ ] SMTP transporter created successfully
- [ ] Email sent without errors
- [ ] messageId returned

### ✅ Email Delivery
- [ ] Email arrives in inbox (not spam)
- [ ] From address correct
- [ ] Subject line correct
- [ ] OTP code visible and readable

### ✅ OTP Verification
- [ ] Debug OTP matches sent email
- [ ] OTP accepted on verification endpoint
- [ ] JWT tokens returned on success
- [ ] Invalid OTP rejected with error

### ✅ Fallback Testing
1. Temporarily disable SMTP credentials
2. Request OTP (should fail gracefully)
3. Fallback to SMS should be attempted
4. Error message shown to user

## Debugging Common Issues

### Issue: Serverless Function Returns 500 Error

```bash
# Check logs in development
npm run dev

# Look for:
# ❌ Error creating transporter
# ❌ SMTP connection failed
# ❌ Authentication failed
```

**Solution:**
- Verify SMTP credentials in `.env`
- Check SMTP host is correct for provider
- Ensure port matches (Mailtrap: 2525, Gmail: 587)
- Test with Mailtrap first (easier to debug)

### Issue: Email Not Arriving

```bash
# Check Mailtrap
1. Go to https://mailtrap.io → Inbox
2. Verify sent email appears there
3. Check "Spam" folder in Mailtrap

# Check Gmail
1. Go to Gmail → Inbox
2. Check Spam folder
3. Check Promotions tab
```

**Solution:**
- Mailtrap emails arrive instantly
- Gmail may take 30 seconds to 1 minute
- Add sender email to contacts to avoid spam
- Check email isn't rate-limited (max 5 requests/second)

### Issue: Request Timeout

```
Error: ETIMEDOUT - connection timed out
```

**Solution:**
- SMTP connection timeout is normal sometimes
- Email usually sends even if timeout occurs
- Add retry logic in frontend
- Try different SMTP provider
- Check firewall isn't blocking port 587 or 2525

### Issue: Authentication Failed

```
Error: Invalid login: 535-5.7.8 Username and password not accepted
```

**Solution (Gmail):**
1. Go to https://myaccount.google.com/apppasswords
2. Make sure 2-factor authentication is enabled
3. Generate new App Password
4. Copy 16-character password (remove spaces)
5. Paste into `SMTP_PASS` in `.env`

**Solution (Mailtrap):**
1. Go to https://mailtrap.io → Settings
2. Copy SMTP credentials from there
3. Update `SMTP_USER` and `SMTP_PASS`
4. Ensure no extra spaces

## Performance Benchmarks

### Expected Response Times

```
Local Development:
- OTP Request: 500ms - 2s
- Serverless Function: 100-500ms
- Email Arrival: <1s (Mailtrap)

Production (Render):
- OTP Request: 1-3s
- Serverless Function: 200-800ms
- Email Arrival: 30-60s (Gmail)
```

### Scalability

- Mailtrap: 500 emails/month free
- Gmail: 300 emails/day with App Password
- Render serverless: 100 concurrent functions free tier
- No timeout issues due to async email sending

## Test Data

### Valid Test Emails
- Any Gmail address (owns Mailtrap integration)
- Mailtrap provides test email: `test@mailtrap.io`

### Valid Test OTPs
- Format: 6 digits only
- Range: 000000-999999
- Auto-generated: `Math.random()` based

### Invalid Test Cases
```bash
# Missing email
curl -X POST http://localhost:3000/api/send-otp \
  -H "Content-Type: application/json" \
  -d '{"otp": "123456"}'
# Expected: 400 Bad Request

# Invalid email format
curl -X POST http://localhost:3000/api/send-otp \
  -H "Content-Type: application/json" \
  -d '{"email": "not-an-email", "otp": "123456"}'
# Expected: 400 Bad Request

# Missing OTP
curl -X POST http://localhost:3000/api/send-otp \
  -H "Content-Type: application/json" \
  -d '{"email": "test@gmail.com"}'
# Expected: 400 Bad Request
```

## Next Steps After Testing

1. ✅ Confirm serverless function works locally
2. ✅ Verify email arrives in Mailtrap
3. ✅ Test full OTP flow end-to-end
4. ✅ Deploy to Render
5. ✅ Test with production email (Gmail)
6. ⏳ Build frontend OTP popup component
7. ⏳ Add rate limiting to OTP endpoints
8. ⏳ Set up email delivery monitoring

## Notes

- Serverless function URL changes on each deploy (use env variable)
- Mailtrap inbox clears after 30 days
- Gmail App Password works only with that specific app
- OTP expires after 5 minutes (can't reuse old code)
- Max 3 verification attempts per OTP
- Rate limiting recommended: 1 OTP per minute per email
