FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app/services/connector-runner

COPY services/connector-runner/package.json services/connector-runner/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY services/connector-runner/tsconfig.json ./
COPY services/connector-runner/src ./src
COPY shared/outboundUrlPolicy.ts /app/shared/outboundUrlPolicy.ts
COPY server/outbound-url-policy.ts /app/server/outbound-url-policy.ts

ENV NODE_ENV=development
CMD ["npm", "run", "start"]
