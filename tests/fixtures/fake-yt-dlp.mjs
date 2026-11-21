// Stands in for yt-dlp in the YouTube helper's tests: "downloads" a tiny file.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = args[args.indexOf('-P') + 1];
const id = new URL(args[args.length - 1]).searchParams.get('v');

if (id === 'unavailabl1') {
  console.error(`ERROR: [youtube] ${id}: Video unavailable. This video has been removed by the uploader`);
  process.exit(1);
}
if (id === 'toolongvid1') process.exit(0); // skipped by --match-filter: nothing printed
if (id === 'slowvideo01') setTimeout(() => {}, 60000); // never finishes on its own

if (id !== 'slowvideo01') {
  const file = path.join(dir, `${id}.m4a`);
  fs.writeFileSync(file, `fake audio ${id}`);
  console.log(file);
  console.log('Für Elise – Piano (Official Video)');
}
