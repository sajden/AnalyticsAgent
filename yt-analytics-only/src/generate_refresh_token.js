import dotenv from 'dotenv';
import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { fetch } from 'undici';
import { URL } from 'node:url';

dotenv.config();

const REQUIRED = ['YT_CLIENT_ID', 'YT_CLIENT_SECRET'];

function assertEnv() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

function choosePort() {
  // Pick a random high port to reduce collision risk.
  return randomInt(49152, 65535);
}

async function exchangeCode({ code, clientId, clientSecret, redirectUri }) {
  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${errorBody}`);
  }

  const payload = await response.json();
  if (!payload.refresh_token) {
    throw new Error('No refresh_token returned. Try adding prompt=consent or ensuring access_type=offline.');
  }
  return payload;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const [key, value] = arg.split('=');
      const name = key.replace(/^--/, '');
      if (value !== undefined) {
        result[name] = value;
      } else if (i + 1 < args.length) {
        result[name] = args[i + 1];
        i += 1;
      } else {
        result[name] = true;
      }
    }
  }
  return result;
}

async function main() {
  assertEnv();

  const clientId = process.env.YT_CLIENT_ID;
  const clientSecret = process.env.YT_CLIENT_SECRET;
  const args = parseArgs();

  if (args.code) {
    const redirectUri = args['redirect-uri'] || args.redirect || 'urn:ietf:wg:oauth:2.0:oob';
    console.log(`Exchanging provided code using redirect URI: ${redirectUri}`);
    try {
      const tokens = await exchangeCode({
        code: args.code,
        clientId,
        clientSecret,
        redirectUri,
      });
      console.log('\nRefresh token retrieved successfully:\n');
      console.log(tokens.refresh_token);
      console.log('\nCopy this value into .env as YT_REFRESH_TOKEN.\n');
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    return;
  }

  const port = choosePort();
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const scopes = [
    'https://www.googleapis.com/auth/yt-analytics.readonly',
    'https://www.googleapis.com/auth/youtube.readonly',
  ];

  const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', scopes.join(' '));
  authorizeUrl.searchParams.set('access_type', 'offline');
  authorizeUrl.searchParams.set('prompt', 'consent');

  console.log('\nAuthorize this application by visiting:\n');
  console.log(authorizeUrl.toString());
  console.log('\nAfter approving access, you will be redirected to a local URL and this script will capture the code automatically.\n');

  const server = createServer(async (req, res) => {
    if (!req.url) return;
    const url = new URL(req.url, `http://127.0.0.1:${port}`);

    if (url.pathname !== '/oauth2callback') {
      res.writeHead(404);
      res.end();
      return;
    }

    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Authorization failed. You can close this window.');
      console.error(`Authorization error: ${error}`);
      server.close();
      process.exit(1);
      return;
    }

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing authorization code. You can close this window.');
      console.error('Missing authorization code.');
      server.close();
      process.exit(1);
      return;
    }

    try {
      const tokens = await exchangeCode({ code, clientId, clientSecret, redirectUri });
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Authorization complete. You can close this window.');
      console.log('\nRefresh token retrieved successfully:\n');
      console.log(tokens.refresh_token);
      console.log('\nCopy this value into .env as YT_REFRESH_TOKEN.\n');
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Token exchange failed. Check the terminal for details.');
      console.error(err.message);
      process.exitCode = 1;
    } finally {
      server.close();
    }
  });

  server.listen(port, () => {
    console.log(`Listening on http://127.0.0.1:${port}/oauth2callback for the OAuth redirect...`);
  });
}

main().catch((error) => {
  console.error(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
