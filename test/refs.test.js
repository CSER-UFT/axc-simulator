import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REFS, TECH_REFS, REF_GROUPS, cite, refHtml } from '../js/refs.js';
import pt from '../js/i18n/pt.js';
import en from '../js/i18n/en.js';
import helpPt from '../js/help/pt.js';
import helpEn from '../js/help/en.js';

test('referências: todas as citadas existem, aparecem na lista e no README com o DOI', () => {
    const listed = new Set(REF_GROUPS.flatMap((g) => g.keys));
    for (const keys of Object.values(TECH_REFS)) for (const k of keys) assert.ok(REFS[k], k);
    for (const k of Object.keys(REFS)) assert.ok(listed.has(k), `${k} fora da lista`);
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    for (const r of Object.values(REFS)) {
        if (r.doi) assert.ok(readme.includes(`https://doi.org/${r.doi}`), r.doi);
        assert.match(r.doi ?? 'sem', /^(10\.\d{4,5}\/\S+|sem)$/);
    }
    // As citações no texto da ajuda apontam para chaves conhecidas.
    for (const h of [helpPt, helpEn]) {
        const refs = h.sections.find((s) => s.id === 'refs').html;
        for (const k of listed) assert.ok(refs.includes(refHtml(k, h === helpEn ? 'en' : 'pt')), k);
    }
    assert.equal(cite('mahdiani2010'), 'Mahdiani e colegas, 2010');
    assert.equal(cite('sakurai1990', 'en'), 'Sakurai and Newton, 1990');
});

test('traduções: as mesmas chaves nos dois idiomas e a mesma ajuda', () => {
    for (const k of Object.keys(pt)) assert.ok(k in en, `falta em inglês: ${k}`);
    assert.deepEqual(helpPt.sections.map((s) => s.id), helpEn.sections.map((s) => s.id));
});
