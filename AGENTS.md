# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 프로젝트 개요

농약(pesticide) 관련 AI 앱. `backend/`(NestJS)와 `frontend/`(Next.js) 두 디렉토리로 구성된 모노레포. 패키지 매니저는 **pnpm**.

## 개발 환경 설정

### 인프라 (Docker)

```bash
# backend/ 디렉토리에서 실행
cd backend
docker compose up -d   # PostgreSQL 16 (5432), Redis 7 (6379) 시작
docker compose down    # 중지
```

### 백엔드 (NestJS)

```bash
cd backend
pnpm install
pnpm start:dev         # watch 모드 (포트 3000)
pnpm build             # 프로덕션 빌드
pnpm lint              # ESLint + 자동 fix
pnpm format            # Prettier 포맷
```

### 프론트엔드 (Next.js)

```bash
cd frontend
pnpm install
pnpm dev               # Turbopack dev 서버
pnpm build             # 프로덕션 빌드 (Turbopack)
pnpm lint              # ESLint
```

### 테스트 (백엔드)

```bash
cd backend
pnpm test                                    # 전체 unit test
pnpm test -- --testPathPattern=prisma        # 특정 파일 테스트 (파일명 일부)
pnpm test:watch                              # watch 모드
pnpm test:e2e                                # E2E 테스트
pnpm test:cov                                # 커버리지
```

테스트 파일은 `src/` 아래 `.spec.ts` 패턴. 프론트엔드에는 테스트 설정이 없음.

### Prisma

```bash
cd backend
pnpm prisma migrate dev          # 마이그레이션 생성·적용
pnpm prisma generate             # Prisma Client 재생성 (generated/prisma/에 출력)
pnpm prisma studio               # DB 브라우저
```

## 아키텍처

### 백엔드 (`backend/`)

- **NestJS v11** + TypeScript
- `src/app.module.ts`: 루트 모듈. `ConfigModule.forRoot({ isGlobal: true })`로 환경변수 전역 로드
- **Prisma v6**: `prisma/schema.prisma` → 클라이언트는 `generated/prisma/`에 생성됨 (`@prisma/client` 아님)
  - import 경로: `../../generated/prisma/client`
  - `@prisma/adapter-pg`(pg 드라이버 어댑터) 사용 — Rust 엔진 아님
  - `prisma.config.ts`에서 `import "dotenv/config"`로 .env 로드
- `src/prisma/prisma.module.ts`: `@Global()` 데코레이터로 전역 등록 — 다른 모듈은 `PrismaModule` import 없이 `PrismaService`를 주입받을 수 있음
- 인증: `@nestjs/passport` + `passport-local` 패키지 설치됨. 캐시/세션: `ioredis` (Redis 7)

### 프론트엔드 (`frontend/`)

- **Next.js 15** App Router + React 19 + TypeScript
- `app/`: 라우트 및 페이지 (App Router 규칙)
- `@/` 경로 별칭 → `frontend/` 루트 (`tsconfig.json` 설정)
- `config/providers.tsx`: Jotai `Provider` + TanStack Query `QueryClientProvider` 래퍼 — `app/layout.tsx`에서 전체 앱 감쌈
- `components/ui/`: shadcn/ui 컴포넌트 (스타일: `radix-nova`, 아이콘: Lucide)
- `lib/utils.ts`: `cn()` 유틸리티 (clsx + tailwind-merge)

### 상태 관리

- **서버 상태**: TanStack Query v5 (`useQuery`, `useMutation`)
- **클라이언트 전역 상태**: Jotai v2 (`atom`, `useAtom`)

### UI

- **Tailwind CSS v4** (`@tailwindcss/postcss`)
- shadcn/ui 컴포넌트 추가: `pnpm dlx shadcn@latest add <component>` (frontend/ 디렉토리에서 실행)

## DB 스키마 요약

| 모델 | 역할 |
|------|------|
| `User` | 로컬 + OAuth 공통 사용자. `password`는 credentials 전용(nullable). `Role`: USER/ADMIN |
| `Account` | OAuth provider 계정 (Google 등). `userId`로 User와 N:1 |
| `VerificationToken` | 이메일 인증 / 비밀번호 재설정 토큰. `type`: EMAIL_VERIFICATION / PASSWORD_RESET |

모든 컬럼명은 snake_case(`@map`), 테이블명은 복수형 snake_case(`@@map`).

## 환경변수

백엔드 `.env`:

```
POSTGRES_USER=prisma
POSTGRES_PASSWORD=pesticide20260511
POSTGRES_DB=pesticide
DATABASE_URL="postgresql://prisma:pesticide20260511@localhost:5432/pesticide?schema=public"
```
