const router = require('express').Router();
const crypto = require('node:crypto');
const fs = require('node:fs');
const multer = require('multer');
const evidence = require('../services/evidence');
const custody = require('../services/custody');
const { resolveWorkspaceAccess, resolveActor, requireSession } = require('../middleware/workspace-guard');
const { rateLimit } = require('../middleware/rate-limit');
const { evidenceStorage } = require('../uploads/storage');
const hub = require('../sse/hub');

const MB = 1024 * 1024;
const NORMAL_FILE_CAP = 25 * MB;
const DEMO_FILE_CAP = 5 * MB;
const NORMAL_TOTAL_CAP = 200 * MB;
const DEMO_TOTAL_CAP = 20 * MB;

function evidenceUploadRateLimitKey(req) {
  return req.user?.id || req.session?.demoWorkspaceId || req.ip;
}

const evidenceUploadRateLimit = rateLimit({
  bucket: 'evidence-upload',
  max: 30,
  windowMs: 60 * 60 * 1000,
  keyFn: evidenceUploadRateLimitKey,
});

function sanitizeFilename(name, id) {
  const sanitized = String(name || '')
    .replace(/[\/\\]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^A-Za-z0-9._ -]/g, '')
    .slice(0, 200);
  return sanitized || `evidence-${id}`;
}

function removeWrittenFile(req, file) {
  const paths = new Set([
    req._evidenceStoredPath,
    file?.path,
    file?.destination && file?.filename ? `${file.destination}/${file.filename}` : null,
  ]);
  for (const target of paths) {
    if (!target) continue;
    try {
      fs.unlinkSync(target);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

// Delegate writing to Round 1's configured disk-storage engine while hashing
// the exact stream it receives; this route does not redefine that engine.
const hashingStorage = {
  _handleFile(req, file, callback) {
    const hash = crypto.createHash('sha256');
    file.stream.on('data', (chunk) => hash.update(chunk));
    evidenceStorage._handleFile(req, file, (error, info) => {
      if (error) return callback(error);
      req._evidenceStoredPath = info.path;
      callback(null, { ...info, sha256: hash.digest('hex') });
    });
  },
  _removeFile(req, file, callback) {
    return evidenceStorage._removeFile(req, file, callback);
  },
};

router.use(['/incidents/:id/evidence', '/evidence/:id'], requireSession);

function guardIncident(db, req, incidentId) {
  const incident = evidence.getIncident(db, incidentId);
  if (!incident) return { response: { status: 404, error: 'Incident not found' } };
  const access = resolveWorkspaceAccess(db, req, incident.workspace_id);
  if (!access.ok) {
    if (access.status === 404) return { response: { status: 404, error: 'Incident not found' } };
    return { response: access };
  }
  const actor = resolveActor(db, req, incident.workspace_id);
  if (!actor) return { response: { status: 401, error: 'Authentication required' } };
  return { incident, access, actor };
}

function guardEvidence(db, req, evidenceId) {
  const item = evidence.getWithWorkspace(db, evidenceId);
  if (!item) return { response: { status: 404, error: 'Evidence not found' } };
  const access = resolveWorkspaceAccess(db, req, item.workspace_id);
  if (!access.ok) {
    if (access.status === 404) return { response: { status: 404, error: 'Evidence not found' } };
    return { response: access };
  }
  const actor = resolveActor(db, req, item.workspace_id);
  if (!actor) return { response: { status: 401, error: 'Authentication required' } };
  return { item, access, actor };
}

function sendGuardFailure(res, result) {
  return res.status(result.status).json({ error: result.error });
}

router.post('/incidents/:id/evidence', evidenceUploadRateLimit, (req, res, next) => {
  const db = req.app.locals.db;
  try {
    const guarded = guardIncident(db, req, req.params.id);
    if (guarded.response) return sendGuardFailure(res, guarded.response);
    if (!['owner', 'analyst'].includes(guarded.access.role))
      return res.status(403).json({ error: 'Forbidden' });
    const usage = evidence.usage(db, guarded.incident.workspace_id);
    const isDemo = guarded.access.isDemo;
    const rowCap = isDemo ? 5 : Infinity;
    const totalCap = isDemo ? DEMO_TOTAL_CAP : NORMAL_TOTAL_CAP;
    if (usage.count >= rowCap)
      return res.status(409).json({ error: 'Evidence row limit reached' });
    if (usage.bytes >= totalCap)
      return res.status(409).json({ error: 'Evidence total size limit reached' });

    const contentLength = parseInt(req.get('Content-Length'), 10);
    if (!Number.isNaN(contentLength) && usage.bytes + contentLength > totalCap) {
      return res.status(409).json({ error: 'Evidence total size limit exceeded' });
    }

    const upload = multer({
      storage: hashingStorage,
      limits: {
        fileSize: isDemo ? DEMO_FILE_CAP : NORMAL_FILE_CAP,
        files: 1,
        fields: 10,
      },
    });
    upload.single('file')(req, res, (uploadError) => {
      if (uploadError) {
        try {
          removeWrittenFile(req, req.file);
        } catch (cleanupError) {
          return next(cleanupError);
        }
        if (uploadError instanceof multer.MulterError) {
          return res
            .status(uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
            .json({ error: uploadError.message });
        }
        return res.status(400).json({ error: uploadError.message });
      }
      if (!req.file) return res.status(400).json({ error: 'File is required' });

      try {
        const entryId = req.body?.entry_id;
        if (entryId && !evidence.entryBelongsToIncident(db, entryId, guarded.incident.id)) {
          removeWrittenFile(req, req.file);
          return res.status(400).json({ error: 'Entry not found' });
        }
        const after = evidence.usage(db, guarded.incident.workspace_id);
        if (after.bytes + req.file.size > totalCap) {
          removeWrittenFile(req, req.file);
          return res.status(409).json({ error: 'Evidence total size limit exceeded' });
        }
        const itemId = evidence.createId();
        const filename = sanitizeFilename(req.file.originalname, itemId);
        db.transaction(() => {
          evidence.insert(db, {
            id: itemId,
            incidentId: guarded.incident.id,
            entryId,
            filename,
            mime: req.file.mimetype,
            size: req.file.size,
            sha256: req.file.sha256,
            storedPath: req.file.path,
            uploadedBy: guarded.actor.id,
          });
          custody.append(db, {
            evidenceId: itemId,
            workspaceId: guarded.incident.workspace_id,
            actorUserId: guarded.actor.id,
            action: 'uploaded',
          });
        })();
        const metadata = evidence.metadata(evidence.getById(db, itemId));
        hub.broadcast(guarded.incident.id, 'evidence.uploaded', metadata);
        return res.status(201).json({ evidence: metadata });
      } catch (error) {
        try {
          removeWrittenFile(req, req.file);
        } catch (cleanupError) {
          return next(cleanupError);
        }
        return next(error);
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/incidents/:id/evidence', (req, res, next) => {
  const db = req.app.locals.db;
  try {
    const guarded = guardIncident(db, req, req.params.id);
    if (guarded.response) return sendGuardFailure(res, guarded.response);
    res.json({ evidence: evidence.listByIncident(db, guarded.incident.id) });
  } catch (error) {
    next(error);
  }
});

router.get('/evidence/:id', (req, res, next) => {
  const db = req.app.locals.db;
  try {
    const guarded = guardEvidence(db, req, req.params.id);
    if (guarded.response) return sendGuardFailure(res, guarded.response);
    db.transaction(() => {
      custody.append(db, {
        evidenceId: guarded.item.id,
        workspaceId: guarded.item.workspace_id,
        actorUserId: guarded.actor.id,
        action: 'viewed',
      });
    })();
    res.json({ evidence: evidence.metadata(guarded.item) });
  } catch (error) {
    next(error);
  }
});

router.get('/evidence/:id/download', (req, res, next) => {
  const db = req.app.locals.db;
  try {
    const guarded = guardEvidence(db, req, req.params.id);
    if (guarded.response) return sendGuardFailure(res, guarded.response);
    if (!fs.existsSync(guarded.item.stored_path))
      return res.status(404).json({ error: 'Evidence file not found' });
    db.transaction(() => {
      custody.append(db, {
        evidenceId: guarded.item.id,
        workspaceId: guarded.item.workspace_id,
        actorUserId: guarded.actor.id,
        action: 'downloaded',
      });
    })();
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${sanitizeFilename(
        guarded.item.filename,
        guarded.item.id,
      )}"`,
    });
    const stream = fs.createReadStream(guarded.item.stored_path);
    stream.on('error', (error) => {
      if (!res.headersSent) next(error);
      else res.destroy(error);
    });
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
});

router.get('/evidence/:id/custody', (req, res, next) => {
  const db = req.app.locals.db;
  try {
    const guarded = guardEvidence(db, req, req.params.id);
    if (guarded.response) return sendGuardFailure(res, guarded.response);
    res.json({ events: custody.list(db, guarded.item.id) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
