import { format } from 'date-fns';
import fsExtra from 'fs-extra';
import { join } from 'node:path';

const { ensureDir: ensureFsDir, writeJson } = fsExtra;

export async function ensureDir(dirPath) {
  await ensureFsDir(dirPath);
}

export function standardize({
  platform,
  post_id,
  permalink,
  created_at = null,
  text = null,
  hashtags = [],
  metrics = {},
  extra = {},
}) {
  return {
    platform,
    post_id,
    permalink,
    created_at,
    text,
    hashtags,
    metrics,
    extra,
  };
}

export async function saveStandardJson(platform, records) {
  const analyticsDir = join(process.cwd(), 'data', 'analytics');
  await ensureDir(analyticsDir);
  const stamp = format(new Date(), 'yyyy-MM-dd');
  const filePath = join(analyticsDir, `${stamp}-${platform}-analytics.json`);
  await writeJson(filePath, records, { spaces: 2 });
  return filePath;
}
