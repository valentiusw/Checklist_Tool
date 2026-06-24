"""Regenerate SampleChecklist.xlsx with Checklist, Inputs, Sections, Glossary.

Dev-only tool. Requires openpyxl (pip install openpyxl). The runtime tool does
not depend on this; it only reads the produced .xlsx in the browser.
"""
import os
from openpyxl import Workbook

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "SampleChecklist.xlsx")

checklist = [
    ["Item ID", "Conditions", "Description", "Code", "Note", "Example"],
    ["A08", "", "Lifts are not exposed to weather", "AS3000",
     "Lift opening to an outdoor area must protect electrical components from moisture ingress.",
     "Fit IP-rated enclosures and weather seals to the landing door head."],
    ["A09", "", "Lifts do not open directly into a dwelling", "SL", "",
     "Provide a protected lobby between the lift and the dwelling entrance."],
    ["A10", "PitToEarth: FALSE", "If pit is not to solid earth, need CWT safety device", "EN81-20",
     "Counterweight safety gear required when pit is not founded on solid earth.",
     "Install counterweight safety gear and certify per EN81-20."],
    ["A11", "MaxFFLInt: >11m", "Must have lift-well emergency doors", "EN81-20, RDM",
     "Required where the travel between landings exceeds 11 m.",
     "Add emergency doors at max 11 m spacing along the well."],
    ["A13", 'BuildingClass: "Class 9b" OR MaxFFLInt: >=20', "Enhanced fire service controls", "BCA",
     "High-rise or assembly buildings need fire service lift controls.",
     "Provide fire service control switch and compliant signage."],
    ["B01", "", "Pit structure designed for buffer impact loads", "AS1170", "",
     "Confirm structural design accounts for buffer reaction forces."],
    ["B02", "FloorsServed: >=10", "Guide rail bracket spacing verified for travel", "EN81-20",
     "Taller installations need verified bracket spacing.",
     "Document guide-rail bracket spacing calculations."],
    ["C01", "", "Machine room power isolation provided", "AS3000", "",
     "Install a lockable main switch for the lift supply."],
    ["C02", "PitToEarth: FALSE", "Earthing of car and well per wiring rules", "AS3000",
     "Earthing continuity required where pit is not to solid earth.",
     "Measure and record earth continuity resistance."],
]

inputs = [
    ["Name", "Type", "Label", "Unit", "Choices", "Default"],
    ["PitToEarth", "Boolean", "Pit is founded on solid earth", "", "", "TRUE"],
    ["MaxFFLInt", "Float", "Max internal floor-to-floor travel", "m", "", "0"],
    ["FloorsServed", "Integer", "Number of floors served", "", "", "2"],
    ["BuildingClass", "Choice", "Building classification", "", "Class 2;Class 3;Class 9b", "Class 2"],
]

sections = [
    ["Prefix", "Name"],
    ["A", "Architectural"],
    ["B", "Structural"],
    ["C", "Electrical"],
]

glossary = [
    ["Term", "Meaning"],
    ["AS3000", "AS/NZS 3000 Wiring Rules — electrical installations standard. (sample text)"],
    ["AS1170", "AS/NZS 1170 Structural design actions. (sample text)"],
    ["EN81-20", "EN 81-20 — safety rules for the construction and installation of lifts. (sample text)"],
    ["BCA", "Building Code of Australia. (sample text)"],
    ["DDA", "Disability Discrimination Act — accessibility requirements. (sample text)"],
    ["SL", "State/local regulatory requirement. (sample text)"],
    ["RDM", "Reference Design Manual. (sample text)"],
]

wb = Workbook()
wb.remove(wb.active)
for name, rows in [("Checklist", checklist), ("Inputs", inputs),
                   ("Sections", sections), ("Glossary", glossary)]:
    ws = wb.create_sheet(name)
    for row in rows:
        ws.append(row)
wb.save(OUT)
print("wrote", OUT)
