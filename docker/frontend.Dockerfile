FROM node:22-bookworm-slim AS build

WORKDIR /app

ARG VITE_CONVEX_URL=http://127.0.0.1:3220
ARG VITE_AUTH_MODE=none
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_CLERK_JWT_TEMPLATE=convex

ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
ENV VITE_AUTH_MODE=$VITE_AUTH_MODE
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_JWT_TEMPLATE=$VITE_CLERK_JWT_TEMPLATE

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

FROM nginx:1.25-alpine

COPY docker/frontend.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 3000
