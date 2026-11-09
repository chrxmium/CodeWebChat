import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { defineConfig, type Plugin, type UserConfig } from 'vite'

const node_targets: Record<string, string> = {
  extension: 'src/extension.ts',
  'websocket-server-process': 'src/services/websocket-server-process.ts'
}

const view_targets: Record<string, string> = {
  prompt: 'src/views/prompt/frontend/App.tsx',
  settings: 'src/views/settings/frontend/App.tsx',
  chats: 'src/views/chats/frontend/App.tsx'
}

const root_dir = __dirname
const src_dir = path.resolve(root_dir, 'src')
const shared_dir = path.resolve(root_dir, '../../packages/shared/src')
const ui_dir = path.resolve(root_dir, '../../packages/ui/src')

const create_common_build = (
  is_production: boolean
): NonNullable<UserConfig['build']> => ({
  outDir: path.resolve(root_dir, 'out'),
  emptyOutDir: false,
  target: 'es2022',
  minify: is_production,
  sourcemap: !is_production,
  reportCompressedSize: false
})

const copy_readme = (): Plugin => {
  const source = path.resolve(root_dir, '../../README.md')
  const destination = path.resolve(root_dir, 'README.md')
  return {
    name: 'copy-readme',
    buildStart() {
      this.addWatchFile(source)
    },
    writeBundle() {
      const content = fs
        .readFileSync(source, 'utf8')
        .split('\n')
        .slice(12)
        .filter(
          (line) =>
            !['> [!TIP]', '> [!IMPORTANT]', '> [!NOTE]'].includes(line.trim())
        )
        .join('\n')
      fs.writeFileSync(destination, content)
    }
  }
}

const svg_as_component = (): Plugin => ({
  name: 'svg-as-component',
  enforce: 'pre',
  load(id) {
    const file = id.split('?')[0]
    if (!file.endsWith('.svg')) return null

    const source = fs
      .readFileSync(file, 'utf8')
      .replace(/<\?xml[\s\S]*?\?>/g, '')
      .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .trim()

    const match = source.match(/^<svg([\s\S]*?)>([\s\S]*)<\/svg>$/i)
    if (!match) {
      this.error(`Unsupported SVG structure: ${file}`)
    }

    const attributes: Record<string, string> = {}
    const attribute_regex = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
    let attribute_match: RegExpExecArray | null
    while ((attribute_match = attribute_regex.exec(match![1])) !== null) {
      const name = attribute_match[1]
      if (name == 'style') continue // inline style strings are not valid React props
      const react_name =
        name == 'class'
          ? 'className'
          : name.replace(/[-:](\w)/g, (_, char: string) => char.toUpperCase())
      attributes[react_name] = attribute_match[2] ?? attribute_match[3]
    }

    return {
      code: [
        `import { createElement } from 'react'`,
        `const attributes = ${JSON.stringify(attributes)}`,
        `const html = ${JSON.stringify(match![2])}`,
        `const SvgComponent = (props) =>`,
        `  createElement('svg', {`,
        `    ...attributes,`,
        `    ...props,`,
        `    dangerouslySetInnerHTML: { __html: html }`,
        `  })`,
        `export default SvgComponent`
      ].join('\n'),
      map: null
    }
  }
})

const generate_scoped_name = (local_name: string, filename: string) => {
  const file = filename.split('?')[0]
  const relative_file = path.relative(root_dir, file).replace(/\\/g, '/')
  const module_name = path.basename(file).replace(/\.module\.(scss|css)$/i, '')
  const hash = crypto
    .createHash('md5')
    .update(`${relative_file}${local_name}`)
    .digest('hex')
    .substring(0, 5)
  return `${module_name}__${local_name}__${hash}`
}

// Extension host (Node.js environment)
const create_node_config = (
  name: string,
  entry: string,
  is_production: boolean
): UserConfig => ({
  publicDir: false,
  plugins: [...(name == 'extension' ? [copy_readme()] : [])],
  define: {
    'process.env.NODE_ENV': JSON.stringify(
      is_production ? 'production' : 'development'
    ),
    'require.resolve': 'undefined'
  },
  resolve: {
    alias: {
      '@': src_dir,
      '@cwc/core': path.resolve(root_dir, '../../packages/core/src'),
      '@shared': shared_dir
    }
  },
  // Bundle all dependencies, only `vscode` and Node.js built-ins stay external
  ssr: { noExternal: true },
  build: {
    ...create_common_build(is_production),
    ssr: true,
    rolldownOptions: {
      input: { [name]: path.resolve(root_dir, entry) },
      external: ['vscode', 'utf-8-validate', 'canvas'],
      output: {
        format: 'cjs',
        exports: 'named',
        entryFileNames: '[name].js',
        codeSplitting: false
      }
    }
  }
})

// Webviews (Web environment)
const create_view_config = (
  name: string,
  entry: string,
  is_production: boolean
): UserConfig => ({
  publicDir: false,
  plugins: [svg_as_component()],
  define: {
    'process.env.NODE_ENV': JSON.stringify(
      is_production ? 'production' : 'development'
    )
  },
  resolve: {
    alias: {
      '@': src_dir,
      '@cwc/core': path.resolve(root_dir, '../../packages/core/src'),
      '@shared': shared_dir,
      '@ui': ui_dir
    }
  },
  oxc: {
    jsx: { runtime: 'automatic' }
  },
  css: {
    modules: {
      generateScopedName: generate_scoped_name
    },
    preprocessorOptions: {
      scss: {
        additionalData: `@use "${path
          .resolve(ui_dir, 'styles/foundation')
          .replace(/\\/g, '/')}" as *;`
      }
    }
  },
  build: {
    ...create_common_build(is_production),
    lib: {
      entry: path.resolve(root_dir, entry),
      name: `cwc_${name}`,
      formats: ['iife'],
      cssFileName: name
    },
    rolldownOptions: {
      output: {
        entryFileNames: `${name}.js`
      }
    }
  }
})

export default defineConfig(({ mode }) => {
  const target = process.env.CWC_TARGET ?? ''
  const is_production = mode == 'production'

  if (Object.hasOwn(node_targets, target)) {
    return create_node_config(target, node_targets[target], is_production)
  }
  if (Object.hasOwn(view_targets, target)) {
    return create_view_config(target, view_targets[target], is_production)
  }
  throw new Error(
    `Unknown CWC_TARGET "${target}". Build with "node scripts/build.mjs".`
  )
})
