import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const deployScript = await readFile(new URL('../deploy.sh', import.meta.url), 'utf8');
const harnessInstallScript = await readFile(new URL('../scripts/install-hermes-harness-deps.sh', import.meta.url), 'utf8');
const envExample = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const authBootstrap = await readFile(new URL('../scripts/init-auth-users.sql', import.meta.url), 'utf8');

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

assert.match(deployScript, /releases\/\$RELEASE_ID/);
assert.match(deployScript, /rm -rf ['"]?\$SRC_DIR/);

const candidateCheck = deployScript.indexOf('hermes-api-candidate-');
const oldContainerStop = deployScript.indexOf('docker stop hermes-api');
assert.ok(candidateCheck >= 0, 'deployment must start a candidate container');
assert.ok(oldContainerStop > candidateCheck, 'candidate must be checked before the live container is stopped');
assert.match(deployScript, /rollback_deploy/);
assert.match(deployScript, /trap ['"]rollback_deploy['"] ERR/);

console.log('deploy hardening tests passed');
