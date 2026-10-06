"""简历 PDF 解析。"""
import io

from pypdf import PdfReader


def extract_pdf_text(content: bytes) -> str:
    """从 PDF 字节内容提取纯文本。"""
    reader = PdfReader(io.BytesIO(content))
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(pages)
