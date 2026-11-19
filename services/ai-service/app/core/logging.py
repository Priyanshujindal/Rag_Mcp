import json
import logging
import re
import sys
import time
from contextvars import ContextVar
from typing import Any

# ContextVar for tracing request IDs across async tasks
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="")

# Regex pattern to sanitize MongoDB URIs and sensitive keys if accidentally logged
URI_PASSWORD_REGEX = re.compile(r"://([^:]+):([^@]+)@")
# API keys / tokens passed as URL query parameters (e.g. "?key=...", "&api_key=...")
SECRET_QUERY_REGEX = re.compile(
    r"([?&](?:key|api_key|apikey|access_token|token)=)[^&\s\"']+", re.IGNORECASE
)
# "Authorization: Bearer <token>" style values
BEARER_REGEX = re.compile(r"(Bearer\s+)[A-Za-z0-9._\-]+", re.IGNORECASE)
# Google API key headers echoed in text
GOOG_HEADER_REGEX = re.compile(r"(x-goog-api-key['\"]?\s*[:=]\s*['\"]?)[^\s,'\"}]+", re.IGNORECASE)


def sanitize_message(message: str) -> str:
    """Mask credentials, API keys and connection strings in log messages."""
    message = URI_PASSWORD_REGEX.sub(r"://\1:***@", message)
    message = SECRET_QUERY_REGEX.sub(r"\1***", message)
    message = BEARER_REGEX.sub(r"\1***", message)
    message = GOOG_HEADER_REGEX.sub(r"\1***", message)
    return message


class JSONFormatter(logging.Formatter):
    """
    Structured JSON log formatter for production and cloud log aggregators.
    Formats logs as JSON lines with timestamp, level, message, logger, and request_id.
    """

    def format(self, record: logging.LogRecord) -> str:
        log_data: dict[str, Any] = {
            "timestamp": self.formatTime(record, self.datefmt or "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": sanitize_message(record.getMessage()),
        }

        req_id = request_id_ctx.get()
        if req_id:
            log_data["requestId"] = req_id

        if record.exc_info:
            log_data["exception"] = sanitize_message(self.formatException(record.exc_info))

        # Include custom extra fields if passed
        for key, val in record.__dict__.items():
            if key not in (
                "args", "asctime", "created", "exc_info", "exc_text", "filename",
                "funcName", "id", "levelname", "levelno", "lineno", "module",
                "msecs", "message", "msg", "name", "pathname", "process",
                "processName", "relativeCreated", "stack_info", "thread",
                "threadName",
            ):
                # Avoid logging full document text or huge objects
                if isinstance(val, (str, int, float, bool, list, dict)) or val is None:
                    if isinstance(val, str):
                        val = sanitize_message(val)
                        if len(val) > 500:
                            val = val[:500] + "...[truncated]"
                    log_data[key] = val

        return json.dumps(log_data)


def setup_logging(level: str = "INFO") -> None:
    """Configure root logger with structured JSON formatting."""
    root_logger = logging.getLogger()
    root_logger.setLevel(level.upper())

    # Remove existing handlers to avoid duplicates
    for handler in list(root_logger.handlers):
        root_logger.removeHandler(handler)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())
    root_logger.addHandler(handler)

    # Silence overly verbose external loggers
    logging.getLogger("uvicorn.access").handlers = [handler]
    logging.getLogger("uvicorn.error").handlers = [handler]
    logging.getLogger("fastembed").setLevel(logging.WARNING)
    # httpx logs the full request URL at INFO level for every call; keep it quiet so
    # URLs (and any credentials in them) never reach the logs.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


logger = logging.getLogger("rag_mcp.ai_service")

