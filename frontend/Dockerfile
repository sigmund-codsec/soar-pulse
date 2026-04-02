# ── CodSec SOAR Evaluator — Frontend Dockerfile ──
# Multi-stage: build React app, serve with Nginx

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json ./
RUN npm install --silent

# Copy source and build
COPY . .

# Build-time env: API URL will be proxied via nginx
ENV VITE_API_URL=
RUN npm run build

# Stage 2: Production with Nginx
FROM nginx:alpine AS production

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Security: run nginx as non-root
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown -R nginx:nginx /var/run/nginx.pid

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://localhost:3000/ || exit 1

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
