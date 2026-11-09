import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const app_dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const out_dir = path.join(app_dir, 'out')
fs.rmSync(out_dir, { recursive: true, force: true })

await build({
  root: app_dir,
  mode: 'production',
  logLevel: 'info',
  publicDir: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  resolve: {
    alias: {
      '@cwc/core': path.resolve(app_dir, '../../packages/core/src'),
      '@shared': path.resolve(app_dir, '../../packages/shared/src')
    }
  },
  ssr: { noExternal: true },
  build: {
    outDir: out_dir,
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    sourcemap: false,
    reportCompressedSize: false,
    ssr: true,
    rolldownOptions: {
      input: { sidecar: path.join(app_dir, 'src/main.ts') },
      external: ['ws', 'bufferutil', 'utf-8-validate'],
      output: {
        format: 'cjs',
        entryFileNames: '[name].js',
        codeSplitting: false
      }
    }
  }
})

fs.chmodSync(path.join(out_dir, 'sidecar.js'), 0o755)
console.log(`[sidecar] built ${path.join(out_dir, 'sidecar.js')}`)
