"""
Themed Dashboard + Genie — Databricks App backend (FastAPI).

Responsibilities:
  1. Serve the single-page frontend (static/).
  2. Expose /api/config so the frontend knows the dashboard embed URL + Genie ID.
  3. Proxy the Genie Conversation API using a non-blocking start + poll pattern
     so long-running Genie queries never hit the Databricks Apps ~60s proxy
     timeout (each HTTP request returns quickly; the browser polls).

Auth model (see README "Permissions"):
  - Prefers the signed-in user's token (on-behalf-of) via the
    `x-forwarded-access-token` header that Databricks Apps injects. This means
    Genie answers respect each viewer's own Unity Catalog permissions.
  - Falls back to the app service principal (SDK Config) for local dev or when
    user authorization is not enabled.
"""

from __future__ import annotations

import os
from typing import Any

import requests
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import config

app = FastAPI(title="Themed Dashboard + Genie")

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
def _base_url() -> str:
    host = config.workspace_host()
    return f"https://{host}" if host else ""


def _auth_headers(request: Request) -> dict[str, str]:
    """Bearer headers: user OBO token when present, else the app SP."""
    user_token = request.headers.get("x-forwarded-access-token")
    if user_token:
        return {"Authorization": f"Bearer {user_token}"}
    # Fallback: service principal / local profile credentials.
    from databricks.sdk.core import Config

    return dict(Config().authenticate())


def _genie_url(path: str) -> str:
    return f"{_base_url()}/api/2.0/genie/spaces/{config.GENIE_SPACE_ID}{path}"


# ---------------------------------------------------------------------------
# Config endpoint — the frontend reads this to build the dashboard iframe.
# ---------------------------------------------------------------------------
@app.get("/api/config")
def get_config() -> dict[str, Any]:
    host = config.workspace_host()
    dashboard_id = config.DASHBOARD_ID
    # Published AI/BI dashboards embed at /embed/dashboardsv3/<id>.
    embed_url = (
        f"https://{host}/embed/dashboardsv3/{dashboard_id}" if host else ""
    )
    return {
        "appTitle": config.APP_TITLE,
        "defaultTheme": config.DEFAULT_THEME,
        "host": host,
        "dashboardId": dashboard_id,
        "genieSpaceId": config.GENIE_SPACE_ID,
        "dashboardEmbedUrl": embed_url,
        "configured": bool(host and dashboard_id and config.GENIE_SPACE_ID),
    }


# ---------------------------------------------------------------------------
# Genie proxy
# ---------------------------------------------------------------------------
class AskBody(BaseModel):
    content: str
    conversationId: str | None = None


@app.post("/api/genie/ask")
def genie_ask(body: AskBody, request: Request) -> JSONResponse:
    """Start a conversation (or post a follow-up). Returns IDs immediately."""
    headers = _auth_headers(request)
    headers["Content-Type"] = "application/json"
    payload = {"content": body.content}

    try:
        if body.conversationId:
            url = _genie_url(f"/conversations/{body.conversationId}/messages")
        else:
            url = _genie_url("/start-conversation")
        resp = requests.post(url, headers=headers, json=payload, timeout=30)
        resp.raise_for_status()
        data = resp.json()
    except requests.HTTPError as e:
        return JSONResponse(
            status_code=502,
            content={"error": f"Genie request failed: {e.response.status_code} {e.response.text[:300]}"},
        )
    except Exception as e:  # noqa: BLE001
        return JSONResponse(status_code=502, content={"error": str(e)})

    # start-conversation returns conversation_id + message_id at the top level;
    # a follow-up message returns the message object with id + conversation_id.
    message = data.get("message", data)
    conversation_id = (
        data.get("conversation_id")
        or message.get("conversation_id")
        or body.conversationId
    )
    message_id = data.get("message_id") or message.get("id")
    return JSONResponse(
        content={"conversationId": conversation_id, "messageId": message_id}
    )


@app.get("/api/genie/result")
def genie_result(conversationId: str, messageId: str, request: Request) -> JSONResponse:
    """Poll a single message. Returns status and, when COMPLETED, the answer."""
    headers = _auth_headers(request)
    try:
        url = _genie_url(f"/conversations/{conversationId}/messages/{messageId}")
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        msg = resp.json()
    except Exception as e:  # noqa: BLE001
        return JSONResponse(status_code=502, content={"error": str(e)})

    status = msg.get("status", "IN_PROGRESS")
    result: dict[str, Any] = {"status": status}

    if status not in ("COMPLETED",):
        if status in ("FAILED", "CANCELLED", "QUERY_RESULT_EXPIRED"):
            result["error"] = msg.get("error", {}).get("message") or status
        return JSONResponse(content=result)

    # COMPLETED: gather text + any query attachment (SQL + tabular result).
    text_parts: list[str] = []
    for att in msg.get("attachments", []) or []:
        text = att.get("text")
        if text and text.get("content"):
            text_parts.append(text["content"])

        query = att.get("query")
        if query:
            result["sql"] = query.get("query")
            if query.get("description"):
                text_parts.append(query["description"])
            att_id = att.get("attachment_id")
            try:
                q_url = _genie_url(
                    f"/conversations/{conversationId}/messages/{messageId}"
                    f"/query-result/{att_id}"
                )
                q_resp = requests.get(q_url, headers=headers, timeout=30)
                q_resp.raise_for_status()
                stmt = q_resp.json().get("statement_response", {})
                cols = [
                    c.get("name")
                    for c in stmt.get("manifest", {})
                    .get("schema", {})
                    .get("columns", [])
                ]
                rows = stmt.get("result", {}).get("data_array", []) or []
                result["columns"] = cols
                result["data"] = rows[:1000]  # guardrail on payload size
                result["rowCount"] = len(rows)
            except Exception:  # noqa: BLE001
                # Text/SQL still returned even if the result set can't be fetched.
                pass

    result["text"] = "\n\n".join(text_parts).strip()
    return JSONResponse(content=result)


# ---------------------------------------------------------------------------
# Static frontend (mounted last so /api/* wins).
# ---------------------------------------------------------------------------
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
