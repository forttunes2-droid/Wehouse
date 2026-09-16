from pathlib import Path

root = Path(__file__).resolve().parents[1]
for relative in [
    "tests/main-hardening-and-boundaries.test.mjs",
    "tests/inbox-structure-contract.test.mjs",
]:
    path = root / relative
    text = path.read_text()
    text = text.replace('assert.match(communications, />Take request</);', 'assert.match(communications, /"Take request"/);')
    text = text.replace('assert.match(communications, />Take assignment</);', 'assert.match(communications, /"Take assignment"/);')
    path.write_text(text)

for relative in [
    "scripts/temporary_inbox_test_assertion_fix.py",
    ".github/workflows/temporary-inbox-test-assertion-fix.yml",
]:
    path = root / relative
    if path.exists():
        path.unlink()
print("Inbox test assertions corrected")
