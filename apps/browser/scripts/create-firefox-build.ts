import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const manifest_path = path.join(__dirname, '..', 'src', 'manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifest_path, 'utf8'))

const firefox_manifest: any = { ...manifest }
delete firefox_manifest.manifest_version
firefox_manifest.manifest_version = 2

if (firefox_manifest.background && firefox_manifest.background.service_worker) {
  firefox_manifest.background = {
    scripts: [firefox_manifest.background.service_worker],
    persistent: true
  }
}

firefox_manifest.browser_action = firefox_manifest.action
delete firefox_manifest.action

firefox_manifest.permissions = firefox_manifest.permissions.filter(
  (p: string) => p !== 'alarms'
)

firefox_manifest.permissions.push('contextualIdentities')
firefox_manifest.optional_permissions = ['cookies'] // Needed by Firefox Containers

delete firefox_manifest.host_permissions

// Unofficial fork: the Firefox listing is built from this manifest, so the
// attribution is added here only. The Chrome manifest is left untouched.
firefox_manifest.description = `${manifest.description} Unofficial fork of CodeWebChat by Robert Piosik.`

// Stable Add-on ID, required by `web-ext sign` (AMO unlisted) and so that
// `storage.local` survives a `web-ext run` reload.
firefox_manifest.browser_specific_settings = {
  gecko: {
    id: 'cwc-connector-fork@chrxmium.github',
    strict_min_version: '115.0'
  }
}

const firefox_dist_dir = path.join(__dirname, '..', 'dist-firefox')
if (!fs.existsSync(firefox_dist_dir)) {
  fs.mkdirSync(firefox_dist_dir)
}

const dist_dir = path.join(__dirname, '..', 'dist')
fs.cpSync(dist_dir, firefox_dist_dir, { recursive: true })

const firefox_manifest_path = path.join(
  __dirname,
  '..',
  'dist-firefox',
  'manifest.json'
)
fs.writeFileSync(
  firefox_manifest_path,
  JSON.stringify(firefox_manifest, null, 2)
)

console.log('[create-firefox-build] Firefox build created successfully')
