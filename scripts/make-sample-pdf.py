"""Builds public/samples/arachnid-reading.pdf, the fictional paper used as the PDF sample.

Requires reportlab: pip install reportlab
"""
from pathlib import Path

from reportlab.graphics.shapes import Drawing, Line, PolyLine, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

OUT = Path(__file__).resolve().parent.parent / "public" / "samples" / "arachnid-reading.pdf"

title = ParagraphStyle("title", fontName="Times-Bold", fontSize=19, leading=23, alignment=TA_CENTER, spaceAfter=8)
authors = ParagraphStyle("authors", fontName="Times-Italic", fontSize=11, leading=14, alignment=TA_CENTER)
affil = ParagraphStyle("affil", fontName="Times-Roman", fontSize=9.5, leading=12, alignment=TA_CENTER, textColor=colors.HexColor("#444444"), spaceAfter=14)
abstract = ParagraphStyle("abstract", fontName="Times-Roman", fontSize=10, leading=13.4, alignment=TA_JUSTIFY)
h1 = ParagraphStyle("h1", fontName="Times-Bold", fontSize=12.5, leading=16, spaceBefore=12, spaceAfter=5)
body = ParagraphStyle("body", fontName="Times-Roman", fontSize=10.8, leading=14.4, alignment=TA_JUSTIFY, spaceAfter=7)
caption = ParagraphStyle("caption", fontName="Times-Italic", fontSize=9.5, leading=12, alignment=TA_CENTER, spaceBefore=4, spaceAfter=10)
ref = ParagraphStyle("ref", fontName="Times-Roman", fontSize=9.5, leading=12.5, leftIndent=14, firstLineIndent=-14, spaceAfter=3)
note = ParagraphStyle("note", fontName="Times-Italic", fontSize=8.5, leading=11, alignment=TA_CENTER, textColor=colors.HexColor("#666666"), spaceBefore=12)


def figure() -> Drawing:
    d = Drawing(150 * mm, 58 * mm)
    page = Rect(48 * mm, 2 * mm, 54 * mm, 54 * mm, strokeColor=colors.HexColor("#555555"), fillColor=colors.white, strokeWidth=0.8)
    d.add(page)
    y = 50 * mm
    for i in range(12):
        x0, x1 = 52 * mm, 98 * mm
        d.add(Line(x0, y, x1, y, strokeColor=colors.HexColor("#bbbbbb"), strokeWidth=1.6))
        if i in (2, 3, 7):
            d.add(Line(x0 + 6 * mm, y, x1 - 4 * mm, y, strokeColor=colors.HexColor("#f5c518"), strokeWidth=4))
        y -= 4 * mm
    pts = []
    y = 50 * mm
    for i in range(0, 12, 2):
        pts += [50 * mm, y, 100 * mm, y, 100 * mm, y - 4 * mm, 50 * mm, y - 4 * mm]
        y -= 8 * mm
    d.add(PolyLine(pts, strokeColor=colors.HexColor("#d6336c"), strokeWidth=0.9, strokeDashArray=[2, 1.5]))
    d.add(String(105 * mm, 46 * mm, "reading path", fontName="Times-Italic", fontSize=8.5, fillColor=colors.HexColor("#d6336c")))
    d.add(String(105 * mm, 22 * mm, "summary sentences", fontName="Times-Italic", fontSize=8.5, fillColor=colors.HexColor("#9a7a00")))
    return d


def build() -> None:
    doc = SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=24 * mm, rightMargin=24 * mm, topMargin=22 * mm, bottomMargin=20 * mm,
                            title="On the Reading Habits of Arachnids", author="I. Bitsy, W. Spout, C. Weaver")
    s = []
    s.append(Paragraph("On the Reading Habits of Arachnids: Evidence from One Thousand Crawled Documents", title))
    s.append(Paragraph("I. Bitsy, W. Spout and C. Weaver", authors))
    s.append(Paragraph("Department of Applied Silk, University of the Garden Shed", affil))
    box = Table([[Paragraph(
        "<b>Abstract.</b> We report the first systematic study of how a spider reads a document. A procedurally animated spider "
        "was released onto one thousand documents of varying length, and its path across every page was recorded. The spider did "
        "not read every word. It skimmed in a back-and-forth pattern, slowed down on the sentences that the rest of the document "
        "agreed with, and stopped to wrap the phrases that came back most often. Its summaries matched the main point of a "
        "human-written abstract in most documents, which is better than we expected and worse than the spider believes. We "
        "conclude that skimming is a respectable reading strategy for creatures with eight legs and no deadline.", abstract)]],
        colWidths=[150 * mm])
    box.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#888888")),
                             ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                             ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    s.append(box)
    s.append(Spacer(1, 6))

    s.append(Paragraph("1. Introduction", h1))
    s.append(Paragraph(
        "Humans read from left to right, line by line, with frequent jumps backward to check what they missed. Eye-tracking "
        "studies of web pages have shown that many readers do not read at all: they scan the first lines, then skim down the left "
        "side of the page in a pattern shaped like the letter F. Spiders have never been studied in this context, mostly because "
        "nobody asked them. In this paper we ask.", body))
    s.append(Paragraph(
        "Our question is simple. If a spider had to tell you what a document says, which parts would it read? We expected the "
        "spider to wander. Instead, it behaved like a careful editor with a strong opinion about adjectives.", body))

    s.append(Paragraph("2. Methods", h1))
    s.append(Paragraph(
        "Each document was laid out as pages. The spider was lowered onto the first page on a dragline. A two-bone "
        "inverse kinematics solver positioned each of its eight legs, and feet were lifted in two alternating groups of four, the "
        "tetrapod gait that real spiders use when they walk. Nothing in the animation was drawn by hand: every step is computed "
        "from where the body wants to go.", body))
    s.append(Paragraph(
        "To decide what deserved attention, sentences were ranked with TextRank, a graph method in which a sentence that resembles "
        "many other sentences rises to the top. Redundant sentences were removed with maximal marginal relevance, so that the "
        "summary would not say the same thing three times. Keywords were extracted from runs of content words between stopwords, "
        "and the spider was instructed to catch one occurrence of each keyword and wrap it in silk.", body))
    s.append(figure())
    s.append(Paragraph("Figure 1. The reading path on a typical page. Highlighted segments mark the sentences selected for the summary.", caption))

    s.append(Paragraph("3. Results", h1))
    s.append(Paragraph(
        "Short documents were read almost line by line. Long documents were skimmed: the spider covered every page but walked "
        "fully only across the lines that contained a summary sentence or a keyword. On average the spider spun a little over "
        "four meters of silk per document and took several thousand steps, most of them in the margins.", body))
    s.append(Paragraph(
        "The keyword caught most often across the corpus was the word data, which the spider wrapped without enthusiasm. The "
        "longest pause was recorded on a contract, where the spider spent nine seconds on a single clause about automatic renewal. "
        "We consider this the most human behavior observed in the study.", body))

    s.append(Paragraph("4. Discussion", h1))
    s.append(Paragraph(
        "Our findings suggest that a good summary does not require reading every word, only the right ones. The sentences a "
        "document agrees with are usually the ones it is about, and the phrases it keeps repeating are usually its keywords. A "
        "spider that knows this can skim with confidence.", body))
    s.append(Paragraph(
        "Several limitations apply. The spider cannot read scanned pages, it has no opinion about images, and it ignores footnotes "
        "on principle. Future work will examine whether the spider reads faster after coffee, and whether it can be trained to "
        "skip the terms and conditions entirely.", body))

    s.append(Paragraph("References", h1))
    for r in [
        "[1] Mihalcea, R. and Tarau, P. (2004). TextRank: Bringing order into texts. Proceedings of EMNLP 2004.",
        "[2] Rose, S., Engel, D., Cramer, N. and Cowley, W. (2010). Automatic keyword extraction from individual documents. In Text Mining: Applications and Theory. Wiley.",
        "[3] Carbonell, J. and Goldstein, J. (1998). The use of MMR, diversity-based reranking for reordering documents and producing summaries. Proceedings of SIGIR 1998.",
        "[4] Brysbaert, M. (2019). How many words do we read per minute? A review and meta-analysis of reading rate. Journal of Memory and Language, 109.",
        "[5] White, E. B. (1952). Charlotte's Web. Harper and Brothers.",
    ]:
        s.append(Paragraph(r, ref))
    s.append(Paragraph("This paper is a work of fiction written for the Spider Crawler demo. No spiders were harmed.", note))
    doc.build(s)


if __name__ == "__main__":
    build()
    print(f"wrote {OUT}")
