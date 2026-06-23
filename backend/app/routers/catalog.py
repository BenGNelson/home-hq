"""
/api/catalog — a read-only view of the home catalog: a floor-by-floor inventory
of the house (smart devices cross-referenced to Home Assistant, appliances, AND
the non-HA physical stuff — tools, 3D printer, computers, network gear).

Same file-backed, no-secrets shape as /api/ha and the doc viewers: a host-side
YAML file is mounted read-only into the container and we parse + shape it here.
The file has real room/device names, so it lives OUTSIDE the repo (CATALOG_FILE
in .env points at it; the committed default is a generic example).

The shaping (prettify labels, normalize items, compute stats) lives in the pure
`summarize()` so it stays unit-tested; the route is a thin wrapper.
"""

import yaml
from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.config import settings

router = APIRouter()


class CatalogItem(BaseModel):
    name: str = Field(description="What it is, e.g. 'Bambu P1S 3D printer'")
    category: str | None = Field(default=None, description="device|appliance|tool|equipment|furniture|infrastructure|network|vehicle")
    brand: str | None = None
    model: str | None = None
    in_ha: bool = Field(default=False, description="True if integrated into Home Assistant")
    entity: str | None = Field(default=None, description="HA entity id, when in_ha")
    qty: str | None = Field(default=None, description="Quantity, when more than one")
    notes: str | None = None
    flag: bool = Field(default=False, description="True when notes carry a ⚠️ to-confirm marker")


class CatalogRoom(BaseModel):
    id: str
    label: str
    items: list[CatalogItem] = []


class CatalogFloor(BaseModel):
    id: str
    label: str
    rooms: list[CatalogRoom] = []


class CatalogGroup(BaseModel):
    label: str
    items: list[CatalogItem] = []
    topology: str | None = Field(default=None, description="Free-text topology note (infrastructure only)")


class CatalogStats(BaseModel):
    total: int
    in_ha: int
    flagged: int = Field(description="Items with a ⚠️ to-confirm marker")
    by_category: dict[str, int] = {}


class CatalogMeta(BaseModel):
    last_updated: str | None = None
    scope: str | None = None
    ha_summary: str | None = None


class CatalogModel(BaseModel):
    available: bool = Field(description="True when the catalog file parsed OK")
    reason: str | None = Field(default=None, description="When unavailable: no_data")
    meta: CatalogMeta | None = None
    floors: list[CatalogFloor] = []
    outside: CatalogGroup | None = None
    spares: CatalogGroup | None = None
    infrastructure: CatalogGroup | None = None
    stats: CatalogStats | None = None


def _norm_item(it):
    """Normalize one raw item dict. Pure + defensive — a non-dict or one missing
    a name is dropped (returns None)."""
    if not isinstance(it, dict):
        return None
    name = it.get("name")
    if not name or not isinstance(name, str):
        return None
    notes = it.get("notes")
    notes = str(notes) if notes is not None else None
    qty = it.get("qty")
    qty = str(qty) if qty is not None else None
    # category is coerced to a string (like model/qty): it's used as a dict key in
    # the stats tally (a non-hashable YAML value like a list would crash) and as a
    # label on the frontend (a non-string would crash categoryLabel).
    return {
        "name": name,
        "category": (str(it["category"]) if it.get("category") else None),
        "brand": (it.get("brand") or None),
        "model": (str(it["model"]) if it.get("model") is not None else None),
        "in_ha": bool(it.get("in_ha", False)),
        "entity": (it.get("entity") or None),
        "qty": qty,
        "notes": notes,
        "flag": bool(notes and "⚠️" in notes),
    }


def _norm_items(lst):
    if not isinstance(lst, list):
        return []
    return [n for n in (_norm_item(i) for i in lst) if n]


def _prettify(key):
    """room/floor key -> display label. 'main_bedroom' -> 'Main Bedroom'."""
    return str(key).replace("_", " ").title()


def _group(node, label):
    if not isinstance(node, dict):
        return None
    return {"label": label, "items": _norm_items(node.get("items")), "topology": None}


def _unavailable(reason="no_data"):
    return {
        "available": False,
        "reason": reason,
        "meta": None,
        "floors": [],
        "outside": None,
        "spares": None,
        "infrastructure": None,
        "stats": None,
    }


def summarize(data):
    """Map the raw parsed YAML into the API model. Pure + defensive."""
    if not isinstance(data, dict) or not data:
        return _unavailable()

    # Floors -> rooms (preserve file order; it follows the physical layout).
    floors_out = []
    floors = data.get("floors")
    if isinstance(floors, dict):
        for fkey, fval in floors.items():
            if not isinstance(fval, dict):
                continue
            rooms = []
            for rkey, rval in fval.items():
                items = _norm_items(rval.get("items")) if isinstance(rval, dict) else []
                rooms.append({"id": rkey, "label": _prettify(rkey), "items": items})
            floors_out.append({"id": fkey, "label": _prettify(fkey), "rooms": rooms})

    outside = _group(data.get("outside"), "Outside")
    spares = _group(data.get("spares"), "Spares")

    # Infrastructure: a free-text topology note + any list-valued sub-keys
    # (mobile_devices, security, ...) folded into one item list.
    infrastructure = None
    infra_node = data.get("infrastructure")
    if isinstance(infra_node, dict):
        topo = infra_node.get("network_topology")
        topo = " ".join(str(topo).split()) if topo else None
        items = []
        for v in infra_node.values():
            if isinstance(v, list):
                items.extend(_norm_items(v))
        infrastructure = {"label": "Infrastructure", "items": items, "topology": topo}

    # Stats across everything.
    all_items = []
    for f in floors_out:
        for r in f["rooms"]:
            all_items.extend(r["items"])
    for g in (outside, spares, infrastructure):
        if g:
            all_items.extend(g["items"])
    by_cat = {}
    in_ha = 0
    flagged = 0
    for it in all_items:
        cat = it["category"] or "other"
        by_cat[cat] = by_cat.get(cat, 0) + 1
        if it["in_ha"]:
            in_ha += 1
        if it["flag"]:
            flagged += 1
    stats = {"total": len(all_items), "in_ha": in_ha, "flagged": flagged, "by_category": by_cat}

    m = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    meta = {
        "last_updated": (str(m["last_updated"]) if m.get("last_updated") is not None else None),
        "scope": m.get("scope"),
        "ha_summary": m.get("ha_summary"),
    }

    return {
        "available": True,
        "reason": None,
        "meta": meta,
        "floors": floors_out,
        "outside": outside,
        "spares": spares,
        "infrastructure": infrastructure,
        "stats": stats,
    }


def get_catalog():
    """Read + summarize the catalog file. Missing/garbage -> available:false."""
    try:
        with open(settings.catalog_path, encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
    except (FileNotFoundError, OSError, yaml.YAMLError):
        return _unavailable()
    return summarize(data)


@router.get("/catalog", response_model=CatalogModel, response_model_exclude_none=True)
def catalog():
    return get_catalog()
