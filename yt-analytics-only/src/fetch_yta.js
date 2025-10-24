import dotenv from 'dotenv';
import { subDays, format } from 'date-fns';
import { fetch } from 'undici';
import { ensureDir, saveStandardJson, standardize } from './utils.js';

dotenv.config();

const REQUIRED_ENV = ['YT_CLIENT_ID', 'YT_CLIENT_SECRET', 'YT_REFRESH_TOKEN'];

function assertEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

async function exchangeRefreshToken() {
  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const body = new URLSearchParams({
    client_id: process.env.YT_CLIENT_ID,
    client_secret: process.env.YT_CLIENT_SECRET,
    refresh_token: process.env.YT_REFRESH_TOKEN,
    grant_type: 'refresh_token',
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
    console.error(`Failed to refresh access token (${response.status}): ${errorBody}`);
    process.exit(1);
  }

  const data = await response.json();
  if (!data.access_token) {
    console.error('Access token not present in refresh token response.');
    process.exit(1);
  }

  return data.access_token;
}

async function fetchAnalytics(accessToken) {
  const baseUrl = 'https://youtubeanalytics.googleapis.com/v2/reports';
  const today = new Date();
  const startDate = format(subDays(today, 28), 'yyyy-MM-dd');
  const endDate = format(today, 'yyyy-MM-dd');

  const url = new URL(baseUrl);
  url.searchParams.set('ids', 'channel==MINE');
  url.searchParams.set('startDate', startDate);
  url.searchParams.set('endDate', endDate);
  url.searchParams.set('dimensions', 'video');
  url.searchParams.set(
    'metrics',
    [
      'views',
      'estimatedMinutesWatched',
      'averageViewDuration',
      'comments',
      'likes',
      'shares',
    ].join(',')
  );
  url.searchParams.set('sort', '-views');
  url.searchParams.set('maxResults', '200');

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Failed to fetch analytics (${response.status}): ${errorBody}`);
    process.exit(1);
  }

  const payload = await response.json();
  return payload;
}

function transformRows(columnHeaders = [], rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const headerIndex = new Map();
  columnHeaders.forEach((header, index) => {
    if (header?.name) {
      headerIndex.set(header.name, index);
    }
  });

  const getNumber = (row, key) => {
    const idx = headerIndex.get(key);
    if (idx === undefined) return 0;
    const value = row[idx];
    const num = Number(value);
    return Number.isNaN(num) ? 0 : num;
  };

  const getString = (row, key) => {
    const idx = headerIndex.get(key);
    if (idx === undefined) return '';
    const value = row[idx];
    return typeof value === 'string' ? value : String(value ?? '');
  };

  return rows.map((row) => {
    const videoId = getString(row, 'video');
    const watchTimeMinutes = getNumber(row, 'estimatedMinutesWatched');
    const averageViewDuration = getNumber(row, 'averageViewDuration');

    return {
      videoId,
      metrics: {
        views: getNumber(row, 'views'),
        watch_time_minutes: watchTimeMinutes,
        watch_time_seconds: watchTimeMinutes * 60,
        average_view_duration_sec: averageViewDuration,
        likes: getNumber(row, 'likes'),
        comments: getNumber(row, 'comments'),
        shares: getNumber(row, 'shares'),
      },
    };
  });
}

async function fetchVideoMetadata(accessToken, videoIds) {
  if (!videoIds.length) {
    return new Map();
  }

  const endpoint = 'https://www.googleapis.com/youtube/v3/videos';
  const result = new Map();
  const chunkSize = 50;

  for (let i = 0; i < videoIds.length; i += chunkSize) {
    const chunk = videoIds.slice(i, i + chunkSize);
    const url = new URL(endpoint);
    url.searchParams.set('part', 'snippet,status');
    url.searchParams.set('id', chunk.join(','));

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Failed to fetch video metadata (${response.status}): ${errorBody}`);
      process.exit(1);
    }

    const payload = await response.json();
    payload.items?.forEach((item) => {
      if (!item?.id) return;
      const snippet = item.snippet ?? {};
      const status = item.status ?? {};
      result.set(item.id, {
        title: snippet.title ?? null,
        description: snippet.description ?? null,
        tags: Array.isArray(snippet.tags) ? snippet.tags : [],
        publishedAt: snippet.publishedAt ?? null,
        privacyStatus: status.privacyStatus ?? null,
      });
    });
  }

  return result;
}


async function main() {
  try {
    assertEnv();
    await ensureDir('data/analytics');
    const accessToken = await exchangeRefreshToken();
    const analyticsPayload = await fetchAnalytics(accessToken);
    const rawRecords = transformRows(analyticsPayload.columnHeaders, analyticsPayload.rows);

    const videoIds = rawRecords.map((entry) => entry.videoId).filter(Boolean);
    const metadataMap = await fetchVideoMetadata(accessToken, videoIds);

    const records = rawRecords
      .map(({ videoId, metrics }) => {
        const meta = metadataMap.get(videoId);
        if (meta?.privacyStatus && meta.privacyStatus !== 'public') {
          return null;
        }

        return standardize({
          platform: 'youtube',
          post_id: videoId,
          permalink: `https://www.youtube.com/watch?v=${videoId}`,
          created_at: meta?.publishedAt ?? null,
          text: meta?.description ?? null,
          hashtags: meta?.tags ?? [],
          metrics,
          extra: meta?.title ? { title: meta.title } : {},
        });
      })
      .filter(Boolean);

    const filePath = await saveStandardJson('youtube', records);
    console.log(`Saved ${records.length} records to ${filePath}`);
  } catch (error) {
    console.error(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
