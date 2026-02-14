
# Stage 1: Base
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Stage 2: Build dependencies
FROM base AS build
COPY . /usr/src/app
WORKDIR /usr/src/app
# Start clean - remove any local artifacts that might have slipped in
RUN rm -rf node_modules packages/*/node_modules packages/*/dist
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm build
# Prune dev dependencies for production image size optimization
RUN pnpm prune --prod

# Stage 3: Production runner
FROM base AS runner
WORKDIR /usr/src/app
# Copy only necessary files for runtime
COPY --from=build /usr/src/app/package.json ./package.json
COPY --from=build /usr/src/app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /usr/src/app/node_modules ./node_modules
# Copy package sources (dist folders only ideally, but workspace structure needs preserving)
# Simplest robust approach for monorepo without complex bundling:
COPY --from=build /usr/src/app/packages ./packages

# Link the CLI binary globally
RUN ln -s /usr/src/app/packages/cli/dist/cli.js /usr/local/bin/contex

# Expose server port
EXPOSE 3000

# Set default command to run the server, but allow overriding for CLI
CMD ["node", "packages/server/dist/index.js"]
