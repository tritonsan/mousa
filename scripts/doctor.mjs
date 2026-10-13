import { loadDotEnv, getConfig } from '../src/config.mjs';
import { inspectKiro } from '../src/doctor.mjs';
loadDotEnv();
const config = getConfig();
const kiro = await inspectKiro(config);
console.log(JSON.stringify({ kiro, qloo: { configured: Boolean(config.qlooKey), baseUrl: config.qlooBaseUrl }, access: { required: Boolean(config.accessToken) }, model: config.model || kiro.defaultModel, comparisonReady: Boolean(kiro.available && kiro.authenticated && (config.model || kiro.defaultModel) && config.qlooKey) }, null, 2));
