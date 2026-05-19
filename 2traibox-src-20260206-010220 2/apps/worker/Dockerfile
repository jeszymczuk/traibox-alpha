FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

# Install dependencies (workspace-aware)
COPY package.json pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/profiles/package.json packages/profiles/package.json

RUN pnpm install --filter @traibox/worker... --frozen-lockfile=false

# Copy sources
COPY apps/worker apps/worker
COPY packages/db packages/db
COPY packages/profiles packages/profiles

CMD ["pnpm", "--filter", "@traibox/worker", "start"]
