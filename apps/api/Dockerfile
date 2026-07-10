FROM node:22-alpine AS build

WORKDIR /app
ENV NODE_ENV=development

RUN corepack enable

# Install dependencies (workspace-aware)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/profiles/package.json packages/profiles/package.json
COPY packages/proof/package.json packages/proof/package.json
COPY packages/partner-sdk/package.json packages/partner-sdk/package.json

RUN pnpm install --filter @traibox/api... --frozen-lockfile

# Copy sources
COPY apps/api apps/api
COPY packages/contracts packages/contracts
COPY packages/db packages/db
COPY packages/profiles packages/profiles
COPY packages/proof packages/proof
COPY packages/partner-sdk packages/partner-sdk

RUN pnpm --filter @traibox/api build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=3001

RUN addgroup --system --gid 10001 traibox \
  && adduser --system --uid 10001 --ingroup traibox traibox

COPY --from=build --chown=traibox:traibox /app/apps/api/dist ./dist
# The staging profile path is intentionally absolute and validated on Fly.
COPY --from=build --chown=traibox:traibox /app/packages/profiles/profiles /app/packages/profiles/profiles

RUN mkdir -p /app/tmp/local-storage && chown -R traibox:traibox /app/tmp

USER traibox
EXPOSE 3001
CMD ["node", "--enable-source-maps", "dist/main.cjs"]
