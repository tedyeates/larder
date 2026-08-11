FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .

EXPOSE 3000
CMD ["pnpm", "dev"]
