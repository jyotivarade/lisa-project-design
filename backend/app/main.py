"""FastAPI application factory.

Every error leaving this application is `{error_code, message, details, request_id}`
(spec section 25). Raw exception text is logged against the request id and never
returned to a client.
"""

import logging
import uuid
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1 import api_router
from app.core.config import Settings, get_settings
from app.core.errors import ErrorCode, LisaError
from app.core.logging import configure_logging, request_id_var

logger = logging.getLogger(__name__)


def _error_response(
    status_code: int, error_code: str, message: str, details: list | None = None
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error_code": error_code,
            "message": message,
            "details": details or [],
            "request_id": request_id_var.get(),
        },
    )


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(LisaError)
    async def _lisa_error(_: Request, exc: LisaError) -> JSONResponse:
        # Expected, explainable failures: logged at info, returned verbatim.
        logger.info("handled error", extra={"error_code": exc.error_code})
        return _error_response(exc.status_code, exc.error_code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {
                "field": ".".join(str(p) for p in err.get("loc", ())),
                "issue": err.get("msg", ""),
            }
            for err in exc.errors()
        ]
        return _error_response(
            422, ErrorCode.VALIDATION_ERROR, "Request validation failed.", details
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = ErrorCode.NOT_FOUND if exc.status_code == 404 else ErrorCode.VALIDATION_ERROR
        return _error_response(exc.status_code, code, str(exc.detail))

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        # The detail goes to the log with the request id; the client gets nothing
        # it could use to probe the system.
        logger.exception("unhandled exception", extra={"error_type": type(exc).__name__})
        return _error_response(
            500, ErrorCode.INTERNAL_ERROR, "An internal error occurred."
        )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.log_json)

    app = FastAPI(
        title="LISA — Laboratory Information System Analysis",
        version="0.1.0",
        openapi_url=f"{settings.api_prefix}/openapi.json",
        docs_url=f"{settings.api_prefix}/docs",
        redoc_url=None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def request_context(
        request: Request, call_next: Callable[[Request], Awaitable]
    ):
        rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        token = request_id_var.set(rid)
        try:
            response = await call_next(request)
            response.headers["X-Request-ID"] = rid
            return response
        finally:
            request_id_var.reset(token)

    register_exception_handlers(app)
    app.include_router(api_router, prefix=settings.api_prefix)
    return app


app = create_app()
