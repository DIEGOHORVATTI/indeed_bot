import logging


def setup_logger() -> logging.Logger:
    logger = logging.getLogger("indeed_apply")
    if not logger.handlers:
        logger.setLevel(logging.INFO)
        formatter = logging.Formatter("%(asctime)s %(levelname)s: %(message)s")

        fh = logging.FileHandler("indeed_apply.log")
        fh.setFormatter(formatter)
        logger.addHandler(fh)

        ch = logging.StreamHandler()
        ch.setFormatter(formatter)
        logger.addHandler(ch)
    return logger
