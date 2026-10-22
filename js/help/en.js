/**
 * Simulator help, in English. The text avoids hyphens and dashes, following the project's style.
 * Citations point to the References section, built from js/refs.js (with the DOIs).
 */
import { cite, refHtml, REF_GROUPS } from '../refs.js';
import { heads, sections as pageSections, common } from './pages-en.js';

const c = (...keys) => keys.map((k) => `<a class="cite" href="#h-refs">${cite(k, 'en')}</a>`).join('; ');
const GROUP_TITLES = { nn: 'Neural network', arith: 'Approximate arithmetic circuits', eval: 'Evaluation: metrics, image quality, selection and energy', vos: 'Voltage and memory', sc: 'Stochastic computing', tools: 'Tools and PDK' };

const base = {
    title: 'Approximate Computing Simulator',
    lead: 'Educational simulator of approximate computing: approximate adders and multipliers built gate by gate, evaluated against the exact version with the error metrics of the literature, compared by cost on the Pareto front and applied to an image filter. Everything runs in the browser.',
    searchPlaceholder: 'Search the help',
    noResults: 'No section contains this term.',
    tocTitle: 'Contents',
    close: 'Close help',
    sections: [
        {
            id: 'start',
            title: 'Getting started',
            html: `
<ol>
    <li>Choose the type of unit (multiplier or adder), the width and the approximation technique on the left panel. Everything is recomputed on each change.</li>
    <li>The <strong>Summary</strong> shows the estimated area and delay, compared with the exact unit, and the error metrics.</li>
    <li><strong>Structure</strong> shows where the approximation happens; <strong>Error</strong> shows for which operands it fails and by how much; <strong>Comparison</strong> puts several configurations on a cost against error chart; <strong>Voltage and memory</strong> and <strong>Stochastic</strong> deal with other sources of approximation. The <strong>Use in LeNet-5</strong> button takes the unit to the neural network page. The FPGA and ASIC numbers of the synthesized units are in the <strong>Library</strong> tab of the high level synthesis page.</li>
    <li><strong>Copy link</strong> stores the unit configuration, the tab and the controls of the tabs in the page address: whoever opens the link sees the same screen. The language is in the selector of the header.</li>
</ol>
<p class="tip">To start: 8 bit multiplier, 4 truncated columns and no approximate ones. MED is 12.25 and WCE is 49. Then switch to 6 approximate columns and compare the two error maps.</p>`,
        },
        {
            id: 'mul',
            title: 'Column based multiplier',
            html: `
<p>The <strong>column based</strong> technique is the starting point: the unsigned N × N multiplier generates the partial products a<sub>i</sub>·b<sub>j</sub> (one AND gate each), which fall in column i + j. The columns are reduced by stages in Dadda style (${c('dadda1965')}), a refinement of the Wallace scheme (${c('wallace1964')}): the target heights are 2, 3, 4, 6, 9, 13..., and at each stage each column receives only the full adders and half adders needed not to exceed the target. At most two bits per column are left, and a carry propagate addition gives the product. For 8 bits, the reduction uses 35 full adders and 7 half adders, as in the textbook. The least significant columns can be in three zones:</p>
<dl>
    <dt>truncated</dt><dd>the partial products are not even generated: this saves the AND gates and the adders of those columns. The error is always downward (the result never exceeds the exact one). This is the classic truncated multiplier (${c('schulte1993')}).</dd>
    <dt>approximate</dt><dd>the reduction uses the approximate 4:2 compressor (four bits become sum and carry, without the carry link between neighboring compressors) and the final addition is an OR, without carry, as in the LOA (${c('mahdiani2010')}). Optionally, the carry into the first exact column is the AND of the two bits of the last approximate column.</dd>
    <dt>exact</dt><dd>full adders and carry propagation.</dd>
</dl>
<p>The approximate compressor computes sum = (x1 ⊕ x2) + (x3 ⊕ x4) and carry = x1·x2 + x3·x4. The Structure tab shows its truth table: it is wrong in 5 of the 16 combinations, for example when all four bits are 1 (it gives 2 instead of 4). The carry is the same as in the compressor of Venkatachalam and Ko (${c('venkatachalam2017')}), and the sum is theirs without the term x1·x2·x3·x4, which partly fixes the case of four ones (it gives 3): it is a simplified version, with one more error. The family of approximate compressors is analyzed by Momeni et al. (${c('momeni2015')}).</p>
<p>The height table shows how many bits each column has at each stage (8, 6, 4, 3, 2 for 8 bits): the reduction ends when no column exceeds two. In the approximate columns, the approximate 4:2 compressor replaces the full adders whenever three bits can be removed at once.</p>`,
        },
        {
            id: 'mul2',
            title: 'Other multiplication techniques',
            html: `
<dl>
    <dt>Radix 4 Booth (signed)</dt><dd>Booth encoding (${c('booth1951')}) in its radix 4 version (${c('macsorley1961')}). Each pair of bits of b, with the previous bit, selects 0, ±a or ±2a: there are N/2 partial products instead of N. Operands and product are in two's complement, and the error map goes from −2<sup>N−1</sup> to 2<sup>N−1</sup> − 1 on both axes. Negative products are the complement of each bit plus 1 in the lowest column of the row (the "neg" row of the diagram), and the sign of each row is extended up to column 2N − 1 (the light dots). The approximation is truncating the low columns, as in the column based multiplier. The cost in the Summary is compared with the exact Booth.</dd>
    <dt>Kulkarni 2 × 2 blocks</dt><dd>The multiplier is built from blocks that multiply 2 bits by 2 bits (${c('kulkarni2011')}). The approximate block has three outputs instead of four and is wrong only for 3 × 3, which gives 7 instead of 9. Blocks with weight below the chosen one are approximate, and the block products are added exactly. With all blocks approximate, the MRED is close to 3.3% and the error is always downward.</dd>
    <dt>DRUM</dt><dd>Dynamic Range Unbiased Multiplier (${c('hashemi2015')}): from each operand, only the k bits starting at the leading 1 enter an exact k × k multiplier, and the product is shifted back. The lowest bit of the slice is set to 1, which centers the truncation error: the bias is close to zero and the relative error barely depends on the magnitude of the operands. The extra cost is the leading one detector and the shifters.</dd>
    <dt>Mitchell</dt><dd>Logarithmic multiplier (${c('mitchell1962')}): log₂(x) ≈ p + f, with p the position of the leading 1 and f the bits below it read as a fraction. The product becomes the sum of the logarithms, and the antilogarithm is approximated the same way, with a shift. There is no multiplication in the circuit. The error is always downward, with MRED close to 3.8% and at most 11.1%.</dd>
</dl>
<p>Structure shows the dot diagram of the techniques based on partial products (column based, Booth and Kulkarni) and, for all of them, the cost of each stage of the circuit in gates.</p>
<h3>Bias compensation</h3>
<p>When almost all the error is on one side, adding a constant to the result removes the bias and reduces the MED. The constant is the mean error measured with uniform inputs on the circuit without compensation, and it is fixed in the design, like the correction constant of truncated multipliers (${c('schulte1993')}). In truncated multipliers it falls in the truncated columns, which are 0: the compensation comes for free, without any gate. Without sign, the sum saturates at the largest value instead of wrapping around.</p>
<p>Compensation does not improve everything. In Mitchell, adding the constant (606 at 8 bits) improves the MED, but small products get a huge relative error (1 × 1 becomes 607): the MRED goes from 3.8% to more than 30%. The metric that matters depends on the application.</p>`,
        },
        {
            id: 'add',
            title: 'Adder',
            html: `
<dl>
    <dt>exact</dt><dd>carry propagation (ripple carry): the delay grows with the width.</dd>
    <dt>truncated</dt><dd>the k low bits of the sum stay at 0 and send no carry.</dd>
    <dt>LOA</dt><dd>lower part OR adder (${c('mahdiani2010')}): the k low bits are a OR b (wrong when both bits are 1), and the carry into the exact part is the AND of bit k − 1.</dd>
    <dt>segmented</dt><dd>the sum is split into blocks of L bits that add in parallel; the carry into each block is predicted from the P previous bits only, as in the ACA (${c('kahng2012')}) and GeAr (${c('shafique2015')}) adders, where L and P correspond to the R and P parameters of GeAr. With P = 0 the blocks are independent; with a large P, the prediction is almost never wrong, but the delay grows again. When it fails, the error is a whole power of 2: the WCE is high and the EP is low.</dd>
</dl>`,
        },
        {
            id: 'metrics',
            title: 'Error metrics',
            html: `
<p>The metrics follow the literature on approximate circuits (${c('liang2013', 'jiang2020')}). For each pair of operands, the error distance is ED = |approximate − exact|.</p>
<table>
    <tr><th>Metric</th><th>Definition</th></tr>
    <tr><td>ME</td><td>mean signed error: the bias. A large bias can be compensated by adding a constant.</td></tr>
    <tr><td>MED</td><td>mean of ED</td></tr>
    <tr><td>WCE</td><td>largest ED (the pair that produces it appears in the Summary)</td></tr>
    <tr><td>MSE</td><td>mean of ED²</td></tr>
    <tr><td>NMED</td><td>MED divided by the largest possible exact output</td></tr>
    <tr><td>MRED</td><td>mean of ED / exact, over the pairs with exact different from 0</td></tr>
    <tr><td>EP</td><td>fraction of pairs with error</td></tr>
</table>
<p>In Booth, which is signed, the MRED divides by the absolute value of the exact product, and the NMED divides by 2<sup>2N−2</sup>, the largest product in absolute value.</p>
<p>With 8 bits and uniform inputs, the evaluation is exhaustive (65536 pairs). Otherwise, 200 thousand pairs drawn with a fixed seed, and the Summary shows, next to each mean, the half width of the <strong>95% confidence interval</strong> (normal approximation: 1.96 times the sample standard deviation divided by the square root of the number of pairs). The WCE of a sample is only a lower bound of the worst case. Normal and exponential inputs show that the same metrics change with the data: a multiplier that fails on large operands looks great if the data are almost always small.</p>
<h3>Real application operands</h3>
<p>The <strong>real LeNet-5</strong> and <strong>real Gaussian filter</strong> inputs replace the made up distribution with the one the unit actually sees in an application. The pairs come from <code>data/operands.bin</code>, generated by <code>scripts/operands.mjs</code>: in LeNet-5, the (activation, |weight|) pairs of all 416 million multiplications of the 1000 test images, drawn with the frequency of each pair, and the (accumulator, product) pairs of the accumulation additions; in the filter, the (pixel, weight) and (accumulator, product) pairs on the test image. An N bit adder gets the N low bits of each operand, as in the approximate accumulation of the Neural network tab.</p>
<p>The difference is large. In LeNet-5, more than half of the multiplications have a zero activation (ReLU and the border), and only 9% of the weights exceed 64 in magnitude: a technique with little error on small operands looks better than the uniform metrics say, and one with a lot of error on them, worse. In the Synthesis tab, the design space shows the error and the energy with these pairs, and the Pareto front changes.</p>
<p>The error map shows |error| for each pair (a, b): patterns in bands, corners or diagonals reveal where the technique fails. The histogram shows whether the error is symmetric or one sided.</p>`,
        },
        {
            id: 'cost',
            title: 'Area and delay',
            html: `
<p>The cost comes from an <strong>educational model</strong>: the area is the number of two input gates (AND, OR, XOR) of the generated circuit, and the delay is the logic depth, one unit per gate. A full adder counts 5 gates and a half adder, 2.</p>
<p>The <strong>activity</strong> is the mean, per operation, of the number of gate outputs that change value from one input pair to the next, over a sequence of 4096 random pairs. Dynamic energy is proportional to it (times the capacitance and the square of the voltage; ${c('chandrakasan1992')}), so it serves as a relative energy indicator among techniques. It is not measured power: the model has no real capacitances or delays, and so it ignores the glitches that make ripple adders more expensive.</p>
<p>This model is good for comparing techniques with each other and understanding where the savings come from, but it does not replace synthesis. In FPGA, the real cost depends on how the tool packs the logic into 6 input LUTs and uses the dedicated carry chain; in ASIC, on the cells of the library. The configurations of the design space (about 560) also have the numbers of a real synthesis for FPGA and for ASIC with the open SkyWater 130 nm PDK, including the energy per operation measured with OpenSTA (see <a href="#h-synth">FPGA and ASIC synthesis</a>).</p>`,
        },
        {
            id: 'vos',
            title: 'Voltage and memory',
            html: `
<h3>Voltage overscaling</h3>
<p>Lowering the voltage reduces dynamic energy with V², but makes gates slower. The delay of each gate follows the alpha power law (${c('sakurai1990')}), d ~ V / (V − V<sub>t</sub>)<sup>α</sup>, with V<sub>t</sub> = 0.3 and α = 1.3 in voltages normalized to nominal: at 0.8 the gate is 1.24 times slower; at 0.6, 1.81 times. The clock stays fixed. An output bit that arrives after the edge is captured with the value of the previous operation.</p>
<p>The time at which each bit arrives depends on the data: in a sequence of 4096 operations, a wire that does not change is ready at time 0, and a wire that changes is ready one gate after the last input that changed. Only the paths the data actually sensitize count, which is why the exact 16 bit adder, with a static path of 31 gates, did not go beyond 17 in the test sequence. The model ignores glitches and the controlling value of gates.</p>
<p>The clock can be that of the exact unit (the same system, swapping only the unit) or that of the unit itself. With the exact clock, the synergy between the two techniques shows up: the multiplier with 8 truncated columns has shorter paths and only starts to fail by timing near 0.64, against 0.78 for the exact one. Mitchell and DRUM, with paths longer than the exact one, fail by timing already near 0.9. The image uses the brightness gain (multiplier) or the average with the neighbor (adder), pixel by pixel, in the same sequence.</p>
<h3>Calibration with the sky130 cells</h3>
<p>The generic model (V<sub>t</sub> = 0.3 and α = 1.3) is only a starting point. The sky130_fd_sc_hd library of the open SkyWater PDK (${c('sky130')}) provides the delay and energy tables of each cell at several process, temperature and voltage corners. The script <code>scripts/sky130/voltage.py</code> reads the tables of eight common cells (inverter, NAND2, NOR2, XOR2, AOI21, OAI21, full adder and MUX2) at a fixed transition and load and fits the alpha power law to the series of the slow corner at −40 °C, from 1.28 to 1.76 V. The fit gives V<sub>t</sub> = 1.03 V (0.572 of the 1.8 V nominal) and α = 1.44, with an error of 0.2%.</p>
<p>The real delay grows much faster than in the generic model: at 1.28 V it is 3.4 times that at 1.76 V, against 1.4 times for the generic one. With the fitted model, the exact 8 bit multiplier starts to fail by timing already near 0.91 of nominal (0.78 with the generic one), and the exact 16 bit adder near 0.81 (0.59). Energy, on the other hand, confirms V²: at 1.28 V it is 52% of that at 1.76 V, against 53% predicted. And the typical corner (25 °C, 1.8 V) is 1.5 times faster than the slow one: this is the margin the design reserves for the worst case, and that voltage overscaling exploits in a typical chip.</p>
<h3>Approximate memory</h3>
<p>The image is stored in a memory that flips each bit with the chosen probability, like a DRAM refreshed less often than safe (Flikker, ${c('liu2011')}), an SRAM at low voltage or a non volatile memory with weaker writes. Flipping bit b changes the pixel by 2<sup>b</sup>, and the expected MSE is the error rate times the sum of 4<sup>b</sup> over the unprotected bits. The high bits dominate the sum: keeping the 2 or 3 most significant bits in a reliable part of the memory removes almost all the error, and the rest can stay in the cheap part. The energy savings depend on the technology and are not estimated here.</p>`,
        },
        {
            id: 'sc',
            title: 'Stochastic computing',
            html: `
<p>In stochastic computing (${c('gaines1969', 'alaghi2013')}), a value p between 0 and 1 is represented by a stream of N bits in which a fraction p of the bits is 1. All bits weigh the same, 1/N. Arithmetic becomes trivial:</p>
<ul>
    <li><strong>unipolar multiplication</strong>: an AND gate. If the streams are independent, P(a and b) = p<sub>a</sub> p<sub>b</sub>;</li>
    <li><strong>bipolar multiplication</strong>: the value is v = 2p − 1, between −1 and 1, and an XNOR gate multiplies;</li>
    <li><strong>scaled addition</strong>: a MUX whose select has p = 1/2 gives (a + b) / 2. The sum comes out divided by 2 to fit between 0 and 1.</li>
</ul>
<p>Each stream comes from a <strong>generator</strong> (SNG): at each cycle, an 8 bit pseudorandom number r<sub>t</sub> is compared with the binary value x, and the bit is 1 when x &gt; r<sub>t</sub>. On the way back, a counter counts the ones. The tab compares four sources for r<sub>t</sub>:</p>
<ul>
    <li><strong>ideal random</strong>: independent bits, new at every operation. The error falls as 1/√N: doubling the precision costs four times more cycles, and matching an 8 bit binary would take more than a hundred thousand bits;</li>
    <li><strong>different LFSRs</strong>: what is done in hardware. With 8 bits the period is 255, and going beyond N = 256 improves nothing (the error stays near 1% for multiplication);</li>
    <li><strong>one LFSR for all streams</strong>: the streams become correlated. The ones of one stream fall in the same positions as the ones of the other, and the AND gives min(a, b) instead of a × b. This is the most typical error of the field (${c('alaghi2013corr')}), and the reason stochastic circuits spend so much on independent generators;</li>
    <li><strong>low discrepancy</strong> (Sobol sequence, ${c('sobol1967')}, with the direction numbers of ${c('joe2008')}; its use in stochastic computing is from ${c('alaghi2014')}): the ones are spread evenly, and the first two dimensions cover the square uniformly. The error falls as 1/N, and multiplication reaches the precision of the 8 bit binary with about a thousand bits.</li>
</ul>
<p>The <strong>cost</strong> shows the other side: the operation is one gate, but each stream needs an LFSR and a comparator, and the output needs a counter. Even so the stochastic circuit is smaller than the exact binary multiplier (in the gate model, 105 gates and 25 flip flops against 320 gates), but it works for N cycles: with N = 256, the estimated energy is about 100 times that of the binary one. Stochastic computing makes sense when generators are shared among many operations, when data already arrive as streams (sensors, neural networks in hardware) or when fault tolerance matters more than energy.</p>
<p><strong>Tolerance to bit errors</strong> is the big advantage: a wrong bit in the stream changes the value by 1/N, while in binary the most significant bit changes half the range. With an error rate of 1% per bit, the stream error barely changes, and the binary error grows several times. In the image, the 1 2 1 Gaussian is done without any multiplication: a 9 input MUX picks at each cycle a neighbor with probability equal to its weight, and the fraction of ones at the output is the weighted mean. With bit errors, the stochastic image gets slightly and evenly noisier; the binary one gets scattered white and black pixels.</p>
<p>The cost model uses the same two input gates as the other tabs, with the SNG comparator built as a carry chain. The energy considers all elements active in every cycle, which is pessimistic for the stochastic circuit (the activity of an LFSR is high, but that of the AND gate is not) and optimistic for the binary one (which has glitches). The order of magnitude of the difference, however, is the same reported in the literature.</p>`,
        },
        {
            id: 'synth',
            title: 'FPGA and ASIC synthesis',
            html: `
<p>The <code>scripts/synth.mjs</code> script, run locally (it takes hours of CPU), synthesizes the <strong>design space</strong> of <code>js/axc/designspace.js</code>, about 540 configurations stratified by technique: Booth, Kulkarni, DRUM and Mitchell complete, with and without compensation; the column based multiplier and the segmented adder on a regular grid with step 2 (about 25% of each); truncated and LOA complete. For each one it:</p>
<ol>
    <li>exports the unit to Verilog: the same circuit the simulator evaluates, one assignment per gate, with the carry propagate additions written as <code>+</code> so that synthesis uses the carry chain (CARRY4), as in a hand written adder;</li>
    <li>simulates the Verilog in Icarus Verilog (${c('iverilog')}) with vectors computed by the simulator (all pairs at 8 bits, 20 thousand at 16 bits); any difference stops the script;</li>
    <li>synthesizes with Yosys (${c('yosys')}) and ABC (${c('brayton2010')}) for Xilinx 7 series FPGA (<code>synth_xilinx -abc9</code>, without DSP) and stores the LUTs, the CARRY4 and the longest path, in cells;</li>
    <li>synthesizes for ASIC in three flows, measures each netlist with OpenSTA (${c('opensta')}) and computes the error metrics with uniform inputs and with the real application operands (below).</li>
</ol>
<p>The <strong>Library</strong> tab of the high level synthesis page (<code>hls.html</code>) shows the table, the comparison between the gate model and synthesis, the design space and the buttons to download the Verilog and the testbench of the unit selected in the table, to take to Vivado or Quartus (any other configuration is exported by the command line: <code>node bin/axc.mjs verilog</code>). In the Comparison, the cost can be the LUTs, or the ASIC area, delay or energy; configurations that are not among the synthesized ones are left out of the chart.</p>
<p>In the FPGA, the 8 bit DRUM uses almost the same LUTs as the exact multiplier (90 against 101: the leading one detector and the shifters eat the savings of the smaller multiplier), and Mitchell, with no multiplication at all, comes out much smaller without truncating anything (70 against 101 LUTs at 8 bits and 280 against 470 at 16), at the price of a 3.8% MRED. The most instructive example is the LOA: in the gate model, the 8 bit LOA with k = 4 uses 25 gates against 37 for the exact one; in the FPGA, 9 LUTs against 8. The OR low part trades the carry chain, which adds almost for free, for ordinary LUTs. Many techniques designed for ASIC save nothing in an FPGA, and that is why there are approximate multipliers designed for LUTs and CARRY4.</p>
<h3>ASIC with the open SkyWater 130 nm PDK</h3>
<p>Yosys maps the circuit onto the standard cells of the <code>sky130_fd_sc_hd</code> library of the open SkyWater PDK (${c('sky130')}) (typical corner, 25 °C, 1.8 V) with ABC, without the cells that do not serve ordinary combinational logic (sequential, clock, delay, low power and fill cells), as the open flows do with their DONT_USE list. There are three flows, all with delay oriented mapping, buffering and cell sizing:</p>
<ul>
    <li><strong>minimum delay</strong>: ABC seeks the smallest possible delay (this is the flow of the numbers in the Summary and in the table);</li>
    <li><strong>minimum area</strong>: with a loose delay target, ABC only saves area;</li>
    <li><strong>iso delay</strong>: minimum area under the delay of the exact unit of the same width in the minimum delay flow. This is the fair comparison of the papers: how much the approximation saves at the same speed. A technique slower than the exact one (such as Booth, and DRUM with k from 4 up, which has the detector and the shifters on the critical path) cannot reach the target and keeps its own minimum delay.</li>
</ul>
<p>Each mapped netlist is checked again in Icarus Verilog, with functional models of the cells read from the library itself, and measured with OpenSTA: the critical path delay with the wire load model of the library, buf_2 on the inputs and 5 fF on each output, and the energy per operation from the activity of a simulation of the netlist with 2048 pairs in sequence. The simulation has zero delay: glitches are left out, so the energy is a lower bound, and ripple adders and multipliers are the most underestimated. These numbers serve to compare configurations with each other, not the result after placement and routing.</p>
<p>The choice of flow changes the numbers a lot: the exact MUL8 takes 2973 µm² with 2115 ps in the minimum delay flow, 2800 µm² in iso delay and 1906 µm² with 3463 ps in minimum area. That is why every comparison has to say which flow it used. In the minimum delay flow, the 16 bit LOA with 8 approximated low bits takes 455 µm² against 731 for the exact one and is faster (949 against 1212 ps), while in the FPGA it used 17 LUTs against 16; DRUM with k = 3 at 8 bits takes 1245 µm² against 2973 and uses 1062 fJ per operation against 2852.</p>
<h3>Energy with real operands</h3>
<p>Energy depends on the data as much as the error does. With the real LeNet-5 pairs (more than half with a zero activation), the exact MUL8 uses 1068 fJ per operation, not 2852: and DRUM3, which saved 63% with uniform inputs, saves only 7% (993 fJ), because the leading one detector and the shifters keep switching with small operands, while the exact multiplier almost stops. At 16 bits the reversal is complete: with the same pairs, Mitchell uses 2562 fJ against 1096 for the exact one, although with uniform inputs it uses much less. The design space shows the energy with these pairs (measured on the minimum delay netlist) and the Pareto front that results from it.</p>
<h3>Design space and EvoApprox8b</h3>
<p>Below the table, the <strong>design space</strong> puts all configurations of a group (MUL8, MUL16, ADD8 or ADD16) on the chart, with the ASIC flow, the cost and the error of your choice, colors by technique and the Pareto front. The error limit removes degenerate configurations from the chart (the ones that truncate everything have almost zero cost and 100% error). The front table shows the 95% confidence interval when the error comes from sampling, and the buttons export the whole group as CSV, JSON and SVG, with all costs, all errors and the front flag.</p>
<p>As a reference, the diamonds are the unsigned 8 and 16 bit circuits of EvoApproxLib (${c('mrazek2017')}), a library of multipliers and adders obtained by Cartesian genetic programming, synthesized here with exactly the same flow (<code>scripts/evoapprox.mjs</code>) and with the error computed on the same pairs; the metrics match the ones published by the library. With uniform inputs, the evolved circuits dominate almost the whole area versus MRED front of the 8 bit multipliers, which is expected: they were optimized for exactly that. With the LeNet-5 operands, the classic techniques (Kulkarni and approximate columns) take the low error end. At 16 bits the difference is even larger: with uniform inputs, EvoApprox has 15 of the 41 points of the area versus MRED front (the rest are truncated and approximate columns); with energy and error measured on the LeNet-5 operands, none of its circuits is on the front. A circuit optimized for one input distribution is not necessarily good for another. The EvoApprox circuits come as gate netlists, and synthesis starts from that structure: their exact one comes out slower than the one here (2928 against 2115 ps at 8 bits).</p>
<p>Yosys is a free tool; Vivado usually gives fewer LUTs for the same circuit. The numbers serve to compare configurations with each other, not to compare with tables of papers synthesized with another tool and another technology.</p>`,
        },
        {
            id: 'cmp',
            title: 'Comparison and Pareto front',
            html: `
<p><strong>Add to comparison</strong> stores the current configuration; <strong>Sweep</strong> adds at once the series of the last parameter changed (truncated or approximate columns in the multiplier; k or P in the adder). The chart puts the chosen cost on the x axis and the chosen error on the y axis.</p>
<p>A configuration <strong>dominates</strong> another when it is not worse on either axis and is better on at least one. The non dominated ones form the <strong>Pareto front</strong>, drawn as steps: they are the only reasonable choices, and the decision among them depends on how much error the application tolerates. Change the error metric and see the front change: WCE and MRED may choose different configurations.</p>
<p>The <strong>dominated by</strong> column counts how many configurations of the comparison dominate each one, with the chosen cost and error: zero is the front. The <strong>knee point</strong>, marked on the chart, is the point of the front farthest from the line joining its ends, with both axes normalized between 0 and 1 (the error in log, when the chart is in log, and then without the zero error points). Up to it, reducing cost is cheap in error; beyond it, each reduction costs much more error. It is a reasonable choice when there is no defined error constraint. The criterion is similar to that of the Kneedle algorithm (${c('satopaa2011')}).</p>
<p>As cost, besides area and delay, you can use the activity and the product of area and activity, an analog of the power area product.</p>
<p>The metric "MSE of the filtered image" measures the error in the application: the 3 × 3 Gaussian filter over the test image (for 8 bit adders, the average with the neighbor). Whole kernels, with your own images, are in the high level synthesis page. The comparison is stored in the browser; the CSV button exports the table.</p>`,
        },
        {
            id: 'nn',
            title: 'Neural network (LeNet 5 and MiniLenet on MNIST)',
            html: `
<p>The <strong>Neural network</strong> page (top bar, or the <strong>Use in LeNet-5</strong> button, which opens it with the current multiplier) classifies 1000 test images, 100 of each class, with one of six networks: <strong>LeNet 5</strong> (${c('lecun1998')}) in its modern form, with ReLU and max pooling (two 5 × 5 convolutions with 6 and 16 filters and three dense layers with 120, 84 and 10 outputs; 61 thousand weights and 416 thousand multiplications per image on MNIST), or <strong>MiniLenet</strong> (below), each on three datasets: <strong>MNIST</strong>, 28 × 28 grayscale handwritten digits (${c('mnist')}); <strong>Fashion MNIST</strong>, clothes and shoes in the same format (${c('xiao2017')}); and <strong>CIFAR 10</strong>, 32 × 32 color photos of airplanes, cars, birds, cats and six other classes (${c('krizhevsky2009')}).</p>
<p>Except for MiniLenet on MNIST, the networks were trained with <code>scripts/nn/train.py</code> (PyTorch): 5000 training images, 500 of each class, are held out for validation (the choice of the best epoch and, later, the search), and the test set is the official one. Quantization is done after training, as in integer networks (${c('jacob2018')}) and in the MiniLenet convention: per output channel int8 weights, uint8 activations with a zero point and a 0 to 127 range, Q32 requantization. On the full test set of 10 thousand images, in floating point and in 8 bits: LeNet 5 99.2% and 99.2% on MNIST, 90.7% and 90.7% on Fashion MNIST, 70.5% and 70.6% on CIFAR 10; MiniLenet 89.0% and 88.8% on Fashion MNIST, 60.2% and 60.1% on CIFAR 10. The browser does exactly the same integer computation as the script, and a test checks the 1000 classes of each network. Networks of this size do well on the grayscale datasets, but miss 30 to 40% on CIFAR 10: with 3 or 6 filters, color photos ask more than the network has. The page's original LeNet 5, trained with NumPy only (<code>scripts/lenet5/train.py</code>), remains the source of the real operands of the units page (<code>data/operands.bin</code>).</p>
<h3>MiniLenet and the network format</h3>
<p>The <strong>Model</strong> selector changes the network. <strong>MiniLenet</strong> comes from C code for Vitis HLS (weights and scales from the DEFADAS/ITACA group of the Universitat Politècnica de València, MIT license): two 5 × 5 convolutions with a border of 2 (3 and 6 filters), two max pooling layers, a dense layer with 147 outputs and the one with 10, with 45 thousand weights and 192 thousand multiplications per image. Quantization is the PyTorch one: symmetric int8 weights, uint8 activations with a zero point and Q32 requantization, <code>(acc × M + 2<sup>31</sup>) &gt;&gt; 32</code> plus the output zero point, saturated between 0 and 255. The input zero point of each layer is folded into the bias (Σ w (a − z) + b = Σ w a + (b − z Σ w)), and the border of the convolutions is filled with z; so every product is uint8 × int8, as in LeNet 5. With the exact units, the 10 outputs of the last layer match the C code bit for bit on the 1000 images (a test checks it), with max pooling in uint8.</p>
<p>The networks are in <code>data/nn/</code>, in a common JSON format (conv, maxpool, flatten and dense layers, weights in base64, Q32 or floating point requantization), listed in <code>data/nn/models.json</code>. The <code>scripts/nn/import.mjs</code> script generates this format from the output of <code>scripts/lenet5/train.py</code> or from the MiniLenet C headers. The <strong>architecture diagram</strong>, below the confusion matrix, comes from the same description: feature maps as stacks of planes, the kernel of each convolution (or the pooling window) linked to the point it produces, and dense layers as bars, in the style of NN SVG (${c('lenail2019')}). It exports to SVG and PNG like the other charts.</p>
<p>The products of the checked layers come from the chosen multiplier: the one from the units page or any multiplier of the synthesized library. As in all applications, the circuit is evaluated once for all (activation, weight) pairs, and inference looks up that table. In unsigned units, the unit computes |weight| × activation and the sign is applied exactly; in the 8 bit Booth the activation loses its lowest bit to fit in the signed operand; in 16 bit units, the operands take the low bits.</p>
<p>What the tab shows, and what the literature on approximate networks explores (${c('venkataramani2014', 'mrazek2016')}):</p>
<ul>
    <li><strong>the network tolerates a lot of error</strong>: truncating 4 columns makes no image become wrong, and Mitchell (MRED of 3.8%) gives practically the same accuracy as the exact network;</li>
    <li><strong>bias matters more than mean error</strong>: each output adds up to 400 products, and an error always on the same side accumulates. Mitchell with compensation has a lower MED than without, but a huge relative error on small products, which are most of them in a network, and the accuracy of LeNet 5 on MNIST drops to 82% (that of MiniLenet, to 49%). The 16 bit Booth with 6 truncated columns, without compensation, errs on average by −88 per product and the network almost stops working;</li>
    <li><strong>the dataset changes the tolerance</strong>: the same unit costs more accuracy on a hard task. MUL8 DRUM3 on every layer of LeNet 5 takes 0.5 point on MNIST, 3.4 on Fashion MNIST and 20.4 on CIFAR 10 (from 69.3% to 48.9% on the 1000 images);</li>
    <li><strong>layers are not equal</strong>: the sensitivity button approximates one layer at a time. conv2 does more than half of the products; approximating only the tolerant layers is the strategy of real designs.</li>
</ul>
<h3>Approximate adder in the accumulations</h3>
<p>The <strong>Accumulation adder</strong> selector puts an approximate adder in the sums of the checked layers, together with the multiplier (or alone, with the exact multiplier); any adder of the library can be chosen. The accumulated sums exceed 24 bits and are signed, and the simulator adders have 8 or 16 bits: the adder computes the low bits of each sum, in the loop order of the C code (each product and, at the end, the bias), and the high part is added exactly with the carry out of it. That is where truncated, LOA and segmented adders err anyway. There are about 416 thousand sums per image, so the accumulation uses the functional model of each adder (the same computation as the circuit, checked on all 8 bit pairs and on sampled 16 bit pairs) and takes 1.5 to 7 seconds for the 1000 images.</p>
<p>Truncated and LOA adders on the 4 or 8 low bits barely change accuracy. The 16 bit segmented adder with 4 bit blocks and 4 bit prediction drops LeNet 5 and MiniLenet on MNIST to about 66%: accumulators are often negative, and adding a small negative value in two's complement propagates the carry through all bits, precisely the case where carry prediction fails. With 8 bit blocks, long chains are less frequent and accuracy goes back to 98%. The same unit that does well with uniform inputs can fail with real data.</p>
<p>The confusion matrix shows where the errors go, and the grid shows the images the exact network gets right and the approximate one gets wrong. The MNIST images are distributed under the CC BY-SA 3.0 license.</p>`,
        },
        {
            id: 'next',
            title: 'Next steps',
            html: `
<ul>
    <li>more techniques: approximate Booth encoder, adders with other carry predictions;</li>
    <li>more kernels and applications in the high level synthesis page.</li>
</ul>`,
        },
        {
            id: 'refs',
            title: 'References',
            html: `
<p>To cite the simulator itself: T. Almeida, <em>axc-simulator: Simulador de Computação Aproximada</em>, Zenodo, 2026, DOI <a href="https://doi.org/10.5281/zenodo.23427697" target="_blank" rel="noopener">10.5281/zenodo.23427697</a>.</p>
<p>The techniques and models of the simulator come from these works. The DOIs were checked in Crossref or OpenAlex; Dadda's paper (1965), published in Alta Frequenza, has no DOI.</p>
${REF_GROUPS.map((g) => `<h3>${GROUP_TITLES[g.key]}</h3>\n<ol class="refs">${g.keys.map((k) => `<li>${refHtml(k, 'en')}</li>`).join('\n')}</ol>`).join('\n')}`,
        },
    ],
};

/** Seções de cada página, na ordem do índice. */
const PAGES = {
    units: ['start', 'mul', 'mul2', 'add', 'metrics', 'cost', 'vos', 'sc', 'cmp', 'synth', 'figs', 'pages', 'next', 'refs'],
    hls: ['hls-start', 'hls-lang', 'hls-cost', 'hls-sched', 'hls-err', 'hls-dse', 'hls-vitis', 'hls-cli', 'synth', 'figs', 'pages', 'refs'],
    lenet: ['nn-start', 'nn', 'figs', 'pages', 'refs'],
};

export default { ...base, heads: { units: { title: base.title, lead: base.lead }, ...heads }, sections: [...base.sections, ...pageSections, ...common], pages: PAGES };
