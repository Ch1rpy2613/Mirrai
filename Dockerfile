# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

# Redis, so the rate limits mean the same thing in every process and the
# scheduler does not deliver the same reminder twice. The app finds this
# binary and starts a Redis itself when it needs one, so nothing has to be
# configured for it to work.
RUN apk add --no-cache redis

# Server bundle + client static assets (dist/), dependencies (drizzle-kit kept
# for schema push on boot), and drizzle schema for migrations
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/drizzle ./drizzle
# The templates that ship with the app. Without them the template
# library is empty and "try it out with a sandbox character" is
# impossible.
COPY --from=build /app/server/templates/builtin ./server/templates/builtin
# The skill engine: the prompts the distillation reads at run time, and
# the Python collectors it drives.
#
# They were never shipped, so in the installed app every distillation
# stage failed with "Prompt not found" and the collectors were spawned
# in a directory that did not exist.
COPY --from=build /app/skill-engine ./skill-engine
# The migration runner. The desktop start scripts run it out of the
# bundle, and it was not there — so the hand-written data migrations
# never ran on an installed app.
COPY --from=build /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY drizzle.config.ts package.json ./
COPY scripts/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
