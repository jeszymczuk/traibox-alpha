FROM node:22-alpine AS build

WORKDIR /app
ENV NODE_ENV=development

RUN corepack enable

# Install dependencies (workspace-aware)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/profiles/package.json packages/profiles/package.json

RUN pnpm install --filter @traibox/worker... --frozen-lockfile

# Copy sources
COPY apps/worker apps/worker
COPY packages/contracts packages/contracts
COPY packages/db packages/db
COPY packages/profiles packages/profiles

RUN pnpm --filter @traibox/worker build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 10001 traibox \
  && adduser --system --uid 10001 --ingroup traibox traibox

COPY --from=build --chown=traibox:traibox /app/apps/worker/dist ./dist
# Keep the validated absolute staging profile path available to the worker.
COPY --from=build --chown=traibox:traibox /app/packages/profiles/profiles /app/packages/profiles/profiles

USER traibox
CMD ["node", "--enable-source-maps", "dist/main.cjs"]
