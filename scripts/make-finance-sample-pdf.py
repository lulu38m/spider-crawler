"""Builds public/samples/silkworks-q3-2026.pdf, the fictional earnings release used as the finance sample.

Orbweaver Silkworks is made up for the Spider Crawler demo: every name and number in it is invented.

Requires reportlab: pip install reportlab
"""
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

OUT = Path(__file__).resolve().parent.parent / "public" / "samples" / "silkworks-q3-2026.pdf"

INK = colors.HexColor("#1d2333")
ACCENT = colors.HexColor("#1f6f5c")
MUTED = colors.HexColor("#5b6275")

kicker = ParagraphStyle("kicker", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=ACCENT, spaceAfter=4)
title = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=INK, spaceAfter=6)
dek = ParagraphStyle("dek", fontName="Helvetica", fontSize=11.5, leading=15, textColor=MUTED, spaceAfter=12)
h1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=ACCENT, spaceBefore=10, spaceAfter=5)
body = ParagraphStyle("body", fontName="Helvetica", fontSize=10.2, leading=14.2, textColor=INK, alignment=TA_JUSTIFY, spaceAfter=7)
bullet = ParagraphStyle("bullet", parent=body, spaceAfter=3)
quote = ParagraphStyle("quote", fontName="Helvetica-Oblique", fontSize=10.5, leading=14.5, textColor=INK, leftIndent=10, spaceAfter=9)
cell = ParagraphStyle("cell", fontName="Helvetica", fontSize=9.2, leading=11.5, textColor=INK)
cell_b = ParagraphStyle("cellb", parent=cell, fontName="Helvetica-Bold")
note = ParagraphStyle("note", fontName="Helvetica-Oblique", fontSize=8.2, leading=10.5, textColor=MUTED, spaceBefore=12)


def table() -> Table:
    rows = [
        ["(in millions of dollars, except per share)", "Q3 2026", "Q3 2025", "Change"],
        ["Revenue", "412.6", "349.7", "+18%"],
        ["Gross profit", "253.3", "206.6", "+23%"],
        ["Operating income", "58.1", "39.7", "+46%"],
        ["Net income", "44.3", "33.8", "+31%"],
        ["Diluted earnings per share ($)", "1.12", "0.86", "+30%"],
        ["Free cash flow", "71.0", "52.4", "+35%"],
    ]
    data = [[Paragraph(c, cell_b if r == 0 or i == 0 else cell) for i, c in enumerate(row)] for r, row in enumerate(rows)]
    t = Table(data, colWidths=[72 * mm, 26 * mm, 26 * mm, 24 * mm])
    t.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK),
        ("LINEBELOW", (0, 1), (-1, -1), 0.3, colors.HexColor("#d4d8e2")),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def build() -> None:
    doc = SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=24 * mm, rightMargin=24 * mm, topMargin=20 * mm, bottomMargin=18 * mm,
                            title="Orbweaver Silkworks reports third quarter 2026 results", author="Orbweaver Silkworks (fictional)")
    s = []
    s.append(Paragraph("EARNINGS RELEASE · FICTIONAL COMPANY", kicker))
    s.append(Paragraph("Orbweaver Silkworks reports third quarter 2026 results", title))
    s.append(Paragraph("Record dragline demand lifts revenue 18%; full-year outlook raised", dek))

    s.append(Paragraph(
        "PORTLAND, October 22, 2026. Orbweaver Silkworks, Inc., the maker of spider-silk fibers for climbing ropes, surgical "
        "sutures and very small parachutes, today reported financial results for the third quarter of fiscal 2026, which ended "
        "on September 30, 2026.", body))

    s.append(Paragraph("Third quarter highlights", h1))
    items = [
        "Revenue grew 18% year over year to $412.6 million, driven by strong demand for dragline fiber.",
        "Gross margin was 61.4%, up 230 basis points from a year ago, as the new web farms reached full speed.",
        "Net income was $44.3 million, up 31% from the prior year.",
        "Free cash flow reached $71.0 million, and net debt fell to $120 million.",
    ]
    s.append(ListFlowable([ListItem(Paragraph(t, bullet), leftIndent=12, value="•") for t in items], bulletType="bullet", start="•", leftIndent=12))

    s.append(Paragraph(
        "“We have never spun this fast,” said Charlotte Weaver, chief executive officer. “Customers want fibers that are "
        "stronger than steel and lighter than cotton, and our spiders have been working nights to deliver them. We are raising "
        "our outlook for the year.”", quote))

    s.append(Paragraph("Financial results", h1))
    s.append(Paragraph(
        "Revenue for the third quarter was $412.6 million, compared with $349.7 million in the third quarter of 2025. Dragline "
        "fiber, now 64% of sales, grew 24%, while capture-spiral products grew 7%. Revenue from the medical segment, which sells "
        "silk sutures to hospitals, rose 15% to $88.2 million.", body))
    s.append(Paragraph(
        "Operating income rose 46% to $58.1 million, compared with $39.7 million a year ago. The operating margin was 14.1%, up "
        "280 basis points, helped by lower feed costs: the spiders were fed fewer, larger flies. Research and development "
        "expenses were $31.5 million, as the company kept working on a silk that does not stick to itself.", body))
    s.append(Paragraph(
        "Net income was $44.3 million, or $1.12 per diluted share, compared with $33.8 million, or $0.86 per diluted share, in "
        "the third quarter of 2025. Diluted earnings per share were $1.12, up 30% from a year ago.", body))
    s.append(Spacer(1, 4))
    s.append(table())
    s.append(Spacer(1, 6))

    s.append(Paragraph("Cash and balance sheet", h1))
    s.append(Paragraph(
        "Free cash flow was $71.0 million for the quarter, up 35%. Orbweaver ended the quarter with $214 million in cash and net "
        "debt of $120 million, down from $187 million at the end of 2025. The board declared a quarterly dividend of $0.24 per "
        "share, payable on November 30, 2026.", body))

    s.append(Paragraph("Outlook", h1))
    s.append(Paragraph(
        "For the full fiscal year 2026, the company now expects revenue of $1.60 billion to $1.62 billion, up from its previous "
        "outlook of $1.55 billion, and an operating margin of about 14%. The outlook assumes normal weather and no major shortage "
        "of flies.", body))

    s.append(Paragraph(
        "Orbweaver Silkworks is a fictional company invented for the Spider Crawler demo. Every name and number in this document "
        "is made up. Nothing here is financial information or advice.", note))
    doc.build(s)


if __name__ == "__main__":
    build()
    print(f"wrote {OUT}")
