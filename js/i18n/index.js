/**
 * Internacionalização: português e inglês. Sem preferência guardada, o idioma segue o do navegador
 * (português para pt, inglês para os outros).
 *
 * t(chave) procura a chave no dicionário do idioma, depois no português e, por fim, devolve a própria chave. Os
 * textos que vêm dos módulos de cálculo (nomes das etapas do circuito, por exemplo) usam o texto em português
 * como chave: o dicionário inglês traduz, e o português nem precisa listá-los.
 */
import pt from './pt.js';
import en from './en.js';

const DICTS = { pt, en };
export const LANGUAGES = { pt: 'Português', en: 'English' };

let current = 'pt';
try {
    const stored = globalThis.localStorage?.getItem('axc.lang');
    if (stored && stored in DICTS) current = stored;
    else if (globalThis.navigator?.language && !/^pt/i.test(globalThis.navigator.language)) current = 'en';
} catch {
    // sem armazenamento: mantém o padrão
}

export function getLanguage() {
    return current;
}

export function setLanguage(lang, { persist = true } = {}) {
    if (!(lang in DICTS)) return;
    current = lang;
    if (!persist) return;
    try {
        globalThis.localStorage?.setItem('axc.lang', lang);
    } catch {
        // ignora
    }
}

/**
 * Traduz uma chave, substituindo {parametro} pelos valores fornecidos.
 * @param {string} key
 * @param {object} params
 */
export function t(key, params = {}) {
    const s = DICTS[current][key] ?? DICTS.pt[key] ?? key;
    if (typeof s === 'function') return s(params);
    return s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

/** Formatação de números no idioma atual. */
export const locale = () => (current === 'en' ? 'en-US' : 'pt-BR');
/** Troca o ponto decimal pela vírgula em português (para toFixed e toExponential). */
export const dec = (s) => (current === 'en' ? s : s.replace('.', ','));
