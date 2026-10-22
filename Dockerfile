FROM debian:bookworm-slim AS core
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip && rm -rf /var/lib/apt/lists/*
ARG XRAY_VERSION=26.10.21
ARG XRAY_SHA256=0eec3ed4163c273d8c8bf821f7d219e257921cf584aa3fb970715e458e631978
RUN curl --fail --location --retry 3 "https://github.com/XTLS/Xray-core/releases/download/v${XRAY_VERSION}/Xray-linux-64.zip" -o /tmp/core.zip && \
    printf '%s  /tmp/core.zip\n' "$XRAY_SHA256" | sha256sum -c - && \
    unzip -p /tmp/core.zip xray > /usr/local/bin/xray && chmod 755 /usr/local/bin/xray

FROM node:22-bookworm-slim
COPY --from=core /usr/local/bin/xray /usr/local/bin/xray
COPY --from=core /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
WORKDIR /app
COPY --chown=node:node server.mjs settings.mjs ./
USER node
ENV NODE_ENV=production PORT=10000 XRAY_BIN=/usr/local/bin/xray
EXPOSE 10000
CMD ["node", "server.mjs"]
