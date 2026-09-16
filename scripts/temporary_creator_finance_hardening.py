from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"Expected text not found in {path}: {old[:140]!r}")
    p.write_text(text.replace(old, new, 1))


ui = "src/components/StaffFinanceRecords.tsx"
replace_once(
    ui,
    '''  const [rejectionReason, setRejectionReason] = useState("");
  const { requestElevation } = useCreatorAuth();''',
    '''  const [rejectionReason, setRejectionReason] = useState("");
  const [actorRole, setActorRole] = useState("");
  const { requestElevation } = useCreatorAuth();''',
)
replace_once(
    ui,
    '''  useEffect(() => {
    void load();
  }, [load]);

  async function executePayoutAction(''',
    '''  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data: actor } = await supabase
        .from("profiles")
        .select("role")
        .eq("auth_id", auth.user.id)
        .maybeSingle();
      if (active) setActorRole(String(actor?.role || ""));
    })();
    return () => {
      active = false;
    };
  }, []);

  async function executePayoutAction(''',
)
replace_once(
    ui,
    '''    if (creatorProtected && action !== "reconcile") {''',
    '''    if ((creatorProtected || actorRole === "creator") && action !== "reconcile") {''',
)

edge = "supabase/functions/payout-withdrawal/index.ts"
replace_once(
    edge,
    '''const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

async function paystack''',
    '''const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

function jwtSessionId(token: string): string {
  try {
    const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(
      atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")),
    );
    return String(payload?.session_id || "");
  } catch {
    return "";
  }
}

async function paystack''',
)
replace_once(
    edge,
    '''    const withdrawalId = String(body?.withdrawal_id || "").trim();
    if (!withdrawalId) return json({ success: false, error: "Withdrawal ID is required" }, 400);

    if (action === "reject") {''',
    '''    const withdrawalId = String(body?.withdrawal_id || "").trim();
    if (!withdrawalId) return json({ success: false, error: "Withdrawal ID is required" }, 400);

    if (profile.role === "creator" && ["approve", "reject"].includes(action)) {
      const creatorElevationId = String(body?.creator_elevation_id || "").trim();
      const sessionId = jwtSessionId(token);
      if (
        !sessionId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          creatorElevationId,
        )
      ) {
        return json({ success: false, error: "Fresh Creator finance confirmation required" }, 403);
      }
      const { data: grant, error: grantError } = await admin
        .from("creator_elevation_grants")
        .select(
          "creator_user_id,auth_user_id,auth_session_id,action_classes,expires_at,revoked_at",
        )
        .eq("creator_elevation_id", creatorElevationId)
        .maybeSingle();
      const classes = Array.isArray(grant?.action_classes)
        ? grant.action_classes.map((value: unknown) => String(value))
        : [];
      const expiresAt = Date.parse(String(grant?.expires_at || ""));
      if (
        grantError ||
        !grant ||
        grant.creator_user_id !== profile.user_id ||
        String(grant.auth_user_id) !== user.id ||
        grant.auth_session_id !== sessionId ||
        grant.revoked_at ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= Date.now() ||
        (!classes.includes("finance_exception") &&
          !classes.includes("all_sensitive"))
      ) {
        return json({ success: false, error: "Fresh Creator finance confirmation required" }, 403);
      }
    }

    if (action === "reject") {''',
)
