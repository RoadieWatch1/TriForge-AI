//@ts-check
'use strict';

const esbuild = require('esbuild');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const pkgDir = __dirname;

/** @type {import('esbuild').Plugin} */
const watchPlugin = {
  name: 'watch-logger',
  setup(build) {
    build.onStart(() => console.log('[watch] build started'));
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) console.error(`    ${location.file}:${location.line}:${location.column}`);
      }
      console.log('[watch] build finished');
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: [path.join(pkgDir, 'src/extension.ts')],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: path.join(pkgDir, 'out/extension.js'),
    external: ['vscode'],
    absWorkingDir: pkgDir,
    logLevel: 'silent',
    plugins: watch ? [watchPlugin] : [],
  });

  if (watch) {
    await ctx.watch();
    console.log('[watch] watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('[build] complete');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
