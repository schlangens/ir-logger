const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const multer = require('multer');
const { nanoid } = require('nanoid');
const evidenceDir = process.env.EVIDENCE_DIR || path.join(__dirname, '../../data/evidence');
fs.mkdirSync(evidenceDir, { recursive: true });
const MAX_FILE_SIZE = 25 * 1024 * 1024;

function generatedFilename() {
  return `${nanoid(24)}.bin`;
}

const evidenceStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, evidenceDir),
  filename: (req, file, cb) => cb(null, generatedFilename()),
});

const hashingEvidenceStorage = {
  _handleFile(req, file, cb) {
    const filename = generatedFilename();
    const target = path.join(evidenceDir, filename);
    const hash = crypto.createHash('sha256');
    let finished = false;
    const output = fs.createWriteStream(target);
    let sourceClosed = false;
    let outputFinished = false;
    let failure;
    let cleanupStarted = false;
    const hashing = new Transform({
      transform(chunk, encoding, done) {
        try {
          hash.update(chunk);
          done(null, chunk);
        } catch (error) {
          done(error);
        }
      },
    });

    // Hashing failure rejects the upload: nothing is stored and no digest is reported.
    const fail = (error) => {
      if (finished) return;
      finished = true;
      failure = error;
      hashing.destroy();
      output.destroy();
      if (cleanupStarted) return;
      cleanupStarted = true;
      const unlink = () => fs.unlink(target, (unlinkError) => cb(failure || unlinkError));
      if (output.closed) unlink();
      else output.once('close', unlink);
    };

    file.stream.once('limit', () => {
      fail(new multer.MulterError('LIMIT_FILE_SIZE', file.fieldname));
    });
    file.stream.once('error', fail);
    hashing.once('error', fail);
    output.once('error', fail);
    const complete = () => {
      if (!sourceClosed || !outputFinished) return;
      if (finished) return;
      finished = true;
      cb(null, {
        destination: evidenceDir,
        filename,
        path: target,
        sha256: hash.digest('hex'),
        size: output.bytesWritten,
      });
    };
    file.stream.once('close', () => {
      sourceClosed = true;
      complete();
    });
    output.once('finish', () => {
      outputFinished = true;
      complete();
    });
    file.stream.pipe(hashing).pipe(output);
  },

  _removeFile(req, file, cb) {
    if (!file.path) return cb(null);
    fs.unlink(file.path, (error) => cb(error && error.code !== 'ENOENT' ? error : null));
  },
};

function createUpload(limits) {
  const requested = limits || {};
  return multer({
    storage: hashingEvidenceStorage,
    limits: {
      ...requested,
      fileSize: Math.min(requested.fileSize ?? MAX_FILE_SIZE, MAX_FILE_SIZE),
      files: requested.files ?? 1,
      fields: requested.fields ?? 10,
    },
  });
}

module.exports = { evidenceStorage, hashingEvidenceStorage, evidenceDir, createUpload };
