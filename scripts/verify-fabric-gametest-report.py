"""CI не принимает пустой XML или пропущенные обязательные harness tests."""

from pathlib import Path
import sys
import xml.etree.ElementTree as ET

report = Path(sys.argv[1])
assert report.stat().st_size <= 1024 * 1024, "Unexpected GameTest report size"
root = ET.parse(report).getroot()
cases = list(root.iter("testcase"))
assert len(cases) == 2, f"Expected two harness tests, got {len(cases)}"
expected = {"fixtureloadedonpinnedserver", "directionalblockstatesurvivestick"}
names = {case.attrib["name"].lower().rsplit(".", 1)[-1] for case in cases}
assert names == expected, names
for case in cases:
    assert not any(case.find(tag) is not None for tag in ("failure", "error", "skipped")), case.attrib
for suite in root.iter("testsuite"):
    assert int(suite.attrib.get("failures", "0")) == 0, suite.attrib
    assert int(suite.attrib.get("errors", "0")) == 0, suite.attrib
print(f"PASS: {len(cases)} required Fabric 1.20.1 harness tests")
