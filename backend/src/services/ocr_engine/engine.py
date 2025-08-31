from __future__ import annotations

import io
from typing import Literal

import pytesseract
from PIL import Image


class OCREngine:
    def __init__(self, backend: Literal["tesseract"] = "tesseract"):
        self.backend = backend

    def image_bytes_to_text(self, data: bytes) -> str:
        image = Image.open(io.BytesIO(data))
        return pytesseract.image_to_string(image)


