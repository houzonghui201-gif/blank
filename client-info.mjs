import {settings} from './settings.mjs';
const s = settings();
// Run locally using the same APP_SECRET as the deployed service. Never commit the secret.
console.log(JSON.stringify({subscriptionUrl:s.subscriptionUrl,nodeUri:s.nodeUri}, null, 2));
