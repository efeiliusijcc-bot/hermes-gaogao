import assert from 'node:assert/strict';

process.env.FRONTEND_ORIGINS = 'https://hermes-gaogao.vercel.app,https://app.example.com';
process.env.NODE_ENV = 'production';

const { buildCorsOptions } = await import('../server/index.js');

const cors = buildCorsOptions();
assert.deepEqual(cors.exposedHeaders, ['Content-Disposition', 'Content-Length', 'ETag', 'X-Artifact-SHA256']);
assert.equal(cors.credentials, true);

await assertOrigin(cors, 'https://hermes-gaogao.vercel.app', true);
await assertOrigin(cors, 'https://app.example.com', true);
await assertOrigin(cors, 'https://other-project.vercel.app', false);

console.log('artifact CORS download tests passed');

async function assertOrigin(corsOptions: { origin?: unknown }, origin: string, allowed: boolean) {
  assert.equal(typeof corsOptions.origin, 'function');
  await new Promise<void>((resolve, reject) => {
    const originFn = corsOptions.origin as (origin: string, callback: (error: Error | null, allowed?: boolean) => void) => void;
    originFn(origin, (error, result) => {
      if (allowed) {
        try {
          assert.equal(error, null);
          assert.equal(result, true);
          resolve();
        } catch (assertionError) {
          reject(assertionError);
        }
        return;
      }
      try {
        assert.ok(error);
        resolve();
      } catch (assertionError) {
        reject(assertionError);
      }
    });
  });
}
