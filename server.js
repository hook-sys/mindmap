const http = require('http');
const fs = require('fs');
const path = require('path');
const { aiService } = require('./server/ai/service');
const { verifySuperAdmin } = require('./server/ai/admin');

const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1'; // Strictly bind to localhost (prevent LAN access)
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');

// Ensure data directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR, { recursive: true });

// Ensure default user directory exists
const defaultUserDir = path.join(USERS_DIR, 'Default User');
if (!fs.existsSync(defaultUserDir)) fs.mkdirSync(defaultUserDir, { recursive: true });

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.zip': 'application/zip'
};

// Whitelist of public client files allowed to be served over HTTP
const ALLOWED_STATIC_FILES = new Set([
  '/index.html',
  '/style.css',
  '/app.js',
  '/auth.js',
  '/supabase-config.js',
  '/supabase-config.example.js',
  '/mindmap_standalone.html',
  '/mindmap.zip',
  '/favicon.ico'
]);

const ALLOWED_ORIGINS = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`
]);

const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024; // 5 MB max payload
const PROJECT_ID_REGEX = /^[a-zA-Z0-9_\-]{1,64}$/;

function sanitizeName(name) {
  if (!name || typeof name !== 'string') return 'User';
  return name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().substring(0, 50) || 'User';
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
    return true;
  }
  return false;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let aborted = false;

    req.on('data', chunk => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_PAYLOAD_SIZE) {
        aborted = true;
        req.pause();
        const err = new Error('Payload Too Large');
        err.statusCode = 413;
        reject(err);
        return;
      }
      body += chunk.toString();
    });

    req.on('end', () => {
      if (aborted) return;
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        const parseErr = new Error('Malformed JSON payload');
        parseErr.statusCode = 400;
        reject(parseErr);
      }
    });

    req.on('error', err => {
      if (!aborted) reject(err);
    });
  });
}

function sendJson(res, statusCode, data, extraHeaders = {}) {
  const headers = Object.assign({
    'Content-Type': 'application/json; charset=UTF-8'
  }, extraHeaders);
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(data));
}

function sendError(res, statusCode, message, err = null) {
  if (err && statusCode >= 500) {
    console.error(`[Server Error ${statusCode}]:`, err);
  }
  sendJson(res, statusCode, { error: message });
}

const server = http.createServer(async (req, res) => {
  // CORS check (Localhost only)
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(req.url, `http://${HOST}:${PORT}`);
  } catch (err) {
    return sendError(res, 400, 'Invalid request URL');
  }

  const pathname = parsedUrl.pathname;

  // ================= API ROUTES =================
  if (pathname.startsWith('/api/')) {
    // AI Multi-Provider Routes (Fal AI, etc.)
    if (pathname.startsWith('/api/ai/')) {
      // 0. Super Admin AI Settings Endpoints
      if (pathname.startsWith('/api/ai/admin/')) {
        const auth = verifySuperAdmin(req);
        if (!auth.authorized) {
          return sendJson(res, auth.statusCode || 401, {
            success: false,
            error: auth.error || 'Unauthorized: Super Admin access required.',
            code: 'AUTH_REQUIRED'
          });
        }

        // GET /api/ai/admin/config
        if (pathname === '/api/ai/admin/config' && req.method === 'GET') {
          try {
            const config = aiService.getAdminConfig();
            return sendJson(res, 200, { success: true, ...config, authUser: auth.user });
          } catch (e) {
            return sendError(res, 500, 'Failed to retrieve admin configuration', e);
          }
        }

        // POST /api/ai/admin/config
        if (pathname === '/api/ai/admin/config' && req.method === 'POST') {
          try {
            const body = await parseJsonBody(req);
            const updated = aiService.updateAdminConfig(body);
            return sendJson(res, 200, { success: true, ...updated });
          } catch (e) {
            const status = e.statusCode || 500;
            return sendJson(res, status, { success: false, error: e.message });
          }
        }

        // POST /api/ai/admin/test-connection
        if (pathname === '/api/ai/admin/test-connection' && req.method === 'POST') {
          try {
            const body = await parseJsonBody(req);
            const providerId = body.providerId || aiService.activeProviderId;
            const testResult = aiService.testProviderConnection(providerId);
            return sendJson(res, 200, testResult);
          } catch (e) {
            const status = e.statusCode || 500;
            return sendJson(res, status, { success: false, error: e.message });
          }
        }

        return sendError(res, 404, 'Unknown AI Admin endpoint');
      }

      // 1. GET /api/ai/status
      if (pathname === '/api/ai/status' && req.method === 'GET') {
        try {
          const status = aiService.getStatus();
          return sendJson(res, 200, { success: true, ...status });
        } catch (e) {
          return sendError(res, 500, 'Failed to retrieve AI status', e);
        }
      }

      // Plans Catalog (Free, Pro Monthly $3.99, Pro Yearly $17.88)
      if (pathname === '/api/ai/plans' && req.method === 'GET') {
        const { getPlansCatalog } = require('./server/ai/entitlements');
        return sendJson(res, 200, { success: true, plans: getPlansCatalog() });
      }

      // 2. POST /api/ai/generate
      if (pathname === '/api/ai/generate') {
        if (req.method !== 'POST') {
          return sendJson(res, 405, { error: 'Method Not Allowed' }, { 'Allow': 'POST' });
        }
        try {
          const body = await parseJsonBody(req);
          const result = await aiService.generateMindMap(body);
          return sendJson(res, 200, result);
        } catch (e) {
          const status = e.statusCode || 500;
          return sendJson(res, status, { success: false, error: e.message, code: e.code || 'AI_GENERATION_FAILED' });
        }
      }

      // 3. POST /api/ai/expand
      if (pathname === '/api/ai/expand') {
        if (req.method !== 'POST') {
          return sendJson(res, 405, { error: 'Method Not Allowed' }, { 'Allow': 'POST' });
        }
        try {
          const body = await parseJsonBody(req);
          const result = await aiService.expandNode(body);
          return sendJson(res, 200, result);
        } catch (e) {
          const status = e.statusCode || 500;
          return sendJson(res, status, { success: false, error: e.message, code: e.code || 'AI_EXPANSION_FAILED' });
        }
      }

      return sendError(res, 404, 'Unknown AI API endpoint');
    }

    const rawUser = parsedUrl.searchParams.get('user');
    const username = sanitizeName(rawUser || 'Default User');
    const userFolder = path.resolve(USERS_DIR, username);

    // Containment check on user directory
    if (!userFolder.startsWith(USERS_DIR + path.sep)) {
      return sendError(res, 400, 'Invalid user directory path');
    }

    const userExists = fs.existsSync(userFolder) && fs.statSync(userFolder).isDirectory();

    // 1. /api/users - List all users or create a new user profile
    if (pathname === '/api/users') {
      if (req.method === 'GET') {
        try {
          const users = fs.readdirSync(USERS_DIR, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);
          if (!users.includes('Default User')) users.unshift('Default User');
          return sendJson(res, 200, { users });
        } catch (e) {
          return sendError(res, 500, 'Failed to list users', e);
        }
      }

      if (req.method === 'POST') {
        try {
          const body = await parseJsonBody(req);
          const newUserName = sanitizeName(body.username);
          if (!newUserName || newUserName === 'User') {
            return sendError(res, 400, 'Invalid username format');
          }
          const newDir = path.resolve(USERS_DIR, newUserName);
          if (!newDir.startsWith(USERS_DIR + path.sep)) {
            return sendError(res, 400, 'Invalid username path');
          }
          if (!fs.existsSync(newDir)) {
            fs.mkdirSync(newDir, { recursive: true });
          }
          return sendJson(res, 200, { success: true, username: newUserName });
        } catch (e) {
          const status = e.statusCode || 500;
          const msg = e.statusCode ? e.message : 'Failed to create user';
          return sendError(res, status, msg, e);
        }
      }

      return sendJson(res, 405, { error: 'Method Not Allowed' }, { 'Allow': 'GET, POST' });
    }

    // 2. /api/projects - List projects or save/create a project
    if (pathname === '/api/projects') {
      if (req.method === 'GET') {
        if (!userExists) {
          return sendJson(res, 200, { projects: [] });
        }
        try {
          const files = fs.readdirSync(userFolder).filter(f => f.endsWith('.json'));
          const projectList = [];

          for (const file of files) {
            try {
              const content = fs.readFileSync(path.join(userFolder, file), 'utf8');
              const data = JSON.parse(content);
              projectList.push({
                id: data.id || file.replace('.json', ''),
                title: data.title || 'Untitled Project',
                updatedAt: data.updatedAt || fs.statSync(path.join(userFolder, file)).mtimeMs,
                nodeCount: data.nodes ? Object.keys(data.nodes).length : 0
              });
            } catch (err) {
              console.error('Error reading project file:', file, err.message);
            }
          }

          projectList.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          return sendJson(res, 200, { projects: projectList });
        } catch (e) {
          return sendError(res, 500, 'Failed to list projects', e);
        }
      }

      if (req.method === 'POST') {
        try {
          const body = await parseJsonBody(req);
          let projectId = body.id;
          if (projectId !== undefined && projectId !== null) {
            if (typeof projectId !== 'string' || !PROJECT_ID_REGEX.test(projectId)) {
              return sendError(res, 400, 'Invalid project ID format. Alphanumeric, dash, and underscore allowed (1-64 chars).');
            }
          } else {
            projectId = `proj_${Date.now()}`;
          }

          // Ensure user directory exists when saving
          if (!userExists) {
            fs.mkdirSync(userFolder, { recursive: true });
          }

          const projectFile = path.resolve(userFolder, `${projectId}.json`);
          if (!projectFile.startsWith(userFolder + path.sep)) {
            return sendError(res, 400, 'Path traversal detected in project ID');
          }

          const projectData = {
            id: projectId,
            title: typeof body.title === 'string' ? body.title.substring(0, 100) : 'Untitled Project',
            nodes: (body.nodes && typeof body.nodes === 'object') ? body.nodes : {},
            rootId: typeof body.rootId === 'string' ? body.rootId : 'root',
            updatedAt: Date.now()
          };

          // Atomic File Write: Write to temp file then rename
          const tmpFile = path.resolve(userFolder, `${projectId}.json.tmp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`);
          try {
            fs.writeFileSync(tmpFile, JSON.stringify(projectData, null, 2), 'utf8');
            fs.renameSync(tmpFile, projectFile);
          } catch (writeErr) {
            if (fs.existsSync(tmpFile)) {
              try { fs.unlinkSync(tmpFile); } catch (e) {}
            }
            throw writeErr;
          }

          return sendJson(res, 200, { success: true, project: projectData });
        } catch (e) {
          const status = e.statusCode || 500;
          const msg = e.statusCode ? e.message : 'Failed to save project';
          return sendError(res, status, msg, e);
        }
      }

      return sendJson(res, 405, { error: 'Method Not Allowed' }, { 'Allow': 'GET, POST' });
    }

    // 3. /api/projects/:id - Load or Delete a specific project
    const projectMatch = pathname.match(/^\/api\/projects\/([a-zA-Z0-9_\-]+)$/);
    if (projectMatch) {
      const projectId = projectMatch[1];
      if (!PROJECT_ID_REGEX.test(projectId)) {
        return sendError(res, 400, 'Invalid project ID format');
      }

      if (!userExists) {
        return sendError(res, 404, 'Project not found');
      }

      const projectFile = path.resolve(userFolder, `${projectId}.json`);
      if (!projectFile.startsWith(userFolder + path.sep)) {
        return sendError(res, 400, 'Path traversal detected in project ID');
      }

      if (req.method === 'GET') {
        if (!fs.existsSync(projectFile)) {
          return sendError(res, 404, 'Project not found');
        }
        try {
          const content = fs.readFileSync(projectFile, 'utf8');
          return sendJson(res, 200, JSON.parse(content));
        } catch (e) {
          return sendError(res, 500, 'Failed to read project', e);
        }
      }

      if (req.method === 'DELETE') {
        if (!fs.existsSync(projectFile)) {
          return sendError(res, 404, 'Project not found');
        }
        try {
          // Reversible trash storage: move to .trash directory inside userFolder
          const trashDir = path.resolve(userFolder, '.trash');
          if (!fs.existsSync(trashDir)) {
            fs.mkdirSync(trashDir, { recursive: true });
          }
          const trashTarget = path.resolve(trashDir, `${projectId}_${Date.now()}.json`);
          fs.renameSync(projectFile, trashTarget);
          return sendJson(res, 200, { success: true, deletedId: projectId });
        } catch (e) {
          return sendError(res, 500, 'Failed to delete project', e);
        }
      }

      return sendJson(res, 405, { error: 'Method Not Allowed' }, { 'Allow': 'GET, DELETE' });
    }

    return sendError(res, 404, 'API route not found');
  }

  // ================= STATIC FILES (Strict Whitelist & Containment) =================
  let reqPath = '';
  try {
    reqPath = decodeURIComponent(pathname);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=UTF-8' });
    res.end('400 Bad Request');
    return;
  }

  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  const normalizedReqPath = path.posix.normalize(reqPath);

  // Strict check against public static files whitelist
  if (!ALLOWED_STATIC_FILES.has(normalizedReqPath)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=UTF-8' });
    res.end('<h1>404 Not Found</h1><p>File does not exist.</p>');
    return;
  }

  const filePath = path.resolve(ROOT_DIR, '.' + normalizedReqPath);
  if (!filePath.startsWith(ROOT_DIR + path.sep) && filePath !== ROOT_DIR) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=UTF-8' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=UTF-8' });
      res.end('<h1>404 Not Found</h1><p>File does not exist.</p>');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/`;
  console.log('\n=============================================');
  console.log(`🧠 MindMap Studio Dev Server is Running!`);
  console.log(`➜ Local:   ${url} (Bound strictly to ${HOST})`);
  console.log('➜ Multi-User & Projects API Active');
  console.log('➜ Press Ctrl+C to stop the server');
  console.log('=============================================\n');
});
