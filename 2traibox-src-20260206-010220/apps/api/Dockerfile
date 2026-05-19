FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

# Install dependencies (workspace-aware)
COPY package.json pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/profiles/package.json packages/profiles/package.json
COPY packages/proof/package.json packages/proof/package.json
COPY packages/partner-sdk/package.json packages/partner-sdk/package.json

RUN pnpm install --filter @traibox/api... --frozen-lockfile=false

# Copy sources
COPY apps/api apps/api
COPY packages/contracts packages/contracts
COPY packages/db packages/db
COPY packages/profiles packages/profiles
COPY packages/proof packages/proof
COPY packages/partner-sdk packages/partner-sdk

EXPOSE 3001
CMD ["pnpm", "--filter", "@traibox/api", "start"]
