/**
 * Ajuda: manual com índice lateral, busca e ligações internas. O conteúdo fica em js/help/<idioma>.js.
 */
import pt from '../help/pt.js';
import en from '../help/en.js';
import { getLanguage } from '../i18n/index.js';

const CONTENT = { pt, en };

const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export class Help {

    /**
     * @param {HTMLElement} root elemento #readme (sobreposto à página)
     * @param {() => void} onClose chamado quando a ajuda sobreposta é fechada
     */
    constructor(root, onClose) {
        this.root = root;
        this.onClose = onClose;
        this.render();

        root.addEventListener('click', (e) => {
            const a = e.target.closest('a[href^="#h-"]');
            if (a) {
                e.preventDefault();
                this.show(a.getAttribute('href').slice(3));
            }
            if (e.target.closest('[data-help-close]')) this.close();
        });
        root.addEventListener('input', (e) => {
            if (e.target.matches('.help-search')) this.filter(e.target.value);
        });
        root.addEventListener('scroll', () => this.updateCurrent(), { passive: true });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOverlay()) this.close();
        });
    }

    /** Monta a ajuda no idioma atual. */
    render() {
        const c = CONTENT[getLanguage()] ?? pt;
        const toc = c.sections.map((s) => `<li><a href="#h-${s.id}" data-sec="${s.id}">${s.title}</a></li>`).join('');
        const body = c.sections.map((s) => `<section class="help-section" id="h-${s.id}"><h2>${s.title}</h2>${s.html}</section>`).join('');
        this.root.innerHTML = `
            <div class="help">
                <aside class="help-toc">
                    <button type="button" class="btn help-close" data-help-close>${c.close}</button>
                    <input type="search" class="help-search" placeholder="${c.searchPlaceholder}" aria-label="${c.searchPlaceholder}" />
                    <p class="help-toc-title">${c.tocTitle}</p>
                    <ol>${toc}</ol>
                </aside>
                <article class="help-body">
                    <header class="help-head">
                        <div>
                            <h1>${c.title}</h1>
                            <p class="help-lead">${c.lead}</p>
                        </div>
                    </header>
                    ${body}
                    <p class="help-empty hidden">${c.noResults}</p>
                </article>
            </div>`;
        this.updateCurrent();
    }

    isOverlay() {
        return this.root.classList.contains('overlay');
    }

    /** Abre a ajuda sobre a simulação, opcionalmente em uma seção. */
    open(section = null) {
        this.root.classList.add('overlay');
        document.body.classList.add('help-open');
        this.show(section);
    }

    close() {
        if (!this.isOverlay()) return;
        this.root.classList.remove('overlay');
        document.body.classList.remove('help-open');
        this.onClose?.();
    }

    /** Rola até a seção indicada (ou o início). */
    show(section) {
        const search = this.root.querySelector('.help-search');
        if (search.value) {
            search.value = '';
            this.filter('');
        }
        const el = section ? this.root.querySelector(`#h-${section}`) : null;
        this.root.scrollTop = el ? el.offsetTop - 12 : 0;
        this.updateCurrent();
    }

    /** Mostra só as seções que contêm o termo buscado. */
    filter(term) {
        const q = normalize(term.trim());
        let any = false;
        for (const sec of this.root.querySelectorAll('.help-section')) {
            const hit = !q || normalize(sec.textContent).includes(q);
            sec.classList.toggle('hidden', !hit);
            this.root.querySelector(`[data-sec="${sec.id.slice(2)}"]`).parentElement.classList.toggle('hidden', !hit);
            any ||= hit;
        }
        this.root.querySelector('.help-empty').classList.toggle('hidden', any);
    }

    /** Marca no índice a seção visível. */
    updateCurrent() {
        const top = this.root.scrollTop + 40;
        let current = null;
        for (const sec of this.root.querySelectorAll('.help-section:not(.hidden)'))
            if (sec.offsetTop <= top) current = sec.id.slice(2);
        for (const a of this.root.querySelectorAll('.help-toc a'))
            a.classList.toggle('current', a.dataset.sec === current);
    }
}
