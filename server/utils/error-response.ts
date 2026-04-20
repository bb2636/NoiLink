/**
 * 표준 에러 응답 헬퍼
 *
 * 운영(production)에서는 내부 에러 메시지를 클라이언트에 노출하지 않음.
 * 개발/스테이징에서는 디버깅 편의를 위해 dev 메시지 포함.
 * 모든 호출은 항상 서버 로그에 상세 기록.
 */
import type { Response } from 'express';

const isProduction = process.env.NODE_ENV === 'production';

export interface ErrorPayload {
  success: false;
  error: string;
  code?: string;
  devError?: string;
}

export function sendError(
  res: Response,
  status: number,
  publicMessage: string,
  opts: { code?: string; cause?: unknown; logContext?: Record<string, unknown> } = {}
): Response {
  const { code, cause, logContext } = opts;
  const causeMsg = cause instanceof Error ? cause.message : (cause ? String(cause) : undefined);

  if (cause) {
    console.error(
      `[error] status=${status} code=${code ?? '-'} msg="${publicMessage}"`,
      logContext ?? '',
      cause instanceof Error ? cause.stack : cause
    );
  }

  const payload: ErrorPayload = {
    success: false,
    error: publicMessage,
    ...(code ? { code } : {}),
    ...(!isProduction && causeMsg ? { devError: causeMsg } : {}),
  };

  return res.status(status).json(payload);
}
