const required = [
  'MCP_PUBLIC_ORIGIN',
  'FRAMEFORGE_WEB_URL',
  'FRAMEFORGE_API_BASE',
];

const authMode = (process.env.AUTH_MODE || 'oauth').toLowerCase();
if (authMode === 'oauth') required.push('OAUTH_ISSUER', 'OAUTH_JWKS_URL', 'OAUTH_AUDIENCE');
if ((process.env.FRAMEFORGE_BACKEND_AUTH_MODE || 'forward').toLowerCase() === 'service') {
  required.push('FRAMEFORGE_SERVICE_TOKEN');
}

const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

for (const key of ['MCP_PUBLIC_ORIGIN', 'FRAMEFORGE_WEB_URL', 'FRAMEFORGE_API_BASE']) {
  try {
    const u = new URL(process.env[key]);
    if (process.env.NODE_ENV === 'production' && u.protocol !== 'https:') {
      throw new Error('must use https in production');
    }
  } catch (error) {
    console.error(`${key} is invalid: ${error.message}`);
    process.exit(1);
  }
}

if (process.env.ALLOW_UNVERIFIED_BEARER === 'true' && process.env.NODE_ENV === 'production') {
  console.error('ALLOW_UNVERIFIED_BEARER must never be true in production');
  process.exit(1);
}

console.log('FrameForge integration configuration looks valid.');

