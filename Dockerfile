# ── Build stage ──────────────────────────────────────────────────────────────
#
# The version the app declares in `engines`.
#
# It was twenty — so the image ran the app on a Node the app says it
# does not support, and `pnpm install` refused the image's own engine
# whenever the check was turned on.
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
# The package manager is fetched *here*, while the image is being
# built — not on the first start.
#
# `corepack enable` only installs the shim: the pnpm itself is
# downloaded into a cache on first use, and that cache lives in the
# build stage. So the container reached for the npm registry on every
# start, and an air-gapped install could not start at all.
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

# Redis, so the rate limits mean the same thing in every process and the
# scheduler does not deliver the same reminder twice. The app finds this
# binary and starts a Redis itself when it needs one, so nothing has to be
# configured for it to work.
#
# Python, because the skill engine drives the collectors and the skill
# writer through it. Without an interpreter the tools were shipped but
# could never run: every distillation failed at the "write the skill
# package" step, every collector failed to start, and the celebrity
# research flow was skipped — with nothing but a line in the log to say
# so.
# `tzdata` is the IANA time zone database.
#
# Python's `zoneinfo` has no database of its own: without it, a zone
# name like "Asia/Shanghai" cannot be loaded, and the collectors fell
# back to the *machine's* clock — so every message was rendered at the
# wrong hour for a reader in another country, and often on the wrong
# day.
RUN apk add --no-cache redis python3 py3-pip tzdata

# The one dependency the collectors and the skill writer cannot do
# without. The optional ones — the browser automation, the document
# parsers — are not installed here: they are large, and the features
# that use them say so when they are missing.
RUN pip3 install --no-cache-dir --break-system-packages "requests>=2.28.0" "pypinyin>=0.48.0"

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
