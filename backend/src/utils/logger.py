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


class CustomLogger(logging.Logger):
    def _log(
        self,
        level,
        msg,
        args,
        exc_info=None,
        extra=None,
        stack_info=False,
        stacklevel=1,
    ):
        if extra is None:
            extra = {}
        extra.setdefault("job_id", "N/A")
        super()._log(level, msg, args, exc_info, extra, stack_info, stacklevel)


class SafeFormatter(logging.Formatter):
    def format(self, record):
        record.job_id = getattr(record, "job_id", "N/A")
        return super().format(record)


# Register the custom logger class
logging.setLoggerClass(CustomLogger)


def setup_logging(
    log_dir=LOG_DIRECTORY,
    log_level=LOG_LEVEL,
    log_file=LOG_NAME,
    max_bytes=LOG_MAX_BYTES,
    backup_count=5,
):
    os.makedirs(log_dir, exist_ok=True)

    log_format = SafeFormatter(
        "%(asctime)s - %(levelname)s - %(name)s [%(job_id)s] - %(message)s"
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

    # Prevent duplicate handlers when module is imported multiple times
    root_logger.handlers.clear()

    root_logger.addHandler(file_handler)
    root_logger.addHandler(console_handler)

    return root_logger


setup_logging()


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
