FROM node:22-alpine AS base
# tesseract-ocr + language packs for Phase 5 receipt OCR; vips for sharp.
RUN apk add --no-cache libc6-compat openssl python3 make g++ \
    tesseract-ocr tesseract-ocr-data-eng tesseract-ocr-data-fra tesseract-ocr-data-spa \
    vips-dev
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/config-eslint/package.json packages/config-eslint/
COPY packages/config-tsconfig/package.json packages/config-tsconfig/
COPY libs/prisma/package.json libs/prisma/
RUN pnpm install --frozen-lockfile

FROM deps AS runtime
COPY packages packages
COPY libs libs
COPY apps/worker apps/worker
RUN pnpm --filter @split-wise/prisma generate

ENV NODE_ENV=production
WORKDIR /app/apps/worker
CMD ["pnpm", "exec", "tsx", "src/main.ts"]
