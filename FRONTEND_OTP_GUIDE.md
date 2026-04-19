# 🎨 Frontend OTP Implementation Guide

This guide explains what the frontend should expect from the backend OTP endpoints and how to build the user interface.

## Backend Response Formats

### 1. Request OTP Response

**Endpoint**: `POST /api/auth/login-otp`

**Request**:
```json
{
  "identifier": "user@email.com"
}
```

**Response - Development Mode** (NODE_ENV=development):
```json
{
  "success": true,
  "message": "OTP sent to email",
  "data": {
    "identifier": "user@email.com",
    "expiresIn": "5 minutes",
    "sentVia": "email"
  },
  "debug": {
    "otp": "654321",
    "note": "This is for development/testing only. Remove in production.",
    "showInPopup": true
  }
}
```

**Response - Production Mode** (NODE_ENV=production):
```json
{
  "success": true,
  "message": "OTP sent to email",
  "data": {
    "identifier": "user@email.com",
    "expiresIn": "5 minutes",
    "sentVia": "email"
  }
}
```

**Error Response**:
```json
{
  "success": false,
  "message": "Failed to send OTP",
  "error": "Invalid email format"
}
```

### 2. Verify OTP Response

**Endpoint**: `POST /api/auth/verify-otp-and-login`

**Request**:
```json
{
  "identifier": "user@email.com",
  "otp": "654321"
}
```

**Response - Success**:
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "uuid-123",
      "name": "John Doe",
      "email": "user@email.com",
      "phone": "+91-9876543210",
      "userType": "admin",
      "designation": "Project Manager",
      "profilePicture": "https://...",
      "company": {
        "id": "company-uuid",
        "name": "Neev Construction",
        "logo": "https://..."
      },
      "role": {
        "id": "role-uuid",
        "name": "Admin",
        "permissions": ["create_user", "edit_project", "view_dashboard"]
      }
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
}
```

**Response - Invalid OTP**:
```json
{
  "success": false,
  "message": "Invalid OTP",
  "error": "OTP code is incorrect or has expired"
}
```

**Response - Max Attempts Exceeded**:
```json
{
  "success": false,
  "message": "Maximum OTP attempts exceeded",
  "error": "Please request a new OTP"
}
```

---

## Frontend Implementation

### Step 1: Build Login Form Component

```jsx
// LoginForm.jsx
import React, { useState } from 'react';
import { requestOTP } from '@/api/auth';
import OTPModal from './OTPModal';

export default function LoginForm() {
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showOTPModal, setShowOTPModal] = useState(false);
  const [otpDebug, setOtpDebug] = useState(null);

  const handleRequestOTP = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await requestOTP({ identifier });

      if (response.success) {
        // Save debug OTP if available (development only)
        if (response.debug?.otp) {
          setOtpDebug(response.debug.otp);
        }

        // Show OTP modal
        setShowOTPModal(true);
      } else {
        setError(response.message || 'Failed to send OTP');
      }
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <form onSubmit={handleRequestOTP}>
        <h2>Construction App Login</h2>

        <input
          type="email"
          placeholder="Enter email or phone"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          required
        />

        <button type="submit" disabled={loading}>
          {loading ? 'Sending OTP...' : 'Request OTP'}
        </button>

        {error && <p className="error">{error}</p>}

        {/* Show debug OTP if available (development) */}
        {otpDebug && (
          <div className="debug-info">
            <p>🔐 Development Mode - OTP: <strong>{otpDebug}</strong></p>
          </div>
        )}
      </form>

      {/* OTP Verification Modal */}
      {showOTPModal && (
        <OTPModal
          identifier={identifier}
          debugOTP={otpDebug}
          onClose={() => setShowOTPModal(false)}
          onSuccess={(tokens) => {
            // Store tokens
            localStorage.setItem('accessToken', tokens.accessToken);
            localStorage.setItem('refreshToken', tokens.refreshToken);
            // Redirect to dashboard
            window.location.href = '/dashboard';
          }}
        />
      )}
    </div>
  );
}
```

### Step 2: Build OTP Modal Component

```jsx
// OTPModal.jsx
import React, { useState, useEffect } from 'react';
import { verifyOTP, requestOTP } from '@/api/auth';

export default function OTPModal({ identifier, debugOTP, onClose, onSuccess }) {
  const [otp, setOTP] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [timeLeft, setTimeLeft] = useState(300); // 5 minutes
  const [attempts, setAttempts] = useState(0);
  const [canResend, setCanResend] = useState(false);

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Enable resend after 30 seconds
  useEffect(() => {
    const resendTimer = setTimeout(() => {
      setCanResend(true);
    }, 30000);

    return () => clearTimeout(resendTimer);
  }, []);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (otp.length !== 6) {
      setError('OTP must be 6 digits');
      setLoading(false);
      return;
    }

    try {
      const response = await verifyOTP({
        identifier,
        otp,
      });

      if (response.success) {
        onSuccess(response.data.tokens);
      } else {
        setError(response.message || 'Invalid OTP');
        setAttempts(attempts + 1);

        if (attempts >= 2) {
          setError('Maximum attempts exceeded. Please request a new OTP.');
        }
      }
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setCanResend(false);
    setOTP('');
    setTimeLeft(300);
    setAttempts(0);
    setError('');

    try {
      const response = await requestOTP({ identifier });
      if (!response.success) {
        setError(response.message || 'Failed to resend OTP');
      }
    } catch (err) {
      setError(err.message || 'Network error');
    }

    // Re-enable resend after 30 seconds
    setTimeout(() => setCanResend(true), 30000);
  };

  const isExpired = timeLeft === 0;
  const isCritical = timeLeft < 60;

  return (
    <div className="otp-modal-overlay">
      <div className="otp-modal">
        <button className="close-btn" onClick={onClose}>×</button>

        <h2>Verify OTP</h2>
        <p className="subtitle">Enter the 6-digit code sent to your email</p>

        <form onSubmit={handleVerify}>
          <div className="otp-input-container">
            <input
              type="text"
              maxLength="6"
              value={otp}
              onChange={(e) => {
                // Only allow digits
                const digits = e.target.value.replace(/[^0-9]/g, '');
                setOTP(digits);
              }}
              placeholder="000000"
              className="otp-input"
              disabled={isExpired}
              autoFocus
            />
          </div>

          {/* Debug OTP Display (Development Only) */}
          {debugOTP && (
            <div className="debug-otp">
              <p>🔐 Debug: {debugOTP}</p>
              <button
                type="button"
                onClick={() => setOTP(debugOTP)}
                className="copy-debug-btn"
              >
                Auto-fill for testing
              </button>
            </div>
          )}

          {/* Timer */}
          <div className={`timer ${isCritical ? 'critical' : ''}`}>
            ⏱️ Time remaining: <strong>{formatTime(timeLeft)}</strong>
          </div>

          {/* Error Message */}
          {error && <p className="error-message">{error}</p>}

          {/* Attempts Counter */}
          {attempts > 0 && (
            <p className="attempts">
              Attempts remaining: {3 - attempts}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || isExpired || otp.length !== 6}
            className="verify-btn"
          >
            {loading ? 'Verifying...' : 'Verify OTP'}
          </button>
        </form>

        {/* OTP Expired */}
        {isExpired && (
          <div className="expired-message">
            <p>❌ OTP has expired</p>
            <button onClick={handleResend} className="resend-btn">
              Request New OTP
            </button>
          </div>
        )}

        {/* Resend Option */}
        {!isExpired && (
          <div className="resend-section">
            <p>Didn't receive the code?</p>
            <button
              onClick={handleResend}
              disabled={!canResend}
              className="resend-btn"
            >
              {canResend ? 'Resend OTP' : `Resend in ${30 - Math.floor((Date.now() / 1000) % 30)}s`}
            </button>
          </div>
        )}

        {/* Help Text */}
        <p className="help-text">
          Check your email spam folder if you don't receive the OTP
        </p>
      </div>
    </div>
  );
}
```

### Step 3: API Client Calls

```javascript
// api/auth.js
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:10000/api';

export const requestOTP = async (data) => {
  try {
    const response = await axios.post(`${API_URL}/auth/login-otp`, data);
    return response.data;
  } catch (error) {
    return error.response?.data || { success: false, message: error.message };
  }
};

export const verifyOTP = async (data) => {
  try {
    const response = await axios.post(`${API_URL}/auth/verify-otp-and-login`, data);
    return response.data;
  } catch (error) {
    return error.response?.data || { success: false, message: error.message };
  }
};

export const logout = async () => {
  try {
    const token = localStorage.getItem('accessToken');
    const response = await axios.post(
      `${API_URL}/auth/logout`,
      {},
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    return response.data;
  } catch (error) {
    return error.response?.data || { success: false, message: error.message };
  }
};
```

### Step 4: CSS Styling

```css
/* LoginForm.css */

.login-container {
  max-width: 400px;
  margin: 50px auto;
  padding: 30px;
  background: white;
  border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.login-container h2 {
  margin-bottom: 20px;
  text-align: center;
  color: #2c3e50;
}

.login-container input {
  width: 100%;
  padding: 10px;
  margin: 10px 0;
  border: 1px solid #ddd;
  border-radius: 5px;
  font-size: 14px;
}

.login-container button {
  width: 100%;
  padding: 10px;
  margin-top: 15px;
  background: #3498db;
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-weight: bold;
}

.login-container button:disabled {
  background: #95a5a6;
  cursor: not-allowed;
}

.error {
  color: #e74c3c;
  margin-top: 10px;
  text-align: center;
}

.debug-info {
  background: #fff3cd;
  border: 1px solid #ffc107;
  padding: 10px;
  border-radius: 5px;
  margin-top: 10px;
  text-align: center;
}

/* OTP Modal CSS */

.otp-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.otp-modal {
  background: white;
  padding: 30px;
  border-radius: 10px;
  max-width: 400px;
  width: 90%;
  position: relative;
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.3);
}

.close-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
}

.otp-modal h2 {
  margin: 0 0 10px 0;
  color: #2c3e50;
}

.subtitle {
  color: #7f8c8d;
  margin-bottom: 20px;
}

.otp-input-container {
  display: flex;
  justify-content: center;
  margin: 20px 0;
}

.otp-input {
  width: 200px;
  padding: 15px;
  font-size: 32px;
  text-align: center;
  border: 2px solid #ddd;
  border-radius: 10px;
  letter-spacing: 10px;
  font-weight: bold;
}

.otp-input:focus {
  outline: none;
  border-color: #3498db;
}

.debug-otp {
  background: #e8f4f8;
  border: 1px solid #3498db;
  padding: 10px;
  border-radius: 5px;
  margin: 10px 0;
  text-align: center;
}

.copy-debug-btn {
  background: #3498db;
  color: white;
  border: none;
  padding: 5px 10px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
  margin-top: 5px;
}

.timer {
  text-align: center;
  margin: 15px 0;
  color: #2c3e50;
  font-weight: bold;
}

.timer.critical {
  color: #e74c3c;
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.error-message {
  color: #e74c3c;
  margin: 10px 0;
  text-align: center;
  font-size: 14px;
}

.attempts {
  color: #f39c12;
  margin: 10px 0;
  text-align: center;
  font-size: 14px;
}

.verify-btn {
  width: 100%;
  padding: 12px;
  background: #27ae60;
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-weight: bold;
  margin-top: 10px;
}

.verify-btn:disabled {
  background: #95a5a6;
  cursor: not-allowed;
}

.expired-message {
  text-align: center;
  margin-top: 20px;
  padding: 15px;
  background: #ffe8e8;
  border-radius: 5px;
}

.resend-section {
  text-align: center;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid #ddd;
}

.resend-btn {
  background: #3498db;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 5px;
  cursor: pointer;
  margin-top: 10px;
}

.resend-btn:disabled {
  background: #95a5a6;
  cursor: not-allowed;
}

.help-text {
  font-size: 12px;
  color: #7f8c8d;
  text-align: center;
  margin-top: 15px;
}
```

---

## Environment Variables (Frontend)

```env
# .env or .env.local
REACT_APP_API_URL=http://localhost:10000/api
```

For production:
```env
REACT_APP_API_URL=https://your-render-app.onrender.com/api
```

---

## Key Points for Frontend

✅ **Development Mode**: Debug OTP will be in response.debug.otp  
✅ **Production Mode**: No debug OTP in response  
✅ **Timer**: Count down from 5 minutes (300 seconds)  
✅ **Resend**: Only after 30 seconds of initial request  
✅ **Attempts**: Show max 3 attempts per OTP  
✅ **Auto-fill**: Allow copying OTP to input for testing  
✅ **Error Handling**: Show clear error messages  
✅ **Token Storage**: Save both accessToken and refreshToken  

---

## Testing in Development

1. ✅ Request OTP
2. ✅ Copy debug OTP from response
3. ✅ Paste into OTP input
4. ✅ Verify immediately
5. ✅ Receive JWT tokens
6. ✅ Redirect to dashboard

## Testing in Production

1. ✅ Request OTP
2. ✅ Check email (will arrive in 30-60 seconds)
3. ✅ Copy OTP from email
4. ✅ Paste into OTP input
5. ✅ Verify
6. ✅ Receive JWT tokens
7. ✅ Redirect to dashboard
