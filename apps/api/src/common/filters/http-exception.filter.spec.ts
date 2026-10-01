import { BadRequestException, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ErrorCode } from '../errors/error-code';
import { DomainException } from '../errors/domain.exception';
import { HttpExceptionFilter } from './http-exception.filter';

interface MockResponse {
  status: jest.Mock<number, [number]>;
  json: jest.Mock<void, [unknown]>;
}

interface MockHost {
  host: ArgumentsHost;
  response: MockResponse;
}

function createHost(originalUrl = '/api/v1/e/no-existe'): MockHost {
  const response: MockResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };

  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', originalUrl }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return { host, response };
}

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('respeta el code de una DomainException', () => {
    const { host, response } = createHost();
    const exception = new DomainException(
      {
        code: ErrorCode.SLUG_NOT_FOUND,
        message: "No existe un endpoint con slug 'no-existe'",
      },
      HttpStatus.NOT_FOUND,
    );

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.NOT_FOUND,
      code: ErrorCode.SLUG_NOT_FOUND,
      message: "No existe un endpoint con slug 'no-existe'",
      details: null,
      path: '/api/v1/e/no-existe',
      timestamp: expect.any(String),
    });
  });

  it('mapea el 400 del ValidationPipe a VALIDATION_ERROR con details', () => {
    const { host, response } = createHost('/api/v1/sources');
    const exception = new BadRequestException({
      message: ['name debe ser una cadena', 'type debe ser uno de los valores following: api'],
      error: 'Bad Request',
      statusCode: HttpStatus.BAD_REQUEST,
    });

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Datos inválidos',
      details: ['name debe ser una cadena', 'type debe ser uno de los valores following: api'],
      path: '/api/v1/sources',
      timestamp: expect.any(String),
    });
  });

  it('deriva el code de una excepción de Nest sin code', () => {
    const { host, response } = createHost('/api/v1/no-existe');

    filter.catch(new NotFoundException('Cannot GET /api/v1/no-existe'), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: ErrorCode.ROUTE_NOT_FOUND,
        message: 'Cannot GET /api/v1/no-existe',
        details: null,
      }),
    );
  });

  it('nunca filtra el mensaje de un error inesperado', () => {
    const { host, response } = createHost('/api/v1/sources');

    filter.catch(new Error('mongodb://user:pass@hostadmin no se pudo leer'), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Error interno',
        details: null,
      }),
    );
  });
});
