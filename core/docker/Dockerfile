FROM node:20-alpine

RUN apk add --no-cache curl openssl python3

WORKDIR /tajnet

COPY core/package.json ./
RUN npm install --omit=dev

COPY core/bridge.js ./bridge.js
COPY core/lib ./lib
COPY core/routes ./routes
COPY panel/src ./panel/src
COPY panel/landing ./panel/landing
COPY panel/shared ./panel/shared
COPY panel/editor ./panel/editor
COPY panel/wallet ./panel/wallet
COPY panel/view ./panel/view
COPY plugins ./plugins
COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY scripts/generate-tls-cert.sh ./scripts/generate-tls-cert.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /tajnet/scripts/generate-tls-cert.sh

EXPOSE 8090 8443

ENTRYPOINT ["entrypoint.sh"]
