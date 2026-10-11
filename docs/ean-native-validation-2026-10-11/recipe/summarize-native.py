from pathlib import Path
import json
import sys
import xml.etree.ElementTree as ET

output = Path(sys.argv[1])
variant = sys.argv[2]
gtest = ET.parse(output / 'gtest.xml').getroot()
ctest = ET.parse(output / 'ctest.xml').getroot()
counts = {key: int(gtest.attrib.get(key, '0')) for key in ['tests', 'failures', 'disabled', 'errors']}
summary = {'scope': 'Actual native C++ upstream GoogleTest suite; candidate adds extracted-private-helper controls. Blackbox/photo quality is evaluated separately.', 'variant': variant, 'cppCommit': '2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4', 'googleTest': counts, 'ctestEntries': int(ctest.attrib.get('tests', '0')), 'ctestFailures': int(ctest.attrib.get('failures', '0')), 'registeredGoogleTestSuites': len(gtest.findall('testsuite'))}
helper = output / 'helper-test-provenance.json'
if helper.exists():
    summary['helperControls'] = json.loads(helper.read_text())
(output / 'summary.json').write_text(json.dumps(summary, indent=2)+'\n', encoding='utf-8')
print(json.dumps(summary))
if counts['tests'] == 0 or counts['failures'] or counts['errors'] or summary['ctestFailures']:
    raise SystemExit(1)
