# YouTube Analytics (Agent Loader)

This project fetches the latest 28-day performance metrics for every public video on an authenticated YouTube channel, enriches each entry with metadata, and stores it as JSON ready for downstream agents in your workflow.

## What it does
- Exchanges a stored refresh token for a short-lived access token.
- Calls the YouTube Analytics API for per-video metrics (views, watch time, engagement).
- Fetches YouTube Data API metadata (published date, description, tags) and filters out non-public videos.
- Normalizes the results into a common schema and writes them to `data/analytics/YYYY-MM-DD-youtube-analytics.json`.
- Provides a GitHub Actions workflow that runs daily, refreshes the analytics JSON, and uploads the latest file to your OpenAI Vector Store for Agent Builder File Search.

## Local setup
```bash
cp .env.sample .env       # fill in values
npm install
npm run yt:analytics      # outputs data/analytics/YYYY-MM-DD-youtube-analytics.json
```

### Required environment variables
Populate these in `.env` (and in GitHub Actions secrets):

| Key | Purpose |
| --- | --- |
| `YT_CLIENT_ID` | OAuth client ID for the Google project. |
| `YT_CLIENT_SECRET` | OAuth client secret. |
| `YT_REFRESH_TOKEN` | Long-lived refresh token generated for the channel. |
| `YT_API_KEY` | (Optional) Reserved for future metadata joins. |
| `OPENAI_API_KEY` | Grants the workflow permission to upload files to OpenAI. |
| `VS_ID` | Identifier of the target OpenAI Vector Store. |

> **Note:** The refresh token must be authorized with both `yt-analytics.readonly` and `youtube.readonly` scopes so the script can collect metrics and metadata.
### Getting a refresh token (desktop client)
If you only have a desktop-type OAuth client, run:
```bash
npm run yt:get-refresh-token
```
This script launches a temporary local server, prints an authorization URL, and captures the redirect with the OAuth code. Sign in with the channel account, approve the `yt-analytics.readonly` and `youtube.readonly` scopes, then copy the refresh token shown in the terminal into `.env` under `YT_REFRESH_TOKEN`.

If the redirect fails (e.g., the browser can’t reach `127.0.0.1`), copy the full redirect URL from the browser’s address bar and run:
```bash
npm run yt:get-refresh-token -- --code="<code from url>" --redirect-uri="http://127.0.0.1:PORT/oauth2callback"
```
Replace `PORT` with the port shown in the URL you copied. The script will exchange the code directly and print the refresh token.

## GitHub Actions
The workflow at `.github/workflows/analytics.yml` runs every day at 06:30 UTC (and on manual dispatch). It:
1. Installs dependencies and runs `npm run yt:analytics`.
2. Uploads the newest analytics JSON to OpenAI Files (`purpose=assistants`).
3. Attaches the uploaded file to the configured Vector Store so agents using File Search see the freshest data.

Add these secrets in the repository settings so the workflow can authenticate:
- `YT_CLIENT_ID`
- `YT_CLIENT_SECRET`
- `YT_REFRESH_TOKEN`
- `OPENAI_API_KEY`
- `VS_ID`

Once the workflow is live, connect the same Vector Store in Agent Builder (Tools → File Search) so your agents always read the latest `*-youtube-analytics.json`.
