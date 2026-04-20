FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=development
CMD ["npm", "run", "start"]
