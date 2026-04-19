# ⚡ Quick Gmail Setup for OTP

## 🚀 5 Minutes Setup

### Step 1: Create Gmail App Password
```
1. Open: https://myaccount.google.com/apppasswords
2. Login with your Gmail account
3. Select:
   ✓ App: Mail
   ✓ Device: Windows Computer (or your platform)
4. Click "Generate"
5. Google will show a 16-character password
6. Copy it (it appears in yellow box)
```

### Step 2: Add to .env (Local Testing)
Edit `.env` file:
```properties
SMTP_USER=your_email@gmail.com
SMTP_PASS=xyzpqrstuvwxyzab
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
EMAIL_FROM="Construction App <your_email@gmail.com>"
NODE_ENV=development
```

### Step 3: Test Locally
```bash
npm run dev
```

Then request OTP:
```bash
curl -X POST http://localhost:3000/api/auth/login-otp \
  -H "Content-Type: application/json" \
  -d '{"identifier":"test@gmail.com"}'
```

Check console - should see:
```
✅ OTP sent via email to test@gmail.com
```

---

## 🌐 Production Setup on Render

### Step 1: Get Your Gmail App Password
Follow Step 1 above ⬆️

### Step 2: Add to Render Environment
1. Go to: https://dashboard.render.com
2. Select your service: `construction-api`
3. Click **"Environment"** tab
4. Add these variables:

| Key | Value |
|-----|-------|
| SMTP_USER | your_email@gmail.com |
| SMTP_PASS | xyzpqrstuvwxyzab |
| SMTP_HOST | smtp.gmail.com |
| SMTP_PORT | 587 |
| EMAIL_FROM | Construction App <your_email@gmail.com> |

5. Click **"Save"**
6. Service will auto-redeploy ✨

---

## ✅ Verification

### Test Email OTP Works
```bash
curl -X POST https://your-app.onrender.com/api/auth/login-otp \
  -H "Content-Type: application/json" \
  -d '{"identifier":"test@gmail.com"}'
```

Response should be:
```json
{
  "success": true,
  "message": "OTP sent to email",
  "data": {
    "sentVia": "email",
    "expiresIn": "5 minutes"
  }
}
```

Check your email inbox - OTP should arrive! 📧

---

## ⚠️ Common Issues

### "Gmail transporter not configured"
- Missing `SMTP_USER` or `SMTP_PASS` in environment
- Check `.env` file or Render environment variables

### "Invalid credentials"
- Using regular Gmail password instead of App Password
- App Password only works with 2-Step Verification enabled
- Go back to https://myaccount.google.com/apppasswords and regenerate

### "Less secure app access"
- Modern Gmail doesn't support this
- MUST use App Passwords (not account password)

### "SMTP error 535"
- App Password is incorrect
- Verify you copied all 16 characters
- Regenerate and try again

---

## 🔒 Security Tips

✅ **DO:**
- Use App Password (never account password)
- Keep SMTP_PASS secret
- Use environment variables in production
- Regenerate if exposed

❌ **DON'T:**
- Commit `.env` with real credentials to git
- Share App Password in public channels
- Use regular Gmail password for SMTP

---

## 📧 Testing Email Template

OTP email should look like:
```
From: Construction App <your_email@gmail.com>
Subject: Your OTP Code - Neev Construction App

┌─────────────────────┐
│   OTP: 123456       │
│ Valid for 10 mins   │
└─────────────────────┘

⚠️ Never share this OTP with anyone
```

---

## Still Not Working?

1. Check Render logs: Dashboard → Logs
2. Verify environment variables are set
3. Check SMTP_PASS matches exactly (copy-paste carefully)
4. Check Gmail 2-Step Verification is enabled
5. Try regenerating App Password

Need help? Check `OTP_CONFIGURATION.md` for more details!
