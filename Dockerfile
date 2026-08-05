# ─── Stage 1: build ───────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build
RUN npm prune --production

# ─── Stage 2: production image ────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/node_modules  ./node_modules
COPY --from=builder /app/package.json  ./package.json

# Railway injects $PORT automatically — fallback to 3000 for local
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE ${PORT}

CMD ["node", "dist/apps/api/main"]
