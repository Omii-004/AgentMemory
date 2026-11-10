import logging
import re
import sys


class SafeLogFormatter(logging.Formatter):
    """Custom formatter that masks sensitive fields like passwords, tokens, and API keys."""

    _BEARER_RE = re.compile(r"(Bearer\s+)[A-Za-z0-9\-_\.=]+", re.IGNORECASE)
    _KV_SECRET_RE = re.compile(
        r'(["\']?(?:password|passwd|token|access_token|refresh_token|secret|secret_key|api_key|authorization)["\']?\s*[:=]\s*)(["\']?)[^,\s\]\}\)"\']+\2',
        re.IGNORECASE,
    )

    def format(self, record: logging.LogRecord) -> str:
        msg = super().format(record)
        msg = self._BEARER_RE.sub(r"\1[REDACTED]", msg)
        msg = self._KV_SECRET_RE.sub(r"\1[REDACTED]", msg)
        return msg


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(
            SafeLogFormatter("[%(asctime)s] [%(levelname)s] [%(name)s]: %(message)s")
        )
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
    return logger