FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN DATABASE_URL=postgresql://innodl:build-only@localhost/innodl_system pnpm --filter @innodl/api-server db:generate
ENV ADMIN_BASE=/admin/
RUN pnpm build
FROM build AS api
ENV NODE_ENV=production
WORKDIR /app/apps/api-server
EXPOSE 8787
CMD ["node", "dist/main.js"]
FROM nginx:1.27-alpine AS nginx
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/twin-screen/dist /usr/share/nginx/html
COPY --from=build /app/apps/admin-web/dist /usr/share/nginx/html/admin
EXPOSE 80
