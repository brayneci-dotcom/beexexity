FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/src/frontend/pricing-config.json ./dist/frontend/pricing-config.json
COPY --from=builder /app/migrations ./migrations

EXPOSE 3000
CMD ["node", "dist/server.js"]
