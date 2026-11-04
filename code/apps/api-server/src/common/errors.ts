import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { DomainError } from '../repositories/repository';
/** 统一处理 Nest、原生 Fastify 路由、领域及参数校验错误。 */
export class ApiExceptionFilter implements ExceptionFilter {
  /** 将异常转换为统一 HTTP 响应。
   * @param error 原始异常。
   * @param host HTTP 请求上下文。
   * @returns 无返回值，发送包含稳定错误码与请求 ID 的响应。
   */
  catch(error: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const databaseCode =
      typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    const status = ['P2002', '23505'].includes(databaseCode)
      ? 409
      : ['P2025'].includes(databaseCode)
        ? 404
        : ['23503'].includes(databaseCode)
          ? 422
          : error instanceof ZodError
            ? 400
            : error instanceof DomainError
              ? error.status
              : error instanceof HttpException
                ? error.getStatus()
                : typeof error === 'object' && error !== null && 'statusCode' in error
                  ? Number(error.statusCode)
                  : 500;
    const code =
      error instanceof DomainError
        ? error.code
        : error instanceof ZodError
          ? 'VALIDATION_ERROR'
          : status === 404
            ? 'NOT_FOUND'
            : status === 400
              ? 'BAD_REQUEST'
              : 'INTERNAL_ERROR';
    const message =
      error instanceof DomainError
        ? error.message
        : error instanceof ZodError
          ? error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
          : status === 404
            ? '未找到接口或资源'
            : status < 500
              ? '请求格式不正确'
              : '服务器处理失败';
    if (status >= 500) request.log.error(error);
    void reply.code(status >= 400 && status <= 599 ? status : 500).send({
      code,
      message,
      error: { code, message, requestId: request.id },
      requestId: request.id,
    });
  }
}
Catch()(ApiExceptionFilter);
