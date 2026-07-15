import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const deployScript = await readFile(new URL('../deploy.sh', import.meta.url), 'utf8');
const authBootstrap = await readFile(new URL('../scripts/init-auth-users.sql', import.meta.url), 'utf8');

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
