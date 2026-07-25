const express = require('express');
const { validateAuditUrl } = require('../utils/validator');
const { auditUrl } = require('../services/auditService');

const router = express.Router();

// POST /v1/audit  { "url": "https://example.com" }
router.post('/audit', async (req, res, next) => {
  try {
    const cleanUrl = validateAuditUrl(req.body?.url);
    const result = await auditUrl(cleanUrl, req.requestId);
    res.status(200).json({ data: result, requestId: req.requestId });
  } catch (err) {
    next(err);
  }
});

router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', requestId: req.requestId });
});

module.exports = router;
