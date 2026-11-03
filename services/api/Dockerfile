FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm install tsx --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
# Run migrations, then start (tsx runs TypeScript directly; swap for `npm run build && node dist` if preferred)
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && npx tsx src/index.ts"]
