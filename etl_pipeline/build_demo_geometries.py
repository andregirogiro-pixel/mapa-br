#!/usr/bin/env python3
"""Gera polígonos SINTÉTICOS offline; não representa limites oficiais do IBGE."""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from etl_pipeline.core_contract import validate_code, validate_payload
from importlib import import_module
atomic_json = import_module("etl_pipeline.03_fetch_ibge_raw").atomic_json

ANCHORS = {"1": (-65, -3), "2": (-43, -7), "3": (-47, -18), "4": (-53, -27), "5": (-58, -15)}


def rect_polygon(lon: float, lat: float, w: float, h: float) -> dict:
    return {"type": "Polygon", "coordinates": [[[lon, lat], [lon+w, lat], [lon+w, lat+h], [lon, lat+h], [lon, lat]]]}


def feature(code: str, properties: dict, polygon: dict) -> dict:
    return {"type": "Feature", "id": code, "properties": properties, "geometry": polygon}


def build_demo_geo(processed_dir: Path, geo_out_dir: Path) -> list[Path]:
    processed_dir = processed_dir.resolve()
    lineage = {}

    def read(relative: str, parent: Path) -> tuple[dict, Path]:
        path = (parent / relative).resolve()
        if not path.is_relative_to(processed_dir):
            raise ValueError("Caminho tabular fora do diretório de dados")
        raw = path.read_bytes()
        value = json.loads(raw)
        validate_payload(value)
        if value["metadata"].get("tipo_dados") != "simulados":
            raise ValueError("Geometrias de demonstração exigem dados explicitamente simulados")
        lineage[path.relative_to(processed_dir).as_posix()] = hashlib.sha256(raw).hexdigest()
        return value, path

    brasil, _ = read("brasil.json", processed_dir)
    collections = {}

    def collect(name, features):
        collections[name] = {"type": "FeatureCollection", "demo": True,
                             "aviso": "Polígonos sintéticos; não representam limites oficiais", "features": features}

    counters = dict.fromkeys(ANCHORS, 0)
    states = []
    for entry in brasil["ufs"]:
        meta = entry["metadata"]
        uf = validate_code(meta["cd_uf"], "cd_uf")
        region = validate_code(meta["cd_regiao"], "cd_regiao")
        i = counters[region]; counters[region] += 1
        x, y = ANCHORS[region]; x += i % 3 * 2.4; y -= i // 3 * 2.4
        states.append(feature(uf, {**meta, "dados_disponiveis": entry["dados_disponiveis"]}, rect_polygon(x, y, 2.1, 2.1)))
        if not entry["dados_disponiveis"] or not entry["arquivo"]:
            continue
        state, state_path = read(entry["arquivo"], processed_dir)
        if state["metadata"]["cd_uf"] != uf:
            raise ValueError("UF incompatível com o índice")
        municipalities = []
        cols = max(1, math.ceil(math.sqrt(len(state["municipios_resumo"]))))
        cell = 1.8 / cols
        for j, summary in enumerate(state["municipios_resumo"]):
            mun = validate_code(summary["cd_mun"], "cd_mun")
            if not mun.startswith(uf):
                raise ValueError("Município fora da UF")
            mx, my = x + .1 + j % cols * cell, y + .1 + j // cols * cell
            size = cell * .9
            municipalities.append(feature(mun, {"cd_mun": mun, "cd_uf": uf, "nm_mun": summary["nm_mun"]}, rect_polygon(mx, my, size, size)))
            detail, _ = read(summary["arquivo"], state_path.parent)
            if detail["municipio"]["cd_mun"] != mun:
                raise ValueError("Detalhe incompatível com o resumo municipal")
            groups = detail["municipio"]["bairros"]
            count = sum(len(b["cd_setores"]) for b in groups)
            scols = max(1, math.ceil(math.sqrt(count)))
            step = size * .9 / scols
            sectors, seen = [], set()
            for group in groups:
                for code in group["cd_setores"]:
                    validate_code(code, "cd_setor")
                    if code in seen or not code.startswith(mun):
                        raise ValueError("Setor duplicado ou fora do município")
                    k = len(seen); seen.add(code)
                    sectors.append(feature(code, {"CD_SETOR": code, "cd_mun": mun,
                        "cd_bairro": group["cd_bairro"], "id_agregacao": group["id_agregacao"],
                        "nm_bairro": group["nm_bairro"], "origem_malha": group["origem_malha"]},
                        rect_polygon(mx + size*.05 + k % scols*step, my + size*.05 + k // scols*step, step*.85, step*.85)))
            collect(f"setores/{uf}/{mun}.geojson", sectors)
        collect(f"municipios/{uf}.geojson", municipalities)
    collect("ufs.geojson", states)
    # Publicar somente após validar todas as entradas. Gravação atômica por arquivo.
    for name, collection in collections.items():
        atomic_json(geo_out_dir / name, collection)
    atomic_json(geo_out_dir / "manifest.json", {"tipo_dados": "geometrias_sinteticas",
        "aviso": "Uso exclusivo com fixtures; sem compatibilidade com malhas reais",
        "tabular_sha256_local": lineage, "arquivos": sorted(collections)})
    return [geo_out_dir / name for name in sorted(collections)]


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--processed-dir", type=Path, default=root / "data/processed")
    parser.add_argument("--output-dir", type=Path, default=root / "frontend/public/geo/demo")
    args = parser.parse_args()
    paths = build_demo_geo(args.processed_dir, args.output_dir)
    print(f"[OK] {len(paths)} malhas SINTÉTICAS geradas em {args.output_dir}")
