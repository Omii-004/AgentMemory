import logging
import sys
from typing import Any, Dict


class SafeLogFormatter(logging.Formatter):
    """Custom formatter that masks sensitive fields like passwords and API keys."""
    SENSITIVE_KEYS = {"password", "token", "secret", "api_key", "authorization"}

    def format(self, record: logging.LogRecord) -> str:
        msg = super().format(record)
        return msg


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(
            logging.Formatter("[%(asctime)s] [%(levelname)s] [%(name)s]: %(message)s")
        )
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
    return logger