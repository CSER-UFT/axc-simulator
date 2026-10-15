#!/usr/bin/env python3
"""
Atraso e energia das células sky130_fd_sc_hd em várias tensões, para calibrar o modelo de tensão do simulador.

    python3 scripts/sky130/voltage.py <clone de google/skywater-pdk-libs-sky130_fd_sc_hd> [--out data/sky130-voltage.json]

Para cada célula e canto (processo, temperatura, tensão), lê as tabelas de atraso (cell_rise e cell_fall) e de
energia interna (internal_power) dos arquivos .lib.json da biblioteca e interpola num ponto fixo: transição de
entrada de 0,1 ns e carga de 4 entradas de NAND2 (cerca de 7,6 fF). O atraso da célula é a média de subida e
descida em todos os arcos; a energia por transição soma a interna e a da carga (C V² / 2).

Depois ajusta a lei de potência alfa (Sakurai e Newton, 1990), d(V) = k V / (V − Vt)^alfa, à série de cantos
lentos a −40 °C (1,28 a 1,76 V), que é a única com várias tensões no mesmo processo e temperatura.
"""
import argparse
import glob
import json
import math
import os
import re

CELLS = ['inv_1', 'nand2_1', 'nor2_1', 'xor2_1', 'a21oi_1', 'o21ai_1', 'fa_1', 'mux2_1']
SLEW = 0.1          # ns
VNOM = 1.8          # tensão nominal da biblioteca


def interp2(idx1, idx2, values, x, y):
    """Interpolação bilinear na tabela values[i][j] (i: transição de entrada, j: carga)."""
    def bracket(idx, v):
        for k in range(len(idx) - 1):
            if v <= idx[k + 1]:
                return k
        return len(idx) - 2
    i, j = bracket(idx1, x), bracket(idx2, y)
    tx = (x - idx1[i]) / (idx1[i + 1] - idx1[i])
    ty = (y - idx2[j]) / (idx2[j + 1] - idx2[j])
    v = values
    return ((1 - tx) * (1 - ty) * v[i][j] + tx * (1 - ty) * v[i + 1][j]
            + (1 - tx) * ty * v[i][j + 1] + tx * ty * v[i + 1][j + 1])


def cell_numbers(d, load, volt):
    delays, energies = [], []
    for key, pin in d.items():
        if not key.startswith('pin,') or pin.get('direction') != 'output':
            continue
        tim = pin.get('timing', [])
        for arc in (tim if isinstance(tim, list) else [tim]):
            for k, tab in arc.items():
                if k.startswith('cell_rise') or k.startswith('cell_fall'):
                    delays.append(interp2(tab['index_1'], tab['index_2'], tab['values'], SLEW, load))
        ip = pin.get('internal_power', [])
        for arc in (ip if isinstance(ip, list) else [ip]):
            for k, tab in arc.items():
                if (k.startswith('rise_power') or k.startswith('fall_power')) and 'index_2' in tab:
                    energies.append(interp2(tab['index_1'], tab['index_2'], tab['values'], SLEW, load))
    e_load = 0.5 * load * volt * volt          # pF x V² = pJ
    return sum(delays) / len(delays), (sum(energies) / len(energies) if energies else 0.0) + e_load


def fit_alpha(points):
    """Ajuste de Vt e alfa por busca em grade, no erro quadrático do logaritmo da razão de atrasos."""
    best = None
    for vt in [0.20 + 0.005 * i for i in range(201)]:            # 0,20 a 1,20 V
        for a in [1.0 + 0.01 * i for i in range(151)]:           # 1,0 a 2,5
            f = lambda v: v / (v - vt) ** a
            # A constante k sai por mínimos quadrados no log.
            logs = [math.log(d) - math.log(f(v)) for v, d in points]
            k = sum(logs) / len(logs)
            err = sum((l - k) ** 2 for l in logs)
            if best is None or err < best[0]:
                best = (err, vt, a, k)
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('lib')
    ap.add_argument('--out', default='data/sky130-voltage.json')
    args = ap.parse_args()
    nand = None
    corners = {}
    for cell in CELLS:
        base = cell.rsplit('_', 1)[0]
        for path in sorted(glob.glob(os.path.join(args.lib, 'cells', base, f'sky130_fd_sc_hd__{cell}__*.lib.json'))):
            m = re.search(r'__(ss|ff|tt)_(n?\d+)C_(\d)v(\d\d)(_ccsnoise)?\.lib\.json$', path)
            if not m:
                continue
            corner = f'{m.group(1)}_{m.group(2)}C_{m.group(3)}v{m.group(4)}'
            volt = int(m.group(3)) + int(m.group(4)) / 100
            d = json.load(open(path))
            if nand is None and cell == 'nand2_1':
                nand = d['pin,A']['capacitance']
            corners.setdefault(corner, {'process': m.group(1), 'temp': m.group(2).replace('n', '-'), 'V': volt, 'cells': {}})['cells'][cell] = d
    load = 4 * (nand or 0.0019)
    out = {'slew_ns': SLEW, 'load_pF': load, 'vnom': VNOM, 'cells': CELLS, 'corners': []}
    for name in sorted(corners, key=lambda c: (corners[c]['process'], corners[c]['temp'], corners[c]['V'])):
        c = corners[name]
        delay, energy = {}, {}
        for cell, d in c['cells'].items():
            delay[cell], energy[cell] = cell_numbers(d, load, c['V'])
        out['corners'].append({'name': name, 'process': c['process'], 'temp': int(c['temp']), 'V': c['V'],
                               'delay_ns': delay, 'energy_pJ': energy})
    # Média geométrica das células, relativa ao canto mais rápido da série lenta a -40 °C (1,76 V).
    ss = [c for c in out['corners'] if c['process'] == 'ss' and c['temp'] == -40]
    ref = max(ss, key=lambda c: c['V'])
    gm = lambda c, k: math.exp(sum(math.log(c[k][x] / ref[k][x]) for x in CELLS if x in c[k] and x in ref[k]) / len(CELLS))
    for c in out['corners']:
        c['delayRel'] = gm(c, 'delay_ns')
        c['energyRel'] = gm(c, 'energy_pJ')
    err, vt, a, k = fit_alpha([(c['V'], c['delayRel']) for c in ss])
    rel = lambda v: (v / (v - vt) ** a) / (VNOM / (VNOM - vt) ** a)
    out['fit'] = {'series': 'ss_-40C', 'Vt': vt, 'alpha': a, 'VtNorm': vt / VNOM, 'rmsLogError': math.sqrt(err / len(ss)),
                  'note': 'atraso relativo a 1,8 V pela lei ajustada; tensões normalizadas por 1,8 V'}
    for c in ss:
        c['delayFit'] = rel(c['V']) / rel(ref['V'])
    os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
    with open(args.out, 'w') as f:
        json.dump(out, f, indent=1)
    print(f'carga {load * 1000:.2f} fF, transição {SLEW} ns')
    for c in out['corners']:
        print(f"{c['name']:<14} V={c['V']:.2f}  atraso relativo {c['delayRel']:.3f}  energia relativa {c['energyRel']:.3f}" + (f"  ajuste {c['delayFit']:.3f}" if 'delayFit' in c else ''))
    print(f'ajuste na série ss -40 °C: Vt = {vt:.3f} V ({vt / VNOM:.3f} da nominal), alfa = {a:.2f}, erro rms do log {math.sqrt(err / len(ss)):.4f}')


if __name__ == '__main__':
    main()
