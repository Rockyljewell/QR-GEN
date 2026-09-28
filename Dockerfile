# QRGen REST API: scan and generate barcodes over HTTP from any language.
#   docker build -t qrgen .
#   docker run -p 8080:8080 qrgen
#   curl -F image=@label.jpg http://localhost:8080/v1/scan
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/sdk/package.json packages/sdk/
COPY site/package.json site/
RUN npm ci --workspace qrgen-sdk --include-workspace-root=false --ignore-scripts --no-audit --no-fund
COPY packages/sdk packages/sdk
RUN npm run build --workspace qrgen-sdk \
 && mkdir -p /out && cd packages/sdk && npm pack --ignore-scripts --pack-destination /out

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0
WORKDIR /app
COPY --from=build /out/*.tgz /tmp/qrgen-sdk.tgz
RUN npm install --omit=dev --no-audit --no-fund /tmp/qrgen-sdk.tgz && rm /tmp/qrgen-sdk.tgz \
 && addgroup -S qrgen && adduser -S qrgen -G qrgen
USER qrgen
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
LABEL org.opencontainers.image.title="QRGen REST API" \
      org.opencontainers.image.description="Open-source barcode, QR and ID scanning and generation over HTTP" \
      org.opencontainers.image.source="https://github.com/Rockyljewell/QR-GEN" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.authors="Rockyljewell (https://github.com/Rockyljewell)"
CMD ["sh", "-c", "exec node node_modules/qrgen-sdk/dist/cli.js serve --port \"$PORT\" --host \"$HOST\""]
