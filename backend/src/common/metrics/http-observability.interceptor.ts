import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { Counter, Gauge, Histogram } from 'prom-client';
import { Observable, catchError, finalize, throwError } from 'rxjs';
import {
  HTTP_METHOD_LABEL_ALLOWLIST,
  HTTP_METHOD_LABEL_FALLBACK,
  HTTP_OBSERVABILITY_EXCLUDED_PATHS,
  HTTP_REQUEST_DURATION_SECONDS,
  HTTP_REQUESTS_IN_FLIGHT,
  HTTP_REQUESTS_TOTAL,
} from './http-observability.constants';

type HttpMetricLabels = 'method' | 'route' | 'status_code';
type HttpInFlightLabels = 'method' | 'route';

type ExpressRoute = {
  path?: string | RegExp | Array<string | RegExp>;
};

type RouteAwareRequest = Request & {
  route?: {
    path?: string | RegExp | Array<string | RegExp>;
  };
};

@Injectable()
export class HttpObservabilityInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpObservabilityInterceptor.name);

  constructor(
    @InjectMetric(HTTP_REQUESTS_TOTAL)
    private readonly requestsTotal: Counter<HttpMetricLabels>,
    @InjectMetric(HTTP_REQUEST_DURATION_SECONDS)
    private readonly requestDuration: Histogram<HttpMetricLabels>,
    @InjectMetric(HTTP_REQUESTS_IN_FLIGHT)
    private readonly requestsInFlight: Gauge<HttpInFlightLabels>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // 전역 interceptor지만 HTTP 요청만 계측한다. RPC/WebSocket 등은 그대로 통과시킨다.
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<RouteAwareRequest>();
    const response = http.getResponse<Response>();
    const requestId = this.ensureRequestId(request, response);

    // /metrics와 Swagger 문서 요청은 실제 API 트래픽 지표를 오염시키므로 제외한다.
    if (this.isExcludedPath(request.path)) {
      return next.handle();
    }

    const startedAt = process.hrtime.bigint();
    const method = this.getMethodLabel(request.method);
    const route = this.getRouteLabel(request);
    let statusCode: number | undefined;
    let errorToLog: unknown;
    let errorLogged = false;

    // 요청 시작 시 증가시키고 finalize에서 반드시 감소시켜 동시 처리량을 관찰한다.
    this.requestsInFlight.labels({ method, route }).inc();

    return next.handle().pipe(
      catchError((error: unknown) => {
        statusCode = this.getErrorStatusCode(error);
        errorToLog = error;
        return throwError(() => error);
      }),
      finalize(() => {
        const durationSeconds = this.getDurationSeconds(startedAt);
        const finalStatusCode = statusCode ?? response.statusCode;
        const labels = {
          method,
          route,
          status_code: finalStatusCode.toString(),
        };

        this.requestsInFlight.labels({ method, route }).dec();
        this.requestsTotal.labels(labels).inc();
        this.requestDuration.labels(labels).observe(durationSeconds);

        // 현재는 글로벌 ExceptionFilter가 없으므로 5xx 로그를 여기서 남긴다.
        // 나중에 ExceptionFilter가 5xx를 로깅하면 중복 방지를 위해 책임을 옮긴다.
        if (finalStatusCode >= 500 && !errorLogged) {
          this.logServerError({
            requestId,
            method,
            route,
            statusCode: finalStatusCode,
            durationMs: Math.round(durationSeconds * 1000),
            error: errorToLog,
          });
          errorLogged = true;
        }
      }),
    );
  }

  private ensureRequestId(request: Request, response: Response): string {
    // 클라이언트가 보낸 x-request-id가 있으면 재사용해 외부 추적 흐름을 끊지 않는다.
    const requestId = this.getIncomingRequestId(request) ?? randomUUID();
    response.setHeader('x-request-id', requestId);
    return requestId;
  }

  private getIncomingRequestId(request: Request): string | undefined {
    const header = request.headers['x-request-id'];
    const value = Array.isArray(header) ? header[0] : header;

    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private isExcludedPath(path: string): boolean {
    return HTTP_OBSERVABILITY_EXCLUDED_PATHS.some(
      (excludedPath) =>
        path === excludedPath || path.startsWith(`${excludedPath}/`),
    );
  }

  private getMethodLabel(method: string): string {
    const normalizedMethod = method.toUpperCase();

    // 임의 method가 Prometheus label을 무한히 늘리지 않도록 OTHER로 묶는다.
    return HTTP_METHOD_LABEL_ALLOWLIST.includes(normalizedMethod)
      ? normalizedMethod
      : HTTP_METHOD_LABEL_FALLBACK;
  }

  private getRouteLabel(request: Request): string {
    // 실제 URL 대신 Express route pattern을 사용해 /users/1, /users/2 같은 label 폭증을 막는다.
    const routePath = this.normalizeRoutePath(
      this.getExpressRoute(request)?.path,
    );

    if (!routePath) {
      return 'unknown';
    }

    const baseUrl = request.baseUrl ?? '';

    if (routePath.startsWith(baseUrl)) {
      return routePath;
    }

    return this.normalizeSlashes(`${baseUrl}/${routePath}`);
  }

  private getExpressRoute(request: Request): ExpressRoute | undefined {
    const route = (request as { route?: unknown }).route;

    if (typeof route !== 'object' || route === null || !('path' in route)) {
      return undefined;
    }

    return route as ExpressRoute;
  }

  private normalizeRoutePath(
    routePath: string | RegExp | Array<string | RegExp> | undefined,
  ): string | undefined {
    // 문자열 route만 안전한 label로 사용한다. RegExp 등은 낮은 cardinality의 unknown으로 보낸다.
    if (typeof routePath === 'string') {
      return this.normalizeSlashes(routePath);
    }

    if (Array.isArray(routePath) && typeof routePath[0] === 'string') {
      return this.normalizeSlashes(routePath[0]);
    }

    return undefined;
  }

  private normalizeSlashes(path: string): string {
    const normalized = path.replace(/\/+/g, '/');
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  }

  private getErrorStatusCode(error: unknown): number {
    if (error instanceof HttpException) {
      return error.getStatus();
    }

    return 500;
  }

  private getDurationSeconds(startedAt: bigint): number {
    // HTTP 요청 시간은 현실적으로 104일을 넘지 않으므로 Number 변환이 안전하다.
    return Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
  }

  private logServerError({
    requestId,
    method,
    route,
    statusCode,
    durationMs,
    error,
  }: {
    requestId: string;
    method: string;
    route: string;
    statusCode: number;
    durationMs: number;
    error: unknown;
  }) {
    const errorName = error instanceof Error ? error.name : undefined;
    const message =
      error instanceof Error
        ? error.message
        : `HTTP request completed with ${statusCode}`;

    this.logger.error({
      requestId,
      method,
      route,
      statusCode,
      durationMs,
      errorName,
      message,
    });
  }
}
