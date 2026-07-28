// `electron-builder --publish always` needs GH_TOKEN in the environment, but
// that's only ever set for the lifetime of one shell session — a fresh
// terminal loses it and `npm run release` dies with "GitHub Personal Access
// Token is not set". This wrapper pulls a fresh token from the `gh` CLI's own
// stored login (`gh auth login` once, and it's good until you log out) so
// `npm run release` always has one without you touching env vars.
const { execSync, spawnSync } = require('child_process');

function run(cmd, args, envExtra) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: true, env: { ...process.env, ...envExtra } });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

let token;
try {
  token = execSync('gh auth token', { encoding: 'utf8' }).trim();
} catch {
  console.error('Could not get a GitHub token from the gh CLI. Run `gh auth login` once, then try again.');
  process.exit(1);
}
if (!token) {
  console.error('`gh auth token` returned nothing. Run `gh auth login` once, then try again.');
  process.exit(1);
}

run('node', ['scripts/build.js']);
run('npx', ['electron-builder', '--publish', 'always'], { GH_TOKEN: token });
