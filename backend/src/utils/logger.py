import os
import logging
from dotenv import load_dotenv
from logging.handlers import RotatingFileHandler

load_dotenv("configs/.env")

LOG_DIRECTORY = os.getenv("LOG_DIRECTORY")
LOG_NAME = os.getenv("LOG_NAME")
LOG_MAX_BYTES = int(os.getenv("LOG_MAX_BYTES", 10**9))
LOG_LEVEL = os.getenv("LOG_LEVEL")


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
        extra.setdefault("session_id", "N/A")
        super()._log(level, msg, args, exc_info, extra, stack_info, stacklevel)


class SafeFormatter(logging.Formatter):
    def format(self, record):
        # Set a default value for session_id if it's not already set
        record.session_id = getattr(record, "session_id", "N/A")
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
        "%(asctime)s - %(levelname)s - %(name)s - %(session_id)s - %(message)s"
    )

    # Set up a general log file
    file_handler = RotatingFileHandler(
        os.path.join(log_dir, log_file), maxBytes=max_bytes, backupCount=backup_count
    )
    file_handler.setFormatter(log_format)
    file_handler.setLevel(log_level)

    # Set up a console handler for development purposes
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(log_format)
    console_handler.setLevel(log_level)

    # Configure root logger
    logger = logging.getLogger()
    logger.setLevel(log_level)
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

    return logger


# Initialize logging when this module is imported
logger = setup_logging()


def get_logger(name):
    return logging.getLogger(name)


