import os
import logging
from dotenv import load_dotenv
from logging.handlers import RotatingFileHandler

load_dotenv("configs/.env")

LOG_DIRECTORY = os.getenv("LOG_DIRECTORY", "logs")
LOG_NAME = os.getenv("LOG_NAME", "app.log")
LOG_MAX_BYTES = int(os.getenv("LOG_MAX_BYTES", 10**9))
_raw_log_level = os.getenv("LOG_LEVEL", "INFO").upper()
LOG_LEVEL = getattr(logging, _raw_log_level, logging.INFO)


def setup_logging(
    log_dir=LOG_DIRECTORY,
    log_level=LOG_LEVEL,
    log_file=LOG_NAME,
    max_bytes=LOG_MAX_BYTES,
    backup_count=5,
):
    os.makedirs(log_dir, exist_ok=True)

    log_format = logging.Formatter(
        "%(asctime)s - %(levelname)s - %(name)s - %(message)s"
    )

    file_handler = RotatingFileHandler(
        os.path.join(log_dir, log_file), maxBytes=max_bytes, backupCount=backup_count
    )
    file_handler.setFormatter(log_format)
    file_handler.setLevel(log_level)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(log_format)
    console_handler.setLevel(log_level)

    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)
    root_logger.addHandler(file_handler)
    root_logger.addHandler(console_handler)

    return root_logger


setup_logging()


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
