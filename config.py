"""
Central configuration for the Themed Dashboard + Genie app.

╔══════════════════════════════════════════════════════════════════════════╗
║  CUSTOMER: THIS IS THE ONLY FILE (plus app.yaml) YOU NEED TO EDIT.         ║
║                                                                            ║
║  1. Set DASHBOARD_ID   -> your published AI/BI dashboard ID                ║
║  2. Set GENIE_SPACE_ID -> your Genie space ID                              ║
║                                                                            ║
║  You can set them here as fallbacks, OR (preferred for deployment) set     ║
║  them as environment variables in app.yaml. Env vars always win.           ║
╚══════════════════════════════════════════════════════════════════════════╝

Where to find the IDs
----------------------
- Dashboard ID: open your published AI/BI dashboard. The URL looks like
  .../dashboardsv3/<DASHBOARD_ID>/published  -> copy the <DASHBOARD_ID> part.
- Genie space ID: open your Genie space. The URL looks like
  .../genie/rooms/<GENIE_SPACE_ID>  -> copy the <GENIE_SPACE_ID> part.
"""

import os

# ---------------------------------------------------------------------------
# The two IDs the customer swaps. Env vars (from app.yaml) override these.
# The defaults below point at placeholder assets in the original build
# workspace so the app runs out of the box for the author.
# ---------------------------------------------------------------------------
DASHBOARD_ID: str = os.getenv(
    "DASHBOARD_ID", "01f1a88db2fc1a5f843fe617311b5cc2"
)
GENIE_SPACE_ID: str = os.getenv(
    "GENIE_SPACE_ID", "01f1a88b5c6613f9ad5a4383a3b81a6b"
)

# ---------------------------------------------------------------------------
# Workspace host. On Databricks Apps this is auto-injected as DATABRICKS_HOST.
# Locally, the Databricks SDK Config() will resolve it from your profile.
# ---------------------------------------------------------------------------
def workspace_host() -> str:
    """Return the workspace hostname (no scheme), e.g. adb-123.4.azuredatabricks.net."""
    host = os.getenv("DATABRICKS_HOST", "")
    if not host:
        try:
            from databricks.sdk.core import Config

            host = Config().host or ""
        except Exception:
            host = ""
    # Normalize: strip scheme and trailing slash.
    return host.replace("https://", "").replace("http://", "").rstrip("/")


# Optional branding overrides (safe defaults; customer may tweak).
APP_TITLE: str = os.getenv("APP_TITLE", "Analytics Hub")
# Which theme loads first. One of: stlukes, boisestate, motorcycle, uidaho
DEFAULT_THEME: str = os.getenv("DEFAULT_THEME", "stlukes")

# How long the Genie proxy waits per poll before returning "still working".
# The frontend polls repeatedly, so this stays well under the Apps 60s proxy
# timeout to avoid 504s on long-running Genie queries.
GENIE_POLL_TIMEOUT_SECONDS: int = int(os.getenv("GENIE_POLL_TIMEOUT_SECONDS", "10"))
