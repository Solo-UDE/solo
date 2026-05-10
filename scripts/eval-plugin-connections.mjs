#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dirname, '..');
const sdkRoot = path.join(
  repoRoot,
  'agent-bridge',
  'node_modules',
  '@modelcontextprotocol',
  'sdk',
  'dist',
  'esm',
);

const args = new Set(process.argv.slice(2));

if (args.has('--help') || args.has('-h')) {
  printHelp();
  process.exit(0);
}

const runInstalled = args.has('--installed');
const connectInstalled = args.has('--connect-installed') || args.has('--connect');
const connectRemote = args.has('--connect-remote');
const withCargo = args.has('--with-cargo');
const keepTemp = args.has('--keep');

const { Client } = await import(pathToFileURL(path.join(sdkRoot, 'client/index.js')));
const { StdioClientTransport } = await import(
  pathToFileURL(path.join(sdkRoot, 'client/stdio.js'))
);
const { StreamableHTTPClientTransport } = await import(
  pathToFileURL(path.join(sdkRoot, 'client/streamableHttp.js'))
);
const { SSEClientTransport } = await import(pathToFileURL(path.join(sdkRoot, 'client/sse.js')));

const results = [];

try {
  if (withCargo) {
    runStep('cargo: solo-plugins', () => {
      const cargo = spawnSync('cargo', ['test', '-p', 'solo-plugins'], {
        cwd: repoRoot,
        stdio: 'inherit',
      });
      if (cargo.status !== 0) {
        throw new Error(`cargo test -p solo-plugins exited ${cargo.status ?? 'unknown'}`);
      }
    });
  }

  await runFixtureEval();

  if (runInstalled) {
    await runInstalledEval({ connect: connectInstalled, connectRemote });
  }

  printSummary();
} catch (error) {
  record('fatal', 'fail', error instanceof Error ? error.message : String(error));
  printSummary();
  process.exit(1);
}

function printHelp() {
  console.log(`Usage: node scripts/eval-plugin-connections.mjs [options]

Options:
  --with-cargo          Run cargo test -p solo-plugins before the MCP eval.
  --installed           Also scan real ~/.solo, ~/.codex, and ~/.claude plugin roots.
  --connect-installed   Connect to installed stdio MCP servers and list tools.
  --connect-remote      With --connect-installed, try remote HTTP/SSE MCP servers too.
  --keep                Keep the temporary fixture home for inspection.
  -h, --help            Show this help.

Default behavior is safe and hermetic: it creates temporary fixture plugins for
Solo-native, Codex-cache, and Claude-adapter layouts, then verifies that their
declared MCP servers connect and answer a ping tool call.`);
}

function runStep(name, fn) {
  process.stdout.write(`\n▶ ${name}\n`);
  try {
    const value = fn();
    record(name, 'pass');
    return value;
  } catch (error) {
    record(name, 'fail', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function runAsyncStep(name, fn) {
  process.stdout.write(`\n▶ ${name}\n`);
  try {
    const value = await fn();
    record(name, 'pass');
    return value;
  } catch (error) {
    record(name, 'fail', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

function record(name, status, detail = '') {
  results.push({ name, status, detail });
  const marker = status === 'pass' ? '✓' : status === 'skip' ? '·' : '✕';
  const suffix = detail ? ` — ${detail}` : '';
  console.log(`${marker} ${name}${suffix}`);
}

function printSummary() {
  const failed = results.filter((result) => result.status === 'fail');
  const passed = results.filter((result) => result.status === 'pass');
  const skipped = results.filter((result) => result.status === 'skip');
  console.log('\nPlugin connection eval summary');
  console.log(`  passed: ${passed.length}`);
  console.log(`  skipped: ${skipped.length}`);
  console.log(`  failed: ${failed.length}`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

async function runFixtureEval() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'solo-plugin-eval-'));
  const home = path.join(tempRoot, 'home');
  const workspace = path.join(tempRoot, 'workspace');
  const connectorTokens = new Map([
    ['solo', { accessToken: 'solo-access-token', refreshToken: 'solo-refresh-token' }],
    ['codex', { accessToken: 'codex-access-token', refreshToken: 'codex-refresh-token' }],
    ['claude', { accessToken: 'claude-access-token', refreshToken: 'claude-refresh-token' }],
  ]);

  try {
    await mkdir(home, { recursive: true });
    await mkdir(workspace, { recursive: true });

    await writeFixturePlugin({
      root: path.join(home, '.solo', 'plugins', 'cache', 'local', 'solo-fixture', 'local'),
      manifestDir: '.solo-plugin',
      name: 'solo-fixture',
      displayName: 'Solo Fixture',
      sourceLabel: 'solo',
    });

    await writeFixturePlugin({
      root: path.join(
        home,
        '.codex',
        'plugins',
        'cache',
        'openai-curated',
        'codex-fixture',
        '1.0.0',
      ),
      manifestDir: '.codex-plugin',
      name: 'codex-fixture',
      displayName: 'Codex Fixture',
      sourceLabel: 'codex',
    });

    const claudeRoot = path.join(tempRoot, 'claude-fixture');
    await writeFixturePlugin({
      root: claudeRoot,
      manifestDir: '.claude-plugin',
      name: 'claude-fixture',
      displayName: 'Claude Fixture',
      sourceLabel: 'claude',
    });
    await writeJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), {
      plugins: {
        user: [
          {
            installPath: claudeRoot,
            marketplaceName: 'openai-curated',
          },
        ],
      },
    });

    const plugins = await runAsyncStep('fixture discovery', async () => {
      const discovered = await discoverPlugins(home, {
        includeSolo: true,
        includeCodex: true,
        includeClaude: true,
      });
      const keys = discovered.map((plugin) => plugin.key).sort();
      expectIncludes(keys, 'local/solo-fixture');
      expectIncludes(keys, 'openai-curated/codex-fixture');
      expectIncludes(keys, 'openai-curated/claude-fixture');
      console.log(`  discovered: ${keys.join(', ')}`);
      return discovered;
    });

    await runAsyncStep('fixture skill activation', async () => {
      const skills = await collectPluginSkills(plugins);
      const names = skills.map((skill) => skill.name).sort();
      expectIncludes(names, 'solo-fixture-skill');
      expectIncludes(names, 'codex-fixture-skill');
      expectIncludes(names, 'claude-fixture-skill');
      console.log(`  skills: ${names.join(', ')}`);
    });

    await runAsyncStep('fixture app connector parsing', async () => {
      const apps = await collectPluginApps(plugins);
      const keys = apps.map((app) => `${app.pluginKey}:${app.appId}`).sort();
      expectIncludes(keys, 'local/solo-fixture:solo');
      expectIncludes(keys, 'openai-curated/codex-fixture:codex');
      expectIncludes(keys, 'openai-curated/claude-fixture:claude');
      if (!apps.every((app) => app.supported === true && app.status === 'needs_connection')) {
        throw new Error('fixture app connectors should be recognized by Solo connector runtime');
      }
      console.log(`  apps: ${keys.join(', ')}`);
    });

    const servers = await runAsyncStep('fixture MCP merge', async () => {
      const merged = await collectEnabledMcpServers(plugins, workspace, { connectorTokens });
      const names = Object.keys(merged).sort();
      expectIncludes(names, 'echo');
      expectIncludes(names, 'plugin__openai-curated__codex-fixture__echo');
      expectIncludes(names, 'plugin__local__solo-fixture__echo');
      for (const config of Object.values(merged)) {
        const args = Array.isArray(config.args) ? config.args : [];
        if (args.some((arg) => String(arg).includes('${PLUGIN_ROOT}'))) {
          throw new Error('PLUGIN_ROOT variable was not expanded');
        }
        if (JSON.stringify(config).includes('${workspaceFolder}')) {
          throw new Error('workspaceFolder variable was not expanded');
        }
        if (JSON.stringify(config).includes('${provider:')) {
          throw new Error('provider connector variable was not expanded');
        }
      }
      console.log(`  merged servers: ${names.join(', ')}`);
      return merged;
    });

    for (const [name, config] of Object.entries(servers)) {
      await runAsyncStep(`fixture MCP connect: ${name}`, async () => {
        const result = await connectAndPing(name, config, { callPing: true });
        if (!result.ping?.label) {
          throw new Error('ping response did not include fixture label');
        }
        if (!result.ping?.tokenSeen) {
          throw new Error('fixture MCP server did not receive connector token env');
        }
        console.log(`  tools: ${result.tools.join(', ')}`);
        console.log(`  ping: ${JSON.stringify(result.ping)}`);
      });
    }

    if (keepTemp) {
      record('fixture cleanup', 'skip', `kept ${tempRoot}`);
    }
  } finally {
    if (!keepTemp) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

async function runInstalledEval({ connect, connectRemote }) {
  const home = os.homedir();
  const workspace = process.cwd();
  const plugins = await runAsyncStep('installed discovery', async () => {
    const discovered = await discoverPlugins(home, {
      includeSolo: true,
      includeCodex: true,
      includeClaude: true,
    });
    console.log(`  discovered ${discovered.length} installed plugin(s)`);
    for (const plugin of discovered) {
      const mcp = plugin.mcpPath ? `mcp=${path.relative(home, plugin.mcpPath)}` : 'mcp=none';
      const skills = plugin.skillsPath ? `skills=${path.relative(home, plugin.skillsPath)}` : 'skills=none';
      const apps = plugin.appsPath ? `apps=${path.relative(home, plugin.appsPath)}` : 'apps=none';
      console.log(
        `  ${plugin.enabled ? 'on ' : 'off'} ${plugin.key} (${plugin.source}, ${skills}, ${mcp}, ${apps})`,
      );
    }
    return discovered;
  });

  await runAsyncStep('installed skill scan', async () => {
    const skills = await collectPluginSkills(plugins);
    console.log(`  plugin skill count: ${skills.length}`);
  });

  await runAsyncStep('installed app connector scan', async () => {
    const apps = await collectPluginApps(plugins);
    console.log(`  app connector declaration count: ${apps.length}`);
  });

  const servers = await runAsyncStep('installed MCP merge', async () => {
    const merged = await collectEnabledMcpServers(plugins, workspace);
    console.log(`  enabled MCP server count: ${Object.keys(merged).length}`);
    return merged;
  });

  if (!connect) {
    record(
      'installed MCP connect',
      'skip',
      'pass --connect-installed to initialize/list tools for real installed plugins',
    );
    return;
  }

  for (const [name, config] of Object.entries(servers)) {
    const kind = serverConfigKind(config);
    if (kind === 'remote' && !connectRemote) {
      record(`installed MCP connect: ${name}`, 'skip', 'remote server; pass --connect-remote');
      continue;
    }
    await runAsyncStep(`installed MCP connect: ${name}`, async () => {
      const result = await connectAndPing(name, config, { callPing: false });
      console.log(`  tools: ${result.tools.join(', ') || '(none)'}`);
    });
  }
}

async function writeFixtureMcpServer(serverPath) {
  await writeFile(
    serverPath,
    `#!/usr/bin/env node
const label = process.env.PLUGIN_EVAL_LABEL ?? process.argv[2] ?? 'unknown';
const tokenSeen = Boolean(process.env.PLUGIN_EVAL_TOKEN);
let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\\n')) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line.length > 0) handle(line);
  }
});

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}

function fail(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function handle(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    return;
  }

  if (message.method === 'notifications/initialized') return;
  if (message.id === undefined || message.id === null) return;

  if (message.method === 'initialize') {
    result(message.id, {
      protocolVersion: message.params?.protocolVersion ?? '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'solo-plugin-eval-' + label, version: '0.0.0' },
    });
    return;
  }

  if (message.method === 'tools/list') {
    result(message.id, {
      tools: [
        {
          name: 'ping',
          description: 'Fixture ping tool',
          inputSchema: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
            additionalProperties: false,
          },
        },
      ],
    });
    return;
  }

  if (message.method === 'tools/call') {
    if (message.params?.name !== 'ping') {
      fail(message.id, -32602, 'unknown tool');
      return;
    }
    const payload = {
      label,
      tokenSeen,
      message: message.params?.arguments?.message ?? '',
    };
    result(message.id, {
      structuredContent: payload,
      content: [{ type: 'text', text: JSON.stringify(payload) }],
    });
    return;
  }

  fail(message.id, -32601, 'method not found: ' + message.method);
}
`,
    'utf8',
  );
}

async function writeFixturePlugin({
  root,
  manifestDir,
  name,
  displayName,
  sourceLabel,
}) {
  await mkdir(path.join(root, manifestDir), { recursive: true });
  await mkdir(path.join(root, 'skills', `${name}-skill`), { recursive: true });
  await writeFile(
    path.join(root, 'skills', `${name}-skill`, 'SKILL.md'),
    `---\nname: ${name}-skill\ndescription: ${displayName} skill fixture\n---\n\nUse this fixture skill for ${displayName}.\n`,
    'utf8',
  );
  await writeFixtureMcpServer(path.join(root, 'fixture-mcp-server.mjs'));
  await writeJson(path.join(root, manifestDir, 'plugin.json'), {
    name,
    version: '1.0.0',
    description: `${displayName} plugin connection eval fixture.`,
    skills: 'skills',
    mcpServers: 'mcp.json',
    apps: '.app.json',
    interface: {
      displayName,
      shortDescription: 'Plugin connection eval fixture',
      developerName: 'Solo Eval',
      category: 'Testing',
      capabilities: ['mcp', 'fixture'],
      defaultPrompt: [`Ping ${displayName}`],
    },
  });
  await writeJson(path.join(root, '.app.json'), {
    apps: {
      [sourceLabel]: {
        id: `connector_eval_${sourceLabel}`,
        provider: sourceLabel,
      },
    },
  });
  await writeJson(path.join(root, 'mcp.json'), {
    mcpServers: {
      echo: {
        command: process.execPath,
        args: ['${PLUGIN_ROOT}/fixture-mcp-server.mjs'],
        env: {
          PLUGIN_EVAL_LABEL: sourceLabel,
          PLUGIN_EVAL_ROOT: '${PLUGIN_ROOT}',
          PLUGIN_EVAL_WORKSPACE: '${workspaceFolder}',
          PLUGIN_EVAL_TOKEN: `\${provider:${sourceLabel}:accessToken}`,
        },
      },
    },
  });
}

async function discoverPlugins(home, options) {
  const plugins = [];
  const toggles = await readToggles(path.join(home, '.solo', 'plugins'));

  if (options.includeSolo) {
    const soloCache = path.join(home, '.solo', 'plugins', 'cache');
    for (const marketplace of await readDirNames(soloCache)) {
      for (const name of await readDirNames(path.join(soloCache, marketplace))) {
        const version = await pickActiveVersion(path.join(soloCache, marketplace, name));
        if (!version) continue;
        const root = path.join(soloCache, marketplace, name, version);
        const record = await pluginRecord({
          marketplace,
          name,
          version,
          root,
          source: marketplace === 'local' ? 'local' : 'marketplace',
          toggles,
        });
        if (record) plugins.push(record);
      }
    }
  }

  if (options.includeClaude) {
    const installedPath = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
    const installed = await readJsonSafe(installedPath);
    const scopes = installed?.plugins && typeof installed.plugins === 'object' ? installed.plugins : {};
    for (const [scope, entries] of Object.entries(scopes)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const installPath = entry?.installPath ?? entry?.install_path;
        if (typeof installPath !== 'string') continue;
        if (!(await isDirectory(installPath))) continue;
        const resolved = await resolvePluginRootAndName(installPath);
        if (!resolved.name) continue;
        const marketplace = sanitizeSegment(
          typeof entry.marketplaceName === 'string' && entry.marketplaceName.length > 0
            ? entry.marketplaceName
            : scope === 'user'
              ? 'claude-user'
              : 'claude-plugins',
        );
        const record = await pluginRecord({
          marketplace,
          name: sanitizeSegment(resolved.name),
          version: resolved.manifest?.version ?? 'local',
          root: resolved.root,
          source: 'claude_adapter',
          toggles,
          manifest: resolved.manifest,
        });
        if (record) plugins.push(record);
      }
    }
  }

  if (options.includeCodex) {
    const codexCache = path.join(home, '.codex', 'plugins', 'cache');
    for (const marketplace of await readDirNames(codexCache)) {
      for (const name of await readDirNames(path.join(codexCache, marketplace))) {
        const version = await pickActiveVersion(path.join(codexCache, marketplace, name));
        if (!version) continue;
        const root = path.join(codexCache, marketplace, name, version);
        const record = await pluginRecord({
          marketplace: sanitizeSegment(marketplace),
          name: sanitizeSegment(name),
          version,
          root,
          source: 'codex_adapter',
          toggles,
        });
        if (record) plugins.push(record);
      }
    }
  }

  const seen = new Set();
  return plugins
    .filter((plugin) => {
      if (seen.has(plugin.key)) return false;
      seen.add(plugin.key);
      return true;
    })
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.id.name.localeCompare(b.id.name));
}

async function pluginRecord({ marketplace, name, version, root, source, toggles, manifest }) {
  const loadedManifest = manifest ?? (await loadPluginManifest(root));
  const key = `${marketplace}/${name}`;
  return {
    id: { marketplace, name },
    key,
    version,
    root,
    source,
    manifest: loadedManifest,
    mcpPath: loadedManifest?.mcpServers ? resolveInside(root, loadedManifest.mcpServers) : null,
    appsPath: loadedManifest?.apps ? resolveInside(root, loadedManifest.apps) : null,
    skillsPath: loadedManifest?.skills ? resolveInside(root, loadedManifest.skills) : null,
    enabled: toggles.get(key) ?? true,
  };
}

async function resolvePluginRootAndName(installPath) {
  let current = installPath;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const manifest = await loadPluginManifest(current);
    if (manifest?.name) {
      return { root: current, name: manifest.name, manifest };
    }
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }

  return {
    root: installPath,
    name: path.basename(installPath) || null,
    manifest: null,
  };
}

async function loadPluginManifest(root) {
  for (const relative of [
    '.solo-plugin/plugin.json',
    '.codex-plugin/plugin.json',
    '.claude-plugin/plugin.json',
  ]) {
    const manifestPath = path.join(root, relative);
    const raw = await readJsonSafe(manifestPath);
    if (!raw) continue;
    return {
      name: normalizeName(raw.name, root),
      version: typeof raw.version === 'string' && raw.version.trim() ? raw.version.trim() : null,
      description: typeof raw.description === 'string' ? raw.description : null,
      mcpServers: typeof raw.mcpServers === 'string' ? raw.mcpServers : null,
      apps: typeof raw.apps === 'string' ? raw.apps : null,
      skills: typeof raw.skills === 'string' ? raw.skills : null,
      manifestPath,
    };
  }
  return null;
}

function normalizeName(rawName, root) {
  if (typeof rawName === 'string' && rawName.trim()) return rawName.trim();
  return path.basename(root);
}

async function collectPluginSkills(plugins) {
  const skills = [];
  for (const plugin of plugins) {
    const skillsPath = plugin.skillsPath ?? path.join(plugin.root, 'skills');
    for (const skill of await readSkillNames(skillsPath)) {
      skills.push({ pluginKey: plugin.key, ...skill });
    }
  }
  return skills;
}

async function collectPluginApps(plugins) {
  const apps = [];
  for (const plugin of plugins) {
    if (!plugin.appsPath) continue;
    const raw = await readJsonSafe(plugin.appsPath);
    const declarations = raw?.apps && isPlainObject(raw.apps) ? raw.apps : {};
    for (const [appId, declaration] of Object.entries(declarations)) {
      const provider = inferConnectorProvider(appId, declaration);
      apps.push({
        pluginKey: plugin.key,
        appId,
        connectorId: isPlainObject(declaration) && typeof declaration.id === 'string' ? declaration.id : null,
        provider,
        supported: provider !== null,
        status: provider !== null ? 'needs_connection' : 'unsupported_connector_runtime',
      });
    }
  }
  return apps;
}

function inferConnectorProvider(appId, declaration) {
  if (isPlainObject(declaration) && typeof declaration.provider === 'string') {
    const provider = normalizeProvider(declaration.provider);
    if (provider) return provider;
  }
  const app = normalizeProvider(appId);
  switch (app) {
    case 'gmail':
    case 'google':
    case 'google-calendar':
    case 'google-drive':
    case 'drive':
    case 'calendar':
    case 'spreadsheets':
    case 'sheets':
    case 'presentations':
    case 'slides':
      return 'google';
    case 'github':
    case 'slack':
    case 'linear':
    case 'notion':
    case 'vercel':
      return app;
    case 'teams':
    case 'sharepoint':
    case 'outlook':
    case 'outlook-email':
    case 'outlook-calendar':
      return 'microsoft';
    case 'chrome':
    case 'browser':
      return 'browser';
    case 'computer-use':
      return 'computer-use';
    default:
      return null;
  }
}

async function readSkillNames(skillsPath) {
  const names = [];
  for (const entry of await readDirEntries(skillsPath)) {
    const fullPath = path.join(skillsPath, entry.name);
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const raw = await readFile(fullPath, 'utf8');
      names.push({ name: parseSkillName(raw, path.basename(entry.name, '.md')), filePath: fullPath });
      continue;
    }
    if (!entry.isDirectory()) continue;
    const skillPath = existsSync(path.join(fullPath, 'AGENTS.md'))
      ? path.join(fullPath, 'AGENTS.md')
      : existsSync(path.join(fullPath, 'SKILL.md'))
        ? path.join(fullPath, 'SKILL.md')
        : null;
    if (!skillPath) continue;
    const raw = await readFile(skillPath, 'utf8');
    names.push({ name: parseSkillName(raw, entry.name), filePath: skillPath });
  }
  return names;
}

function parseSkillName(raw, fallback) {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return fallback;
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key?.trim() === 'name') {
      const value = rest.join(':').trim();
      if (value) return value;
    }
  }
  return fallback;
}

async function collectEnabledMcpServers(plugins, workspace, { connectorTokens = null } = {}) {
  const merged = {};
  for (const plugin of plugins.filter((candidate) => candidate.enabled)) {
    if (!plugin.mcpPath) continue;
    const value = await readJson(plugin.mcpPath);
    const servers = normalizeMcpServers(value, plugin.mcpPath);
    for (const [serverName, config] of Object.entries(servers)) {
      const mergedName = Object.hasOwn(merged, serverName)
        ? `plugin__${plugin.id.marketplace}__${plugin.id.name}__${serverName}`
        : serverName;
      merged[mergedName] = normalizeServerConfig(config, plugin.root, workspace, { connectorTokens });
    }
  }
  return merged;
}

function normalizeMcpServers(value, source) {
  if (value?.mcpServers && isPlainObject(value.mcpServers)) return value.mcpServers;
  if (isPlainObject(value)) return value;
  throw new Error(`${source} must be a JSON object or contain mcpServers`);
}

function normalizeServerConfig(config, pluginRoot, workspace, { connectorTokens = null } = {}) {
  if (!isPlainObject(config)) {
    throw new Error('MCP server config must be an object');
  }
  const normalized = expandServerConfig(config, pluginRoot, workspace, { connectorTokens });
  if (typeof normalized.cwd === 'string' && !path.isAbsolute(normalized.cwd)) {
    normalized.cwd = path.resolve(pluginRoot, normalized.cwd);
  }
  return normalized;
}

function expandServerConfig(value, pluginRoot, workspace, { connectorTokens = null } = {}) {
  if (typeof value === 'string') {
    return value
      .replaceAll('${PLUGIN_ROOT}', pluginRoot)
      .replaceAll('${pluginRoot}', pluginRoot)
      .replaceAll('${workspaceFolder}', workspace)
      .replaceAll('${workspace}', workspace)
      .replace(/\$\{env:([^}]+)\}/g, (_, name) => process.env[name] ?? '')
      .replace(/\$\{(?:provider|connector):([^}:]+):([^}]+)\}/g, (match, provider, field) => {
        if (!connectorTokens) return match;
        const token = connectorTokens.get(normalizeProvider(provider));
        if (!token) throw new Error(`missing fixture connector token for provider ${provider}`);
        if (['accessToken', 'access_token', 'token'].includes(field)) return token.accessToken ?? '';
        if (['refreshToken', 'refresh_token'].includes(field)) return token.refreshToken ?? '';
        throw new Error(`unsupported fixture connector token field ${field}`);
      });
  }
  if (Array.isArray(value)) {
    return value.map((item) => expandServerConfig(item, pluginRoot, workspace, { connectorTokens }));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        expandServerConfig(item, pluginRoot, workspace, { connectorTokens }),
      ]),
    );
  }
  return value;
}

async function connectAndPing(name, config, { callPing }) {
  const client = new Client(
    { name: 'solo-plugin-connection-eval', version: '0.0.0' },
    { capabilities: {} },
  );
  const transport = makeTransport(config);
  let stderr = '';
  if (transport.stderr) {
    transport.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
  }

  try {
    await withTimeout(client.connect(transport), 8_000, `${name} initialize timed out`);
    const listed = await withTimeout(client.listTools(), 8_000, `${name} tools/list timed out`);
    const tools = listed.tools.map((tool) => tool.name);

    let ping = null;
    if (callPing) {
      if (!tools.includes('ping')) {
        throw new Error(`expected ping tool, got: ${tools.join(', ')}`);
      }
      const result = await withTimeout(
        client.callTool({ name: 'ping', arguments: { message: `hello from ${name}` } }),
        8_000,
        `${name} tools/call timed out`,
      );
      ping = extractStructuredPing(result);
    }

    await client.close();
    return { tools, ping };
  } catch (error) {
    try {
      await client.close();
    } catch {
      // best effort cleanup
    }
    const suffix = stderr.trim() ? `\nstderr:\n${stderr.trim()}` : '';
    throw new Error(`${error instanceof Error ? error.message : String(error)}${suffix}`);
  }
}

function makeTransport(config) {
  if (typeof config.command === 'string') {
    return new StdioClientTransport({
      command: config.command,
      args: Array.isArray(config.args) ? config.args.map(String) : [],
      cwd: typeof config.cwd === 'string' ? config.cwd : undefined,
      env: isPlainObject(config.env) ? stringifyEnv(config.env) : undefined,
      stderr: 'pipe',
    });
  }

  const rawUrl = config.url ?? config.serverUrl ?? config.server_url;
  if (typeof rawUrl === 'string') {
    const requestInit = isPlainObject(config.headers)
      ? { headers: stringifyEnv(config.headers) }
      : undefined;
    if (config.transport === 'sse' || rawUrl.includes('/sse')) {
      return new SSEClientTransport(new URL(rawUrl), { requestInit });
    }
    return new StreamableHTTPClientTransport(new URL(rawUrl), { requestInit });
  }

  throw new Error('Unsupported MCP server config: expected command or url');
}

function serverConfigKind(config) {
  if (typeof config.command === 'string') return 'stdio';
  if (typeof (config.url ?? config.serverUrl ?? config.server_url) === 'string') return 'remote';
  return 'unknown';
}

function extractStructuredPing(result) {
  if (result.structuredContent && isPlainObject(result.structuredContent)) {
    return result.structuredContent;
  }
  const text = result.content?.find((item) => item.type === 'text')?.text;
  if (typeof text === 'string') {
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  }
  return null;
}

function withTimeout(promise, ms, message) {
  let timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timeout)),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

async function readToggles(soloPluginsDir) {
  const raw = await readJsonSafe(path.join(soloPluginsDir, 'toggles.json'));
  const entries = raw?.entries && isPlainObject(raw.entries) ? raw.entries : {};
  const map = new Map();
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value?.enabled === 'boolean') {
      map.set(key, value.enabled);
    }
  }
  return map;
}

async function pickActiveVersion(pluginDir) {
  const versions = await readDirNames(pluginDir);
  if (versions.length === 0) return null;
  if (versions.includes('local')) return 'local';
  return versions.sort().at(-1);
}

async function readDirNames(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function readDirEntries(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function isDirectory(candidate) {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function readJsonSafe(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function resolveInside(root, relative) {
  const resolved = path.resolve(root, relative);
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`manifest path escapes plugin root: ${relative}`);
  }
  return resolved;
}

function stringifyEnv(env) {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, value === undefined ? '' : String(value)]),
  );
}

function sanitizeSegment(raw) {
  return String(raw)
    .split('')
    .map((char) => (/^[a-zA-Z0-9_-]$/.test(char) ? char : '-'))
    .join('');
}

function normalizeProvider(raw) {
  const value = String(raw ?? '').trim().toLowerCase().replaceAll('_', '-');
  return value || null;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function expectIncludes(values, expected) {
  if (!values.includes(expected)) {
    throw new Error(`expected ${expected}; got ${values.join(', ') || '(none)'}`);
  }
}
