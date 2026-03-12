//@ts-check
'use strict';

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const production = process.argv.includes('--production');
const dev = process.argv.includes('--dev');
const pkgDir = __dirname;

/** @param {...string} parts */
function out(...parts) {
  return path.join(pkgDir, 'out', ...parts);
}

/** @param {...string} parts */
function src(...parts) {
  return path.join(pkgDir, 'src', ...parts);
}

/** @type {import('esbuild').BuildOptions} */
const base = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const mainConfig = {
  ...base,
  entryPoints: [src('main/index.ts')],
  platform: 'node',
  format: 'cjs',
  outfile: out('main/index.js'),
  external: ['electron', 'better-sqlite3', 'playwright-core', 'fsevents'],
  absWorkingDir: pkgDir,
};

/** @type {import('esbuild').BuildOptions} */
const preloadConfig = {
  ...base,
  entryPoints: [src('preload/index.ts')],
  platform: 'node',
  format: 'cjs',
  outfile: out('preload/index.js'),
  external: ['electron'],
  absWorkingDir: pkgDir,
};

/** @type {import('esbuild').BuildOptions} */
const rendererConfig = {
  ...base,
  entryPoints: [src('renderer/index.tsx')],
  platform: 'browser',
  format: 'iife',
  outfile: out('renderer/index.js'),
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
  absWorkingDir: pkgDir,
};

async function build() {
  // Copy static renderer files
  fs.mkdirSync(out('renderer'), { recursive: true });
  fs.copyFileSync(src('renderer/index.html'),  out('renderer/index.html'));
  fs.copyFileSync(src('renderer/splash.html'), out('renderer/splash.html'));
  fs.mkdirSync(out('renderer'), { recursive: true });
  // Copy CSS (esbuild handles JS/TS; we copy CSS manually)
  const cssFile = src('renderer/styles/global.css');
  if (fs.existsSync(cssFile)) {
    fs.copyFileSync(cssFile, out('renderer/styles.css'));
  }

  if (dev) {
    // Watch mode — all three in parallel
    const [mainCtx, preloadCtx, rendererCtx] = await Promise.all([
      esbuild.context(mainConfig),
      esbuild.context(preloadConfig),
      esbuild.context(rendererConfig),
    ]);
    await Promise.all([mainCtx.watch(), preloadCtx.watch(), rendererCtx.watch()]);
    console.log('[watch] watching all targets...');
  } else {
    await Promise.all([
      esbuild.build(mainConfig),
      esbuild.build(preloadConfig),
      esbuild.build(rendererConfig),
    ]);
    console.log('[build] all targets complete');
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
