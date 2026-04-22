# Frontend Dockerfile — multi-stage build, served by nginx.
# Build with:  docker build -t quant-frontend .
# Run with:    docker run -p 3000:80 -e VITE_API_BASE_URL=http://host.docker.internal:8080 quant-frontend
#
# NOTE: VITE_API_BASE_URL is baked at build time. To change it, rebuild with
#       docker build --build-arg VITE_API_BASE_URL=https://your-tunnel.ngrok.app .

FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL=http://localhost:8080
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# SPA fallback
RUN printf 'server { listen 80; root /usr/share/nginx/html; location / { try_files $uri /index.html; } }\n' \
    > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
