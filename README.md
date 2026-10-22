# Personal Xray on Render

VLESS over WebSocket with TLS terminated by Render's HTTPS edge. A Node.js gateway serves health checks and a token-protected subscription, and forwards WebSocket connections to Xray on loopback.

## Deployment

- Docker web service, Free compute plan, Oregon (United States).
- Bind `PORT` (Render default: 10000).
- Set `APP_SECRET` to a cryptographically random value of at least 32 bytes in Render environment variables. Never commit it.
- `RENDER_EXTERNAL_HOSTNAME` supplies the public hostname. `PUBLIC_HOST` can override it.
- Optional health check: `/healthz`.
- The included `render.yaml` is an alternative Blueprint setup. Direct connector deployments manage their configuration in Render instead.

The secret derives separate VLESS credentials, WebSocket path, and subscription token. Changing it invalidates all existing client links. HTTP endpoints other than health and the secret subscription return 404. Private network and SMTP destinations are blocked.

## Client and verification

Run `node client-info.mjs` with the same `APP_SECRET` and `PUBLIC_HOST` to obtain private client links. Keep its output private.

Install `requirements-verifier.txt`, and run `verify-and-export.py` with `SUBSCRIPTION_URL` and `XRAY_BIN` supplied in the local environment. It validates the public HTTPS subscription, uses a real Xray SOCKS client with certificate verification, and requests `https://example.com/` through the deployed proxy. It exports subscription and direct-node QR codes only after that check succeeds.

The public deployment and the user's phone network require separate validation. A running service or a 200 health response alone does not establish proxy connectivity.

Render Free services can sleep when idle and are subject to platform quotas. No keep-alive automation is included. Xray is pinned to version 26.10.21 and its archive SHA256 is verified during the Docker build.
