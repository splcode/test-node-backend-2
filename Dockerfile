# syntax=docker/dockerfile:1

# ---------- build stage ----------
FROM node:24-slim AS build
WORKDIR /app

# Install deps first for better layer caching.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci

# Build frontend (Vite -> frontend/dist) and backend (tsc -> backend/dist).
COPY . .
RUN npm run build

# Drop dev dependencies so only production deps ship in the runtime image.
RUN npm prune --omit=dev

# ---------- runtime stage ----------
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/frontend/dist ./frontend/dist

EXPOSE 3000
USER node

# Container-level health check for Docker / orchestrators.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/dist/server.js"]
