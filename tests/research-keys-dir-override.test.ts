import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const keysDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-research-keys-'));
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-state-unused-'));
process.env.HERMES_RESEARCH_KEYS_DIR = keysDir;
process.env.HERMES_STATE_DIR = stateDir;
delete process.env.TAVILY_API_KEY;
delete process.env.TAVILY_API_KEYS;

const { ResearchKeysService } = await import('../server/research-keys.service.js');

const service = new ResearchKeysService();
const status = await service.updateKeys({ tavilyApiKey: 'test-tavily-key' });

assert.equal(status.tavilyApiKey.configured, true);
assert.equal(status.tavilyApiKey.configuredCount, 1);

const jsonPath = path.join(keysDir, 'research-keys.json');
const envPath = path.join(keysDir, 'research-keys.env');
assert.equal(fs.existsSync(jsonPath), true);
assert.equal(fs.existsSync(envPath), true);
assert.equal(fs.existsSync(path.join(stateDir, 'workspace', 'report-agent', 'config', 'research-keys.json')), false);

const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const env = fs.readFileSync(envPath, 'utf8');
assert.equal(json.tavilyApiKey, 'test-tavily-key');
assert.match(env, /export TAVILY_API_KEY='test-tavily-key'/);

console.log('research keys directory override tests passed');
