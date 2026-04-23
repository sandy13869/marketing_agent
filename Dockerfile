# ─── Stage 1: Dependencies ────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Install build tools needed for sharp (native bindings)
RUN apk add --no-cache python3 make g++ vips-dev

COPY package*.json ./
RUN npm ci --omit=dev

# ─── Stage 2: Runner ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Runtime dependency for sharp
RUN apk add --no-cache vips

# Non-root user for security
RUN addgroup -S agent && adduser -S agent -G agent

COPY --chown=agent:agent --from=deps /app/node_modules ./node_modules
COPY --chown=agent:agent . .

# Create writable runtime directories
RUN mkdir -p tmp logs && chown -R agent:agent tmp logs

USER agent

EXPOSE 3000

CMD ["node", "src/index.js"]
