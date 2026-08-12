const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const multer = require('multer');

const MB = 1024 * 1024;

function loadStorage(directory) {
  process.env.EVIDENCE_DIR = directory;
  const modulePath = require.resolve('../../src/uploads/storage');
  delete require.cache[modulePath];
  return require(modulePath);
}

function uploadApp(storage, limits) {
  const app = express();
  const upload = multer({ storage, limits });
  app.post('/upload', upload.single('file'), (req, res) => res.json({ file: req.file }));
  app.use((error, req, res, next) => {
    if (error) return res.status(500).json({ error: error.message, code: error.code });
    next();
  });
  return app;
}

function deterministicBytes(length) {
  const bytes = Buffer.alloc(length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 17) % 256;
  return bytes;
}

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ir-logger-evidence-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('hashes the exact multi-chunk bytes persisted to disk', async (t) => {
  const storage = loadStorage(temporaryDirectory(t)).hashingEvidenceStorage;
  const payload = deterministicBytes(512 * 1024 + 123);
  const response = await request(uploadApp(storage)).post('/upload').attach('file', payload, 'sample.bin');
  assert.equal(response.status, 200);
  const file = response.body.file;
  const onDisk = fs.readFileSync(file.path);
  assert.equal(file.sha256, crypto.createHash('sha256').update(onDisk).digest('hex'));
  assert.equal(file.size, fs.statSync(file.path).size);
});

test('rejects oversized uploads and leaves the evidence directory empty', async (t) => {
  const directory = temporaryDirectory(t);
  const loaded = loadStorage(directory);
  assert.ok(loaded.hashingEvidenceStorage);
  const storage = loaded.hashingEvidenceStorage;
  const response = await request(uploadApp(storage, { fileSize: 32 })).post('/upload')
    .attach('file', Buffer.alloc(1024), 'too-large.bin');
  assert.equal(response.status, 500);
  assert.equal(response.body.code, 'LIMIT_FILE_SIZE');
  assert.equal(response.body.file?.sha256, undefined);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('rejects mid-stream hashing failures without retaining a file', async (t) => {
  const directory = temporaryDirectory(t);
  const storage = loadStorage(directory).hashingEvidenceStorage;
  const originalCreateHash = crypto.createHash;
  crypto.createHash = () => {
    let updates = 0;
    return {
      update() {
        updates += 1;
        if (updates > 1) throw new Error('hashing failed');
        return this;
      },
      digest() {
        return 'unreported';
      },
    };
  };
  t.after(() => { crypto.createHash = originalCreateHash; });
  const response = await request(uploadApp(storage)).post('/upload')
    .attach('file', deterministicBytes(512 * 1024), 'fails.bin');
  assert.equal(response.status, 500);
  assert.match(response.body.error, /hashing failed/);
  assert.equal(response.body.file?.sha256, undefined);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('caps requested limits and preserves the plain disk-storage export', async (t) => {
  const directory = temporaryDirectory(t);
  const storage = loadStorage(directory);
  const upload = storage.createUpload({ fileSize: Infinity });
  assert.equal(upload.limits.fileSize, 25 * MB);
  assert.equal(upload.limits.files, 1);
  assert.equal(upload.limits.fields, 10);
  assert.ok(storage.evidenceStorage);
  const response = await request(uploadApp(storage.evidenceStorage)).post('/upload')
    .attach('file', Buffer.from('plain engine'), 'plain.bin');
  assert.equal(response.status, 200);
  assert.equal(response.body.file.sha256, undefined);
  assert.equal(fs.readFileSync(response.body.file.path, 'utf8'), 'plain engine');
});
