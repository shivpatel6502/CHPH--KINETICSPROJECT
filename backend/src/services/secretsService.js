/**
 * AWS Secrets Manager wrapper.
 * In production, the Anthropic API key lives here — never in code or env files.
 */
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const logger = require('../utils/logger');

const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });
let _cachedKey = null;

async function getApiKey() {
  if (_cachedKey) return _cachedKey;
  if (process.env.ANTHROPIC_API_KEY) {
    // Local dev shortcut
    _cachedKey = process.env.ANTHROPIC_API_KEY;
    return _cachedKey;
  }
  try {
    const cmd = new GetSecretValueCommand({ SecretId: process.env.AWS_SECRET_NAME });
    const res = await client.send(cmd);
    const parsed = JSON.parse(res.SecretString);
    _cachedKey = parsed.ANTHROPIC_API_KEY;
    logger.info('API key loaded from Secrets Manager');
    return _cachedKey;
  } catch (err) {
    logger.error('Failed to load secret from Secrets Manager', err);
    throw new Error('Could not retrieve API key');
  }
}

module.exports = { getApiKey };
