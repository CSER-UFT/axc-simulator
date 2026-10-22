/**
 * Referências das técnicas e dos modelos do simulador, com DOI. Os DOIs foram conferidos no Crossref (ou na
 * página do editor). Usadas na ajuda (seção Referências), no Resumo (referência da técnica atual) e no README.
 */

/** @type {Record<string, {authors: string[], year?: number, title: string, venue: string, doi?: string, url?: string}>} */
export const REFS = {
    booth1951: { authors: ['A. D. Booth'], year: 1951, title: 'A signed binary multiplication technique', venue: 'The Quarterly Journal of Mechanics and Applied Mathematics, vol. 4, n. 2', doi: '10.1093/qjmam/4.2.236' },
    macsorley1961: { authors: ['O. L. MacSorley'], year: 1961, title: 'High-speed arithmetic in binary computers', venue: 'Proceedings of the IRE, vol. 49, n. 1', doi: '10.1109/JRPROC.1961.287779' },
    mitchell1962: { authors: ['J. N. Mitchell'], year: 1962, title: 'Computer multiplication and division using binary logarithms', venue: 'IRE Transactions on Electronic Computers, vol. EC-11, n. 4', doi: '10.1109/TEC.1962.5219391' },
    wallace1964: { authors: ['C. S. Wallace'], year: 1964, title: 'A suggestion for a fast multiplier', venue: 'IEEE Transactions on Electronic Computers, vol. EC-13, n. 1', doi: '10.1109/PGEC.1964.263830' },
    dadda1965: { authors: ['L. Dadda'], year: 1965, title: 'Some schemes for parallel multipliers', venue: 'Alta Frequenza, vol. 34' },
    gaines1969: { authors: ['B. R. Gaines'], year: 1969, title: 'Stochastic computing systems', venue: 'Advances in Information Systems Science, vol. 2, Springer', doi: '10.1007/978-1-4899-5841-9_2' },
    sobol1967: { authors: ['I. M. Sobol\''], year: 1967, title: 'On the distribution of points in a cube and the approximate evaluation of integrals', venue: 'USSR Computational Mathematics and Mathematical Physics, vol. 7, n. 4', doi: '10.1016/0041-5553(67)90144-9' },
    sakurai1990: { authors: ['T. Sakurai', 'A. R. Newton'], year: 1990, title: 'Alpha-power law MOSFET model and its applications to CMOS inverter delay and other formulas', venue: 'IEEE Journal of Solid-State Circuits, vol. 25, n. 2', doi: '10.1109/4.52187' },
    chandrakasan1992: { authors: ['A. P. Chandrakasan', 'S. Sheng', 'R. W. Brodersen'], year: 1992, title: 'Low-power CMOS digital design', venue: 'IEEE Journal of Solid-State Circuits, vol. 27, n. 4', doi: '10.1109/4.126534' },
    schulte1993: { authors: ['M. J. Schulte', 'E. E. Swartzlander'], year: 1993, title: 'Truncated multiplication with correction constant', venue: 'Proceedings of the IEEE Workshop on VLSI Signal Processing VI', doi: '10.1109/VLSISP.1993.404467' },
    wang2004: { authors: ['Z. Wang', 'A. C. Bovik', 'H. R. Sheikh', 'E. P. Simoncelli'], year: 2004, title: 'Image quality assessment: from error visibility to structural similarity', venue: 'IEEE Transactions on Image Processing, vol. 13, n. 4', doi: '10.1109/TIP.2003.819861' },
    joe2008: { authors: ['S. Joe', 'F. Y. Kuo'], year: 2008, title: 'Constructing Sobol sequences with better two-dimensional projections', venue: 'SIAM Journal on Scientific Computing, vol. 30, n. 5', doi: '10.1137/070709359' },
    mahdiani2010: { authors: ['H. R. Mahdiani', 'A. Ahmadi', 'S. M. Fakhraie', 'C. Lucas'], year: 2010, title: 'Bio-inspired imprecise computational blocks for efficient VLSI implementation of soft-computing applications', venue: 'IEEE Transactions on Circuits and Systems I: Regular Papers, vol. 57, n. 4', doi: '10.1109/TCSI.2009.2027626' },
    brayton2010: { authors: ['R. Brayton', 'A. Mishchenko'], year: 2010, title: 'ABC: an academic industrial-strength verification tool', venue: 'Computer Aided Verification (CAV), Springer', doi: '10.1007/978-3-642-14295-6_5' },
    kulkarni2011: { authors: ['P. Kulkarni', 'P. Gupta', 'M. Ercegovac'], year: 2011, title: 'Trading accuracy for power with an underdesigned multiplier architecture', venue: '24th International Conference on VLSI Design', doi: '10.1109/VLSID.2011.51' },
    liu2011: { authors: ['S. Liu', 'K. Pattabiraman', 'T. Moscibroda', 'B. G. Zorn'], year: 2011, title: 'Flikker: saving DRAM refresh-power through critical data partitioning', venue: 'ASPLOS', doi: '10.1145/1950365.1950391' },
    satopaa2011: { authors: ['V. Satopää', 'J. Albrecht', 'D. Irwin', 'B. Raghavan'], year: 2011, title: 'Finding a "Kneedle" in a haystack: detecting knee points in system behavior', venue: 'ICDCS Workshops', doi: '10.1109/ICDCSW.2011.20' },
    kahng2012: { authors: ['A. B. Kahng', 'S. Kang'], year: 2012, title: 'Accuracy-configurable adder for approximate arithmetic designs', venue: 'Design Automation Conference (DAC)', doi: '10.1145/2228360.2228509' },
    liang2013: { authors: ['J. Liang', 'J. Han', 'F. Lombardi'], year: 2013, title: 'New metrics for the reliability of approximate and probabilistic adders', venue: 'IEEE Transactions on Computers, vol. 62, n. 9', doi: '10.1109/TC.2012.146' },
    alaghi2013: { authors: ['A. Alaghi', 'J. P. Hayes'], year: 2013, title: 'Survey of stochastic computing', venue: 'ACM Transactions on Embedded Computing Systems, vol. 12, n. 2s', doi: '10.1145/2465787.2465794' },
    alaghi2013corr: { authors: ['A. Alaghi', 'J. P. Hayes'], year: 2013, title: 'Exploiting correlation in stochastic circuit design', venue: 'IEEE International Conference on Computer Design (ICCD)', doi: '10.1109/ICCD.2013.6657023' },
    alaghi2014: { authors: ['A. Alaghi', 'J. P. Hayes'], year: 2014, title: 'Fast and accurate computation using stochastic circuits', venue: 'Design, Automation and Test in Europe (DATE)', doi: '10.7873/DATE.2014.089' },
    momeni2015: { authors: ['A. Momeni', 'J. Han', 'P. Montuschi', 'F. Lombardi'], year: 2015, title: 'Design and analysis of approximate compressors for multiplication', venue: 'IEEE Transactions on Computers, vol. 64, n. 4', doi: '10.1109/TC.2014.2308214' },
    hashemi2015: { authors: ['S. Hashemi', 'R. I. Bahar', 'S. Reda'], year: 2015, title: 'DRUM: a dynamic range unbiased multiplier for approximate applications', venue: 'IEEE/ACM International Conference on Computer-Aided Design (ICCAD)', doi: '10.1109/ICCAD.2015.7372600' },
    shafique2015: { authors: ['M. Shafique', 'W. Ahmad', 'R. Hafiz', 'J. Henkel'], year: 2015, title: 'A low latency generic accuracy configurable adder', venue: 'Design Automation Conference (DAC)', doi: '10.1145/2744769.2744778' },
    venkatachalam2017: { authors: ['S. Venkatachalam', 'S.-B. Ko'], year: 2017, title: 'Design of power and area efficient approximate multipliers', venue: 'IEEE Transactions on Very Large Scale Integration (VLSI) Systems, vol. 25, n. 5', doi: '10.1109/TVLSI.2016.2643639' },
    jiang2020: { authors: ['H. Jiang', 'F. J. H. Santiago', 'H. Mo', 'L. Liu', 'J. Han'], year: 2020, title: 'Approximate arithmetic circuits: a survey, characterization, and recent applications', venue: 'Proceedings of the IEEE, vol. 108, n. 12', doi: '10.1109/JPROC.2020.3006451' },
    lecun1998: { authors: ['Y. LeCun', 'L. Bottou', 'Y. Bengio', 'P. Haffner'], year: 1998, title: 'Gradient-based learning applied to document recognition', venue: 'Proceedings of the IEEE, vol. 86, n. 11', doi: '10.1109/5.726791' },
    venkataramani2014: { authors: ['S. Venkataramani', 'A. Ranjan', 'K. Roy', 'A. Raghunathan'], year: 2014, title: 'AxNN: energy-efficient neuromorphic systems using approximate computing', venue: 'International Symposium on Low Power Electronics and Design (ISLPED)', doi: '10.1145/2627369.2627613' },
    mrazek2017: { authors: ['V. Mrázek', 'R. Hrbáček', 'Z. Vašíček', 'L. Sekanina'], year: 2017, title: 'EvoApprox8b: library of approximate adders and multipliers for circuit design and benchmarking of approximation methods', venue: 'Design, Automation and Test in Europe (DATE)', doi: '10.23919/DATE.2017.7926993' },
    mrazek2016: { authors: ['V. Mrázek', 'S. S. Sarwar', 'L. Sekanina', 'Z. Vašíček', 'K. Roy'], year: 2016, title: 'Design of power-efficient approximate multipliers for approximate artificial neural networks', venue: 'IEEE/ACM International Conference on Computer-Aided Design (ICCAD)', doi: '10.1145/2966986.2967021' },
    jacob2018: { authors: ['B. Jacob', 'S. Kligys', 'B. Chen', 'M. Zhu', 'M. Tang', 'A. Howard', 'H. Adam', 'D. Kalenichenko'], year: 2018, title: 'Quantization and training of neural networks for efficient integer-arithmetic-only inference', venue: 'IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)', doi: '10.1109/CVPR.2018.00286' },
    lenail2019: { authors: ['A. LeNail'], year: 2019, title: 'NN-SVG: publication-ready neural network architecture schematics', venue: 'Journal of Open Source Software, vol. 4, n. 33, 747', doi: '10.21105/joss.00747' },
    mnist: { authors: ['Y. LeCun', 'C. Cortes', 'C. J. C. Burges'], title: 'The MNIST database of handwritten digits (licença CC BY-SA 3.0)', venue: 'software', url: 'http://yann.lecun.com/exdb/mnist/' },
    yosys: { authors: ['C. Wolf'], title: 'Yosys Open SYnthesis Suite', venue: 'software', url: 'https://yosyshq.net/yosys/' },
    iverilog: { authors: ['S. Williams'], title: 'Icarus Verilog', venue: 'software', url: 'https://steveicarus.github.io/iverilog/' },
    sky130: { authors: ['SkyWater Technology', 'Google'], title: 'SkyWater SKY130 open source PDK', venue: 'software', url: 'https://github.com/google/skywater-pdk' },
    opensta: { authors: ['Parallax Software', 'The OpenROAD Project'], title: 'OpenSTA: static timing analyzer', venue: 'software', url: 'https://github.com/The-OpenROAD-Project/OpenSTA' },
};

/** Referências de cada técnica (chave tipo.técnica). */
export const TECH_REFS = {
    'mul.array': ['dadda1965', 'wallace1964'],
    'mul.trunc': ['schulte1993'],
    'mul.approx': ['venkatachalam2017', 'momeni2015', 'mahdiani2010'],
    'mul.booth': ['booth1951', 'macsorley1961'],
    'mul.kulkarni': ['kulkarni2011'],
    'mul.drum': ['hashemi2015'],
    'mul.mitchell': ['mitchell1962'],
    'mul.comp': ['schulte1993'],
    'add.loa': ['mahdiani2010'],
    'add.seg': ['kahng2012', 'shafique2015'],
    'add.trunc': ['jiang2020'],
};

/** Grupos da lista completa, na ordem em que aparecem. */
export const REF_GROUPS = [
    { key: 'arith', keys: ['booth1951', 'macsorley1961', 'mitchell1962', 'wallace1964', 'dadda1965', 'schulte1993', 'mahdiani2010', 'kulkarni2011', 'kahng2012', 'momeni2015', 'hashemi2015', 'shafique2015', 'venkatachalam2017', 'jiang2020'] },
    { key: 'eval', keys: ['liang2013', 'wang2004', 'satopaa2011', 'chandrakasan1992', 'mrazek2017'] },
    { key: 'vos', keys: ['sakurai1990', 'liu2011'] },
    { key: 'nn', keys: ['lecun1998', 'mnist', 'jacob2018', 'venkataramani2014', 'mrazek2016', 'lenail2019'] },
    { key: 'sc', keys: ['gaines1969', 'alaghi2013', 'alaghi2013corr', 'alaghi2014', 'sobol1967', 'joe2008'] },
    { key: 'tools', keys: ['iverilog', 'yosys', 'brayton2010', 'sky130', 'opensta'] },
];

const lastNames = (r) => r.authors.map((a) => a.replace(/^([A-Z][a-z]?\.(-[A-Z]\.)? ?)+/, ''));

/** Citação curta: "Mitchell, 1962", "Sakurai e Newton, 1990", "Momeni e colegas, 2015". */
export function cite(key, lang = 'pt') {
    const r = REFS[key];
    if (!r) return key;
    const n = lastNames(r);
    const and = lang === 'en' ? 'and' : 'e';
    const who = r.venue === 'software' ? n[0] : n.length === 1 ? n[0] : n.length === 2 ? `${n[0]} ${and} ${n[1]}` : `${n[0]} ${lang === 'en' ? 'et al.' : 'e colegas'}`;
    return r.year ? `${who}, ${r.year}` : who;
}

/** Veículo no idioma: "n." vira "no." em inglês. */
const venueOf = (r, lang) => (lang === 'en' ? r.venue.replace(', n. ', ', no. ') : r.venue);

const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Referência completa em HTML, com o DOI como ligação. */
export function refHtml(key, lang = 'pt') {
    const r = REFS[key];
    const and = lang === 'en' ? 'and' : 'e';
    const a = r.authors.length > 1 ? `${r.authors.slice(0, -1).join(', ')} ${and} ${r.authors.at(-1)}` : r.authors[0];
    const link = r.doi ? ` DOI: <a href="https://doi.org/${escHtml(r.doi)}" target="_blank" rel="noopener">${escHtml(r.doi)}</a>.` : r.url ? ` <a href="${escHtml(r.url)}" target="_blank" rel="noopener">${escHtml(r.url)}</a>.` : '';
    const venue = r.venue === 'software' ? '' : ` <i>${escHtml(venueOf(r, lang))}</i>,`;
    return `${escHtml(a)}. “${escHtml(r.title)}”.${venue}${r.year ? ` ${r.year}.` : ''}${link}`;
}

/** Referência completa em Markdown (README). */
export function refMarkdown(key, lang = 'pt') {
    const r = REFS[key];
    const and = lang === 'en' ? 'and' : 'e';
    const a = r.authors.length > 1 ? `${r.authors.slice(0, -1).join(', ')} ${and} ${r.authors.at(-1)}` : r.authors[0];
    const link = r.doi ? ` DOI: [${r.doi}](https://doi.org/${r.doi}).` : r.url ? ` <${r.url}>.` : '';
    const venue = r.venue === 'software' ? '' : ` *${venueOf(r, lang)}*,`;
    return `${a}. "${r.title}".${venue}${r.year ? ` ${r.year}.` : ''}${link}`;
}
