FROM node:26.7.0-bookworm-slim
WORKDIR /app
# Build separately with npm ci && npm run catalog:build; private exports never enter this image.
COPY dist-procurement-catalog/ ./
ENV HOST=0.0.0.0 PORT=8788 CATALOG_CONFIG_FILE=/run/catalog/config.json
USER 10001:10001
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8788/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "main.mjs"]
