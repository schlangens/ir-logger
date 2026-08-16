const router = require('express').Router();
const fs = require('node:fs');
const path = require('node:path');

// The v1 desktop tool (`ir-logger.py`, repo root) is offered as a direct
// download from the landing page. Served the same way evidence downloads
// are (`src/routes/evidence.js`): forced `application/octet-stream` +
// `Content-Disposition: attachment` with a fixed, sensible filename, so the
// browser always saves the file rather than trying to render Python source
// as text inline.
router.get('/downloads/ir-logger.py', (req, res, next) => {
  const filePath = path.join(__dirname, '../../ir-logger.py');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.set({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': 'attachment; filename="ir-logger.py"',
  });
  const stream = fs.createReadStream(filePath);
  stream.on('error', (error) => {
    if (!res.headersSent) next(error);
    else res.destroy(error);
  });
  stream.pipe(res);
});

module.exports = router;
