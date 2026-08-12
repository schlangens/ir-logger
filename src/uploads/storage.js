const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const { nanoid } = require('nanoid');
const evidenceDir = process.env.EVIDENCE_DIR || path.join(__dirname, '../../data/evidence');
fs.mkdirSync(evidenceDir, { recursive: true });
const evidenceStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, evidenceDir),
  filename: (req, file, cb) => cb(null, `${nanoid(24)}.bin`),
});
function createUpload(limits) {
  return multer({
    storage: evidenceStorage,
    limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 10, ...(limits || {}) },
  });
}
module.exports = { evidenceStorage, evidenceDir, createUpload };
