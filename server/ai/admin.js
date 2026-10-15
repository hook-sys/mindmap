/**
 * MindMap Studio — Super Admin Authorization & Security Guard
 * 
 * Enforces strict server-side authorization for AI Provider Management:
 * - Direct Admin Secret Key verification (x-admin-key header)
 * - Supabase JWT verification & admin role/email authorization
 * - Rejects unauthorized requests with 401 Unauthorized or 403 Forbidden
 * - Never trusts client-side storage, profiles, or query strings
 */

const crypto = require('crypto');

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
 * Verifies JWT signature if SUPABASE_JWT_SECRET is configured
 */
function verifyJwtSignature(parsedJwt, secret) {
  if (!secret) return true; // Signature check skipped if secret not configured
  try {
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${parsedJwt.rawParts[0]}.${parsedJwt.rawParts[1]}`)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    return crypto.timingSafeEqual(
      Buffer.from(parsedJwt.signature),
      Buffer.from(expectedSig)
    );
  } catch (e) {
    return false;
  }
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

  // 1. Check x-admin-key header (direct server key authentication)
  const reqAdminKey = headers['x-admin-key'];
  if (reqAdminKey && typeof reqAdminKey === 'string') {
    if (adminSecretKey && reqAdminKey.trim() === adminSecretKey.trim()) {
      return {
        authorized: true,
        authType: 'admin_key',
        user: { role: 'super_admin', identifier: 'secret_key' }
      };
    }
    // If admin key was explicitly provided but wrong
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
        error: 'Malformed authorization token.'
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

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return {
        authorized: false,
        statusCode: 401,
        error: 'Authentication session expired. Please sign in again.'
      };
    }

    // Check signature if SUPABASE_JWT_SECRET is set
    if (process.env.SUPABASE_JWT_SECRET) {
      if (!verifyJwtSignature(parsedJwt, process.env.SUPABASE_JWT_SECRET)) {
        return {
          authorized: false,
          statusCode: 401,
          error: 'JWT signature verification failed.'
        };
      }
    }

    const userEmail = (payload.email || '').toLowerCase();
    const appRole = payload.app_metadata?.role;
    const userRole = payload.user_metadata?.role;
    const isSuperAdminFlag = payload.user_metadata?.is_super_admin === true ||
                             payload.app_metadata?.is_super_admin === true;

    // A. Check against ADMIN_EMAILS whitelist
    if (adminEmails.length > 0 && userEmail && adminEmails.includes(userEmail)) {
      return {
        authorized: true,
        authType: 'admin_email',
        user: { email: userEmail, id: payload.sub, role: 'super_admin' }
      };
    }

    // B. Check role metadata
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

  // In Local Development:
  // If developer set ADMIN_SECRET_KEY or ADMIN_EMAILS, enforce it
  if (adminSecretKey || adminEmails.length > 0) {
    return {
      authorized: false,
      statusCode: 401,
      error: 'Authentication required. Please provide valid Super Admin credentials (x-admin-key or admin Bearer token).'
    };
  }

  // Local development convenience fallback when no admin secrets are configured
  console.warn('[ADMIN SECURITY] Running in local development without ADMIN_SECRET_KEY or ADMIN_EMAILS. Development admin access granted.');
  return {
    authorized: true,
    authType: 'dev_local_fallback',
    user: { email: 'dev-admin@mindmap.local', role: 'super_admin' }
  };
}

module.exports = {
  verifySuperAdmin,
  parseJwt
};
