from pathlib import Path

path = Path("src/pages/AdminDashboard.tsx")
text = path.read_text()

def once(old: str, new: str) -> None:
    global text
    if old not in text:
        raise SystemExit(f"Expected AdminDashboard text not found: {old[:100]!r}")
    text = text.replace(old, new, 1)

once(
    'import AccountIdentityReviewQueue from "@/components/AccountIdentityReviewQueue";\n',
    'import AccountIdentityReviewQueue from "@/components/AccountIdentityReviewQueue";\nimport AdminSecurityCases from "@/components/AdminSecurityCases";\n',
)
once(
    'type Operation = "people" | "staff" | "properties" | "workers" | "bookings";',
    'type Operation = "people" | "staff" | "properties" | "workers" | "bookings" | "security";',
)
once(
    '    "People, team, properties, workers and bookings in one branch workspace.",',
    '    "People, team, properties, workers, bookings and security decisions in one branch workspace.",',
)
once(
'''  [
    "bookings",
    "Bookings",
    "Worker services, apartment reservations and hotel stays",
  ],
];''',
'''  [
    "bookings",
    "Bookings",
    "Worker services, apartment reservations and hotel stays",
  ],
  [
    "security",
    "Security",
    "Security Operations escalations and branch account decisions",
  ],
];''',
)
once(
    '    if (route.includes("worker")) return openOperation("workers", id);\n    onNavigate?.(page, id);',
    '    if (route.includes("worker")) return openOperation("workers", id);\n    if (route.includes("security")) return openOperation("security", id);\n    onNavigate?.(page, id);',
)
once(
'''      {active === "bookings" && (
        <BookingsWorkspace
          initialRecordId={target?.operation === "bookings" ? target.id : undefined}
        />
      )}{" "}
    </div>''',
'''      {active === "bookings" && (
        <BookingsWorkspace
          initialRecordId={target?.operation === "bookings" ? target.id : undefined}
        />
      )}{" "}
      {active === "security" && (
        <AdminSecurityCases
          onViewAccount={onView}
          initialCaseId={target?.operation === "security" ? target.id : undefined}
        />
      )}{" "}
    </div>''',
)

path.write_text(text)
