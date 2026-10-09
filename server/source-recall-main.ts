import { createSourceRecallApp } from './source-recall-app.js';

const app = await createSourceRecallApp();
await app.listen(Number(process.env.PORT || 1555), '0.0.0.0');
