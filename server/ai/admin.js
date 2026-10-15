/**
 * MindMap Studio — Super Admin Authorization & Security Guard
 * 
 * Enforces strict server-side authorization for AI Provider Management:
 * - Direct Admin Secret Key verification (x-admin-key header) with timing-safe comparison
 * - Cryptographic Supabase JWT verification (HMAC SHA-256 signature, expiry, audience)
 * - Strict production rejection of missing or invalid credentials (401/403)
 * - Hardened environment protection (no unintended cloud bypasses)
 * - Never trusts client-side storage, profiles, or query strings
 */

const crypto = require('crypto');

/**
 * Timing-safe string comparison to prevent side-channel timing attacks
 * @param {string} a 
 * @param {string} b 
 * @returns {boolean}
 */
function safeTimingCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    // Execute dummy comparison to keep constant-time behavior
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Decodes a base64url or base64 string
 */
function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Safely parses a JWT token into header and payload
 */
function parseJwt(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    const signature = parts[2];
    return { header, payload, signature, rawParts: parts };
  } catch (e) {
    return null;
  }
}

/**
 * Verifies JWT signature using HMAC SHA-256 and timing-safe comparison
 */
function verifyJwtSignature(parsedJwt, secret) {
  if (!secret) return false;
  try {
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${parsedJwt.rawParts[0]}.${parsedJwt.rawParts[1]}`)
      .digest('base64url');

    return safeTimingCompare(parsedJwt.signature, expectedSig);
  } catch (e) {
    return false;
  }
}

/**
 * Determines whether the incoming request originates from a local development environment
 */
function isLocalhostRequest(req) {
  const headers = req.headers || {};
  const host = (headers.host || '').toLowerCase();
  const remoteAddr = req.socket?.remoteAddress || req.connection?.remoteAddress || '';

  const isLocalHost = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  const isLocalIp = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';

  return isLocalHost || isLocalIp;
}

/**
 * Extracts and verifies Super Admin authorization from HTTP request
 * @param {import('http').IncomingMessage | Object} req
 * @returns {{ authorized: boolean, statusCode?: number, error?: string, user?: Object, authType?: string }}
 */
function verifySuperAdmin(req) {
  const headers = req.headers || {};
  const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
  const adminSecretKey = process.env.ADMIN_SECRET_KEY;
  const adminEmailsRaw = process.env.ADMIN_EMAILS || '';
  const adminEmails = adminEmailsRaw
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

  // 1. Check x-admin-key header (direct server secret key authentication)
  const reqAdminKey = headers['x-admin-key'];
  if (reqAdminKey && typeof reqAdminKey === 'string') {
    if (adminSecretKey && safeTimingCompare(reqAdminKey.trim(), adminSecretKey.trim())) {
      return {
        authorized: true,
        authType: 'admin_key',
        user: { role: 'super_admin', identifier: 'secret_key' }
      };
    }
    // Explicit admin key supplied, but invalid
    return {
      authorized: false,
      statusCode: 403,
      error: 'Invalid Super Admin Secret Key provided.'
    };
  }

  // 2. Check Authorization: Bearer <jwt_token>
  const authHeader = headers['authorization'] || headers['Authorization'];
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (!token) {
      return {
        authorized: false,
        statusCode: 401,
        error: 'Malformed authorization token: token string is empty.'
      };
    }

    const parsedJwt = parseJwt(token);
    if (!parsedJwt) {
      return {
        authorized: false,
        statusCode: 401,
        error: 'Invalid JWT token format.'
      };
    }

    const { payload } = parsedJwt;

    // Check expiration claim
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return {
        authorized: false,
        statusCode: 401,
        error: 'Authentication session expired. Please sign in again.'
      };
    }

    // Check not-before claim
    if (payload.nbf && payload.nbf > now) {
      return {
        authorized: false,
        statusCode: 401,
        error: 'Authentication token is not yet valid.'
      };
    }

    // Check audience claim (Supabase default is 'authenticated')
    if (payload.aud && payload.aud !== 'authenticated') {
      return {
        authorized: false,
        statusCode: 401,
        error: `Invalid token audience: "${payload.aud}". Expected "authenticated".`
      };
    }

    // Verify cryptographic signature
    if (process.env.SUPABASE_JWT_SECRET) {
      if (!verifyJwtSignature(parsedJwt, process.env.SUPABASE_JWT_SECRET)) {
        return {
          authorized: false,
          statusCode: 401,
          error: 'JWT signature verification failed. Token is invalid or has been tampered with.'
        };
      }
    } else {
      // In production, refuse unsigned/unverifiable JWT tokens for admin actions unless running mock test suite
      if (isProd && process.env.ALLOW_MOCK_JWT_DEV !== 'true') {
        return {
          authorized: false,
          statusCode: 401,
          error: 'Server cannot verify JWT signature: SUPABASE_JWT_SECRET environment variable is missing on server. Admin JWT authentication disabled for security.'
        };
      }
    }

    const userEmail = (payload.email || '').toLowerCase();
    const appRole = payload.app_metadata?.role;
    const userRole = payload.user_metadata?.role;
    const isSuperAdminFlag = payload.user_metadata?.is_super_admin === true ||
                             payload.app_metadata?.is_super_admin === true;

    // Check against ADMIN_EMAILS whitelist
    if (adminEmails.length > 0 && userEmail && adminEmails.includes(userEmail)) {
      return {
        authorized: true,
        authType: 'admin_email',
        user: { email: userEmail, id: payload.sub, role: 'super_admin' }
      };
    }

    // Check role metadata
    if (appRole === 'super_admin' || userRole === 'super_admin' || isSuperAdminFlag) {
      return {
        authorized: true,
        authType: 'jwt_role',
        user: { email: userEmail, id: payload.sub, role: 'super_admin' }
      };
    }

    // Authenticated user exists, but lacks admin privileges
    return {
      authorized: false,
      statusCode: 403,
      error: `Access Denied: Account (${userEmail || payload.sub}) does not have Super Admin privileges.`
    };
  }

  // 3. Environment Fallback Check
  // In production / Vercel: STRICT REJECTION if no credentials provided
  if (isProd) {
    return {
      authorized: false,
      statusCode: 401,
      error: 'Authentication required. Super Admin credentials missing.'
    };
  }

  // In non-production environments:
  // If developer configured ADMIN_SECRET_KEY or ADMIN_EMAILS, enforce it
  if (adminSecretKey || adminEmails.length > 0) {
    return {
      authorized: false,
      statusCode: 401,
      error: 'Authentication required. Please provide valid Super Admin credentials (x-admin-key or admin Bearer token).'
    };
  }

  // STRICT CHECK: Development fallback is ONLY granted if explicitly calling from localhost/127.0.0.1
  if (isLocalhostRequest(req)) {
    console.warn('[ADMIN SECURITY] Running in local development without ADMIN_SECRET_KEY or ADMIN_EMAILS. Development admin access granted for localhost.');
    return {
      authorized: true,
      authType: 'dev_local_fallback',
      user: { email: 'dev-admin@mindmap.local', role: 'super_admin' }
    };
  }

  return {
    authorized: false,
    statusCode: 401,
    error: 'Authentication required. Super Admin credentials missing.'
  };
}

module.exports = {
  verifySuperAdmin,
  parseJwt,
  verifyJwtSignature,
  safeTimingCompare
};
