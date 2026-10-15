/**
 * Simulator help, in English. The text avoids hyphens and dashes, following the project's style.
 * Citations point to the References section, built from js/refs.js (with the DOIs).
 */
import { cite, refHtml, REF_GROUPS } from '../refs.js';

const c = (...keys) => keys.map((k) => `<a class="cite" href="#h-refs">${cite(k, 'en')}</a>`).join('; ');
const GROUP_TITLES = { nn: 'Neural network', arith: 'Approximate arithmetic circuits', eval: 'Evaluation: metrics, image quality, selection and energy', vos: 'Voltage and memory', sc: 'Stochastic computing', tools: 'Tools and PDK' };

export default {
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
    <li><strong>Structure</strong> shows where the approximation happens; <strong>Error</strong> shows for which operands it fails and by how much; <strong>Comparison</strong> puts several configurations on a cost against error chart; <strong>Application</strong> shows the effect on an image; <strong>Voltage and memory</strong> and <strong>Stochastic</strong> deal with other sources of approximation; <strong>Synthesis</strong> brings FPGA and ASIC numbers.</li>
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
<p>With 8 bits and uniform inputs, the evaluation is exhaustive (65536 pairs). Otherwise, 200 thousand pairs drawn with a fixed seed. Normal and exponential inputs show that the same metrics change with the data: a multiplier that fails on large operands looks great if the data are almost always small.</p>
<p>The error map shows |error| for each pair (a, b): patterns in bands, corners or diagonals reveal where the technique fails. The histogram shows whether the error is symmetric or one sided.</p>`,
        },
        {
            id: 'cost',
            title: 'Area and delay',
            html: `
<p>The cost comes from an <strong>educational model</strong>: the area is the number of two input gates (AND, OR, XOR) of the generated circuit, and the delay is the logic depth, one unit per gate. A full adder counts 5 gates and a half adder, 2.</p>
<p>The <strong>activity</strong> is the mean, per operation, of the number of gate outputs that change value from one input pair to the next, over a sequence of 4096 random pairs. Dynamic energy is proportional to it (times the capacitance and the square of the voltage; ${c('chandrakasan1992')}), so it serves as a relative energy indicator among techniques. It is not measured power: the model has no real capacitances or delays, and so it ignores the glitches that make ripple adders more expensive.</p>
<p>This model is good for comparing techniques with each other and understanding where the savings come from, but it does not replace synthesis. In FPGA, the real cost depends on how the tool packs the logic into 6 input LUTs and uses the dedicated carry chain; in ASIC, on the cells of the library. The preset configurations also have the numbers of a real synthesis for FPGA and for ASIC with the open SkyWater 130 nm PDK (see <a href="#h-synth">FPGA and ASIC synthesis</a>).</p>`,
        },
        {
            id: 'vos',
            title: 'Voltage and memory',
            html: `
<h3>Voltage overscaling</h3>
<p>Lowering the voltage reduces dynamic energy with V², but makes gates slower. The delay of each gate follows the alpha power law (${c('sakurai1990')}), d ~ V / (V − V<sub>t</sub>)<sup>α</sup>, with V<sub>t</sub> = 0.3 and α = 1.3 in voltages normalized to nominal: at 0.8 the gate is 1.24 times slower; at 0.6, 1.81 times. The clock stays fixed. An output bit that arrives after the edge is captured with the value of the previous operation.</p>
<p>The time at which each bit arrives depends on the data: in a sequence of 4096 operations, a wire that does not change is ready at time 0, and a wire that changes is ready one gate after the last input that changed. Only the paths the data actually sensitize count, which is why the exact 16 bit adder, with a static path of 31 gates, did not go beyond 17 in the test sequence. The model ignores glitches and the controlling value of gates.</p>
<p>The clock can be that of the exact unit (the same system, swapping only the unit) or that of the unit itself. With the exact clock, the synergy between the two techniques shows up: the multiplier with 8 truncated columns has shorter paths and only starts to fail by timing near 0.64, against 0.78 for the exact one. Mitchell and DRUM, with paths longer than the exact one, fail by timing already near 0.9. The image uses the brightness gain (multiplier) or the average with the neighbor (adder), pixel by pixel, in the same sequence.</p>
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
<p>Every time the site is published, a GitHub action runs <code>scripts/synth.mjs</code> on the preset configurations:</p>
<ol>
    <li>it exports each unit to Verilog: the same circuit the simulator evaluates, one assignment per gate, with the carry propagate additions written as <code>+</code> so that synthesis uses the carry chain (CARRY4), as in a hand written adder;</li>
    <li>it simulates the Verilog in Icarus Verilog (${c('iverilog')}) with vectors computed by the simulator (all pairs at 8 bits, 20 thousand at 16 bits); if there is any difference, publishing stops;</li>
    <li>it synthesizes with Yosys (${c('yosys')}) and ABC (${c('brayton2010')}) for Xilinx 7 series FPGA (<code>synth_xilinx -abc9</code>, without DSP) and stores the LUTs, the CARRY4 and the longest path, in cells.</li>
</ol>
<p>The <strong>Synthesis</strong> tab shows the table, the comparison between the gate model and synthesis (FPGA or ASIC), and the buttons to download the Verilog and the testbench of the current unit (any configuration), to take to Vivado or Quartus. In Comparison, the cost can be the LUTs, the ASIC area or the ASIC delay from synthesis; configurations that are not among the synthesized ones stay out of the chart.</p>
<p>The newer techniques show the same lesson in another way: the 8 bit DRUM uses in the FPGA the same LUTs as the exact multiplier (the leading one detector and the shifters eat the savings of the smaller multiplier), and only pays off at 16 bits; Mitchell, with no multiplication at all, is much smaller than the exact one without truncating anything (in this synthesis, 70 against 101 LUTs at 8 bits and 280 against 470 at 16), at the price of an MRED of 3.8%. And the exact Booth itself is already smaller than the column based multiplier, because it adds half the partial products.</p>
<p>The most instructive example is the LOA: in the gate model, the 8 bit LOA with k = 4 uses 25 gates against 37 for the exact one; in the FPGA, it uses 9 LUTs against 8. The OR lower part replaces the carry chain, which adds almost for free, with regular LUTs. Many techniques designed for ASIC save nothing in FPGA, and that is why there are approximate multipliers designed for LUTs and CARRY4.</p>
<h3>ASIC with the open SkyWater 130 nm PDK</h3>
<p>The same netlist also goes through an ASIC synthesis: Yosys maps the circuit onto the standard cells of the <code>sky130_fd_sc_hd</code> library of the open SkyWater PDK (${c('sky130')}) (typical corner, 25 °C, 1.8 V) with ABC, and the area comes out in µm² by adding the area of each cell. ABC also estimates the critical path delay from the library tables, without wires and without external load: it is a number to compare configurations with each other, not the delay after placement and routing. Cells that are not meant for ordinary combinational logic (sequential, clock, delay, low power and filler cells) are left out, as open flows do with their DONT_USE list.</p>
<p>The comparison with the FPGA is the main lesson: in ASIC, where each saved gate is silicon area, the techniques appear as in the papers. The 16 bit LOA with 8 approximate low bits takes 347 µm² against 666 for the exact one (48% less), while in the FPGA it used 17 LUTs against 16. The 8 bit DRUM with k = 3 takes 976 µm² against 2540 for the exact one, and Mitchell 1523, although both are slower than the exact one (the leading one detector and the shifters are on the critical path). Here the gate model of the simulator is wrong in the opposite direction: it counts more gates than the exact one for DRUM and Mitchell, because it builds the shifters directly, and synthesis simplifies them much better.</p>
<p>Yosys is a free tool and runs in the action without a license; Vivado usually gives fewer LUTs for the same circuit. The numbers serve to compare configurations with each other, not to compare with tables of papers synthesized with another tool.</p>`,
        },
        {
            id: 'cmp',
            title: 'Comparison and Pareto front',
            html: `
<p><strong>Add to comparison</strong> stores the current configuration; <strong>Sweep</strong> adds at once the series of the last parameter changed (truncated or approximate columns in the multiplier; k or P in the adder). The chart puts the chosen cost on the x axis and the chosen error on the y axis.</p>
<p>A configuration <strong>dominates</strong> another when it is not worse on either axis and is better on at least one. The non dominated ones form the <strong>Pareto front</strong>, drawn as steps: they are the only reasonable choices, and the decision among them depends on how much error the application tolerates. Change the error metric and see the front change: WCE and MRED may choose different configurations.</p>
<p>The <strong>dominated by</strong> column counts how many configurations of the comparison dominate each one, with the chosen cost and error: zero is the front. The <strong>knee point</strong>, marked on the chart, is the point of the front farthest from the line joining its ends, with both axes normalized between 0 and 1 (the error in log, when the chart is in log, and then without the zero error points). Up to it, reducing cost is cheap in error; beyond it, each reduction costs much more error. It is a reasonable choice when there is no defined error constraint. The criterion is similar to that of the Kneedle algorithm (${c('satopaa2011')}).</p>
<p>As cost, besides area and delay, you can use the activity and the product of area and activity, an analog of the power area product.</p>
<p>The metric "MSE of the filtered image" measures the error in the application, with the filter chosen in the Application tab. The comparison is stored in the browser; the CSV button exports the table.</p>`,
        },
        {
            id: 'app',
            title: 'Image application',
            html: `
<p>The filter is computed twice, with the exact unit and with the approximate one, on a synthetic test image (or an image of yours, in PNG, JPEG or another format the browser opens, or also PPM, PGM or PBM, reduced to at most 256 pixels per side and converted to grayscale).</p>
<ul>
    <li><strong>Gaussian σ = 1</strong>: nine pixel × weight products per pixel (weights 19, 32, 52), divided by 256. With a multiplier, only the products are approximate; with a 16 bit adder, only the accumulation.</li>
    <li><strong>Gaussian 1 2 1</strong>: weights that are powers of 2. Each product has a single partial product per row, and truncating low columns may cause no error at all: the error depends on the data the unit receives.</li>
    <li><strong>brightness gain</strong>: one product per pixel.</li>
    <li><strong>average with the neighbor</strong>: one 8 bit sum per pixel.</li>
    <li><strong>Sobel edges</strong>: the gradients Gx and Gy, with weights ±1 and ±2 (the same operations as the unrolled MiniC code of the compiler simulator), and the output (|Gx| + |Gy|) / 4. The units are unsigned, so the positive and negative parts of each gradient are accumulated with the unit and subtracted exactly. With a 16 bit adder, the sums are approximate: the LOA with k = 4 gives about 40 dB, and the segmented adder with L = 4 and P = 2, about 20 dB. With a multiplier, the products by 1 and by 2 have a single partial product per row, and the approximate compressors and Mitchell make no error; truncation and DRUM do.</li>
    <li><strong>edge enhancement</strong>: 5 times the pixel minus the 4 neighbors, clamped to 0 and 255. The result is a difference between large values, so a small error in one of the parts becomes a large error in the result: the same units lose much more PSNR here than in the Gaussian.</li>
</ul>
<p><strong>PSNR</strong> = 10 log<sub>10</sub>(255² / MSE), in dB. <strong>SSIM</strong> (${c('wang2004')}) compares brightness, contrast and structure in 8 × 8 windows; 1 is identical. The difference, colored with the same ramp as the error map (black is zero), shows in which regions of the image the approximation appears.</p>`,
        },
        {
            id: 'nn',
            title: 'Neural network (LeNet-5 on MNIST)',
            html: `
<p>The tab classifies 1000 MNIST test digits (${c('mnist')}), 100 of each digit, with a LeNet-5 (${c('lecun1998')}) in its modern form: ReLU and max pooling. There are two 5 × 5 convolutions (6 and 16 filters) and three dense layers (120, 84 and 10 outputs), with about 61 thousand weights and 416 thousand multiplications per image.</p>
<p>The network was trained once with <code>scripts/lenet5/train.py</code>, which uses only NumPy (8 epochs, about 4 minutes on a regular computer), and quantized after training as in integer networks (${c('jacob2018')}): integer weights from −127 to 127, activations from 0 to 255, one scale per layer and integer accumulation. Accuracy on the full test set is 98.9% in floating point and 98.9% in 8 bits; on the 1000 image subset, 98.4%. The browser does exactly the same integer computation as the script, and a test checks that the 1000 classes are the same.</p>
<p>The products of the checked layers come from the unit on the left. As in all applications, the circuit is evaluated once for all (activation, weight) pairs, and inference looks up that table. In unsigned units, the unit computes |weight| × activation and the sign is applied exactly; in the 8 bit Booth the activation loses its lowest bit to fit in the signed operand; in 16 bit units, the operands take the low bits.</p>
<p>What the tab shows, and what the literature on approximate networks explores (${c('venkataramani2014', 'mrazek2016')}):</p>
<ul>
    <li><strong>the network tolerates a lot of error</strong>: truncating 4 columns changes no class, and Mitchell (MRED of 3.8%) gives practically the same accuracy as the exact network;</li>
    <li><strong>bias matters more than mean error</strong>: each output adds up to 400 products, and an error always on the same side accumulates. Mitchell with compensation has a lower MED than without, but a huge relative error on small products, which are most of them in a network, and accuracy drops about 4 points. The 16 bit Booth with 6 truncated columns, without compensation, errs on average by −88 per product and the network almost stops working;</li>
    <li><strong>layers are not equal</strong>: the sensitivity button approximates one layer at a time. conv2 does more than half of the products; approximating only the tolerant layers is the strategy of real designs.</li>
</ul>
<p>The confusion matrix shows where the errors go, and the grid shows the digits the exact network gets right and the approximate one gets wrong. The MNIST images are distributed under the CC BY-SA 3.0 license.</p>`,
        },
        {
            id: 'next',
            title: 'Next steps',
            html: `
<ul>
    <li>more techniques: approximate Booth encoder, adders with other carry predictions;</li>
    <li>exporting the unit to the compiler simulator, as an approximate operation in the DFG and in scheduling.</li>
</ul>`,
        },
        {
            id: 'refs',
            title: 'References',
            html: `
<p>The techniques and models of the simulator come from these works. The DOIs were checked in Crossref or OpenAlex; Dadda's paper (1965), published in Alta Frequenza, has no DOI.</p>
${REF_GROUPS.map((g) => `<h3>${GROUP_TITLES[g.key]}</h3>\n<ol class="refs">${g.keys.map((k) => `<li>${refHtml(k, 'en')}</li>`).join('\n')}</ol>`).join('\n')}`,
        },
    ],
};
