const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const shared = path.join(root, 'shared');
const targets = [path.join(root, 'renderer'), path.join(root, 'web')];

async function build() {
  for (const outDir of targets) {
    fs.mkdirSync(outDir, { recursive: true });

    await esbuild.build({
      entryPoints: [path.join(shared, 'app.js')],
      bundle: true,
      format: 'iife',
      outfile: path.join(outDir, 'app.bundle.js'),
      minify: false,
      logLevel: 'info',
    });

    fs.copyFileSync(path.join(shared, 'index.html'), path.join(outDir, 'index.html'));
    fs.copyFileSync(path.join(shared, 'styles.css'), path.join(outDir, 'styles.css'));
    fs.cpSync(path.join(shared, 'assets'), path.join(outDir, 'assets'), { recursive: true });
  }

  // Public parent lookup page — web/ only, the desktop app doesn't need it.
  const webDir = path.join(root, 'web');
  await esbuild.build({
    entryPoints: [path.join(shared, 'lookup.js')],
    bundle: true,
    format: 'iife',
    outfile: path.join(webDir, 'lookup.bundle.js'),
    minify: false,
    logLevel: 'info',
  });
  fs.copyFileSync(path.join(shared, 'lookup.html'), path.join(webDir, 'lookup.html'));

  console.log('Build complete: renderer/ and web/ are up to date.');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
