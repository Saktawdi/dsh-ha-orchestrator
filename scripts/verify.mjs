import assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(root, rel), 'utf8')
const checks = []
async function check(name, fn) { await fn(); checks.push(name); console.log('[verify] ok:', name) }

const pkg = JSON.parse(read('package.json'))
await check('package.json fields', () => {
  assert(pkg.name === 'ha-orchestrator', 'package name')
  assert(pkg.main === 'lib/index.js', 'main')
  assert(Array.isArray(pkg.files) && pkg.files.includes('lib'), 'files.lib')
  assert(pkg.files.includes('.language'), 'files.language')
  assert(pkg.files.includes('cordis.patch.yml'), 'files.cordis.patch.yml')
  assert(pkg.files.includes('docs'), 'files.docs')
  assert(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch === './cordis.patch.yml', 'dsh.bundle.patch')
  assert(pkg.exports && pkg.exports['./cordis.patch.yml'] === './cordis.patch.yml', 'exports.cordis.patch.yml')
  assert(pkg.scripts && typeof pkg.scripts.test === 'string', 'scripts.test')
  assert(pkg.scripts && typeof pkg.scripts.check === 'string', 'scripts.check')
  assert(pkg.scripts && typeof pkg.scripts.verify === 'string', 'scripts.verify')
})

await check('cordis.patch.yml minimal parse', () => {
  assert(existsSync(join(root, 'cordis.patch.yml')), 'file missing')
  const lines = read('cordis.patch.yml').split(/\r?\n/)
  const insertIndex = lines.findIndex((line) => line.trim() === '- insert:')
  assert(insertIndex >= 0, 'missing top-level - insert:')
  let current = null
  const rows = []
  for (let i = insertIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]
    const row = line.match(/^    - id:\s*(.+)$/)
    const name = line.match(/^      name:\s*(.+)$/)
    if (row) { current = { id: row[1] }; rows.push(current) }
    else if (name && current) current.name = name[1]
    else if (/^\S/.test(line)) break
  }
  assert(rows.length >= 1 && rows[0].id === 'ha-orchestrator' && rows[0].name === 'ha-orchestrator', 'row id/name mismatch')
})

await check('language packs', () => {
  const zh = JSON.parse(read('.language/zh.json'))
  const en = JSON.parse(read('.language/en.json'))
  assert(zh && typeof zh === 'object' && !Array.isArray(zh), 'zh shape')
  assert(en && typeof en === 'object' && !Array.isArray(en), 'en shape')
  for (const [file, dict] of [['zh', zh], ['en', en]]) {
    for (const [k, v] of Object.entries(dict)) assert(typeof v === 'string', `${file}.${k} not string`)
  }
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort(), 'key parity')
})

await check('pure module smoke', async () => {
  const config = await import('../lib/config.js')
  assert(Array.isArray(config.defaultConfig.ha.backups) && config.defaultConfig.ha.backups.length === 0, 'config default backups')
  assert.equal(config.sanitizeConfig({ ha: { cooldownMs: 0 } }, config.defaultConfig).ha.cooldownMs, 1000, 'config clamp')

  const ha = await import('../lib/ha-core.js')
  const state = ha.createHaState()
  const cfg = { cooldownMs: 60000, threshold: 1, backups: [{ provider: 'p1', model: 'm1' }] }
  ha.bumpFailure(state, cfg, ha.keyOf('p0', 'm0'), 1000)
  assert.equal(state.failures.get('p0\u0000m0').count, 1, 'ha bump')
  const picked = ha.pickFallback(state, cfg, [], 'a1', null, 1000)
  assert.equal(picked.provider, 'p1', 'ha fallback')

  const orch = await import('../lib/orch-runner.js')
  assert.equal(orch.resolveMode(), 'fanout', 'orch mode')
  assert.equal(orch.truncateTasks([1, 2, 3], 2).length, 2, 'orch truncate')
  const pooled = await orch.poolRun([{ id: 1 }, { id: 2 }], 2, async (item) => ({ id: item.id }))
  assert.deepEqual(pooled.map((r) => r.id), [1, 2], 'orch pool order')

  const lang = await import('../lib/language.js')
  assert.equal(lang.resolveTarget('auto', 'en'), 'en', 'lang resolve')
  assert.deepEqual(lang.parseDictModule('{"a":"b"}'), { a: 'b' }, 'lang parse')

  const remote = await import('../lib/remote.js')
  const initializers = []
  let seen = null
  const fakeRemote = (exportName) => (value, context) => {
    seen = { exportName, context, value }
    context.addInitializer(function () { this.marked = true })
  }
  class Svc { ping() { return 'ok' } }
  remote.decorateRemoteMethod(fakeRemote, Svc, 'ping', 'pingRpc', initializers)
  assert.equal(seen.exportName, 'pingRpc', 'remote exportName')
  assert.equal(seen.context.kind, 'method', 'remote context kind')
  assert.equal(seen.context.name, 'ping', 'remote context name')
  assert.equal(seen.context.static, false, 'remote context static')
  assert.equal(seen.context.private, false, 'remote context private')
  assert.equal(seen.context.access.get(Svc.prototype), Svc.prototype.ping, 'remote access.get')
  if (typeof Symbol === 'function' && Symbol.metadata) assert(seen.context.metadata && typeof seen.context.metadata === 'object', 'remote metadata')
  const svc = new Svc()
  remote.runInitializers(svc, initializers)
  assert.equal(svc.marked, true, 'remote initializer')
  assert.equal(svc.ping(), 'ok', 'method intact')
})

await check('npm pack dry-run', () => {
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const stdout = execFileSync(npmBin, ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: true })
  const info = JSON.parse(stdout)
  const files = (info[0] && info[0].files || []).map((f) => f.path)
  for (const required of ['cordis.patch.yml', '.language/zh.json', '.language/en.json', 'lib/index.js', 'lib/client.js', 'lib/config.js', 'lib/ha-core.js', 'lib/orch-runner.js', 'lib/remote.js', 'README.md', 'README.zh-CN.md', 'CHANGELOG.md']) {
    assert(files.includes(required), `missing packed file: ${required}`)
  }
})

console.log(`[verify] ${checks.length} checks passed`)
