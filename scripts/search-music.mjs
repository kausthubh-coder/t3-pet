// Lists HeyGen music-catalog matches for a few moods (uses ~/.heygen/credentials via media-use's helper).
// Usage: node search-music.mjs "query one" "query two" ...
//        node search-music.mjs --url <id> "query"   (print the download URL of one result)
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const lib = path.join(os.homedir(), '.claude/skills/media-use/audio/scripts/lib/heygen.mjs');
const { searchSounds, heygenAuthHeaders } = await import(pathToFileURL(lib).href);
const headers = heygenAuthHeaders();
const args = process.argv.slice(2);
const type = args[0] === '--sfx' ? (args.shift(), 'sound_effects') : 'music';
const wantUrl = args[0] === '--url' ? args.splice(0, 2)[1] : null;
for (const q of args) {
  const results = await searchSounds(q, type, headers, type === 'music' ? { limit: 6 } : { limit: 6, minScore: 0.4 });
  if (wantUrl) {
    const r = results.find((x) => x.id === wantUrl);
    console.log(r ? r.audio_url : 'not found');
    continue;
  }
  console.log(`\n== ${q}`);
  for (const r of results) {
    console.log(`${(r.score ?? 0).toFixed(2)}  ${Math.round(r.duration ?? 0)}s  ${r.id ?? ''}  ${(r.name || r.title || '').slice(0, 50)} | ${(r.description || '').slice(0, 140)}`);
  }
}
