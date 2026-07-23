import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const deployScript = await readFile(new URL('../deploy.sh', import.meta.url), 'utf8');
const harnessInstallScript = await readFile(new URL('../scripts/install-hermes-harness-deps.sh', import.meta.url), 'utf8');
const envExample = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const authBootstrap = await readFile(new URL('../scripts/init-auth-users.sql', import.meta.url), 'utf8');
const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');

const localDeployKey = '~/.ssh/hermes_bwg_us_204_ed25519';
assert.ok(deployScript.includes(`SSH_KEY:=${localDeployKey}`));
assert.ok(harnessInstallScript.includes(`SSH_KEY:=${localDeployKey}`));
assert.ok(envExample.includes(`SSH_KEY=${localDeployKey}`));
assert.ok(readme.includes(`SSH_KEY=${localDeployKey}`));

assert.match(deployScript, /BOOTSTRAP_ADMIN_PASSWORD:\?Missing BOOTSTRAP_ADMIN_PASSWORD/);
assert.doesNotMatch(deployScript, /\$\{[^}]+,,\}/, 'deploy script must remain compatible with macOS Bash 3.2');
assert.doesNotMatch(deployScript, /"password"\s*:\s*"admin"/);
assert.doesNotMatch(authBootstrap, /\$2[aby]\$\d{2}\$/);
assert.match(authBootstrap, /bootstrap_admin_password_hash/);
assert.match(deployScript, /write_env NODE_ENV "production"/);
assert.match(dockerfile, /FROM node:22-bookworm-slim[\s\S]*ENV NODE_ENV=production/);
assert.doesNotMatch(dockerfile.split('# --- production ---')[0], /ENV NODE_ENV=production/);

assert.match(deployScript, /releases\/\$RELEASE_ID/);
assert.match(deployScript, /rm -rf ['"]?\$SRC_DIR/);
for (const name of [
  'DAILY_AWARENESS_MYSQL_HOST',
  'DAILY_AWARENESS_MYSQL_PORT',
  'DAILY_AWARENESS_MYSQL_DATABASE',
  'DAILY_AWARENESS_MYSQL_USER',
  'DAILY_AWARENESS_MYSQL_PASSWORD',
  'DAILY_AWARENESS_MYSQL_TABLE_PREFIX',
]) {
  assert.match(envExample, new RegExp(`^${name}=`, 'm'));
  assert.match(deployScript, new RegExp(`write_env ${name}`));
}
for (const name of [
  'DAILY_AWARENESS_AUTO_ENABLED',
  'DAILY_AWARENESS_AUTO_TIME',
  'DAILY_AWARENESS_AUTO_TIMEZONE',
  'DAILY_AWARENESS_SOURCE_DAY_OFFSET',
  'DAILY_AWARENESS_DATA_RETRY_MINUTES',
  'DAILY_AWARENESS_DATA_WAIT_UNTIL',
  'DAILY_AWARENESS_SCHEDULER_POLL_MS',
]) {
  assert.match(envExample, new RegExp(`^${name}=`, 'm'));
  assert.match(deployScript, new RegExp(`write_env ${name}`));
}
assert.match(deployScript, /write_env DAILY_AWARENESS_AUTO_ENABLED "\$\{DAILY_AWARENESS_AUTO_ENABLED:-true\}"/);
assert.match(
  deployScript,
  /run_api_container "\\\$CANDIDATE_NAME" no false false/,
  'candidate container must disable automatic Daily Awareness scheduling',
);
assert.match(deployScript, /docker network connect --alias my_mysql hermes-net my_mysql/);

const candidateCheck = deployScript.indexOf('hermes-api-candidate-');
const oldContainerStop = deployScript.indexOf('docker stop hermes-api');
assert.ok(candidateCheck >= 0, 'deployment must start a candidate container');
assert.ok(oldContainerStop > candidateCheck, 'candidate must be checked before the live container is stopped');
assert.match(deployScript, /rollback_deploy/);
assert.match(deployScript, /trap ['"]rollback_deploy['"] ERR/);

console.log('deploy hardening tests passed');
