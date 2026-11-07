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


def sanitize_message(message: str) -> str:
    """Mask credentials and connection strings in log messages."""
    return URI_PASSWORD_REGEX.sub(r"://\1:***@", message)


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
            log_data["exception"] = self.formatException(record.exc_info)

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
                    if isinstance(val, str) and len(val) > 500:
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


logger = logging.getLogger("rag_mcp.ai_service")

